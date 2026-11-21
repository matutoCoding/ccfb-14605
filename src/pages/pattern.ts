// ---------- 帮面开版:贴楦画线 / 选区 / 展平 / 工艺量 / DXF ----------
import * as THREE from 'three';
import { scaffold, overlay, lastSelector } from './ui';
import { makeLine, makePoints } from '../core/viewer';
import { flattenRegion, splitRegionByCut, roundTripError, offsetOutline, regionBoundary } from '../core/geom/flatten';
import { exportDXF, downloadFile } from '../core/geom/exporters';
import { db, uid } from '../core/db';
import { allowanceOf, LINE_KINDS, type SurfaceLine, type PatternPiece, type LineKind, type PatternRecord } from '../core/types';
import type { LastSession } from '../core/session';
import type { MeshData } from '../core/geom/mesh';

type Mode = 'idle' | 'draw' | 'select' | 'notch';

export function renderPattern(main: HTMLElement): () => void {
  const { panel, viewport, viewer } = scaffold(main);
  const info = overlay(viewport);
  let session: LastSession | null = null;
  let meshObj: THREE.Mesh | null = null;
  let mode: Mode = 'idle';
  let drawKind: LineKind = '口门线';
  let drawPts: THREE.Vector3[] = [];
  let lines: SurfaceLine[] = [];
  let pieces: PatternPiece[] = [];
  let region: number[] = [];
  let extLimit = 8; // 皮料延伸率 %
  let patternName = '帮面版';
  let lineGroup = new THREE.Group();
  let pieceGroup = new THREE.Group();
  let draftGroup = new THREE.Group();
  let canvas2d: HTMLCanvasElement;

  panel.innerHTML = `
    <h3>1. 画帮面线</h3>
    <select id="kind" style="width:48%">${LINE_KINDS.map(k => `<option>${k}</option>`).join('')}</select>
    <button id="draw">开始画线</button>
    <button id="undo">撤销点</button>
    <button id="clearLines" class="danger">清空线</button>
    <div class="hint">在楦面上逐点点击,双击结束一条线。端点会自动吸附后跟点/前尖点。「切口线」用于楦背、兜跟等双曲面拆片。</div>
    <h3>2. 选帮面区域</h3>
    <button id="select">点选区域</button>
    <div class="hint">画线围出区域后,在区域内部点一下,系统自动沿线条取片。</div>
    <h3>3. 贴楦展平</h3>
    <label>皮料延伸率上限 <input id="ext" type="number" value="8" step="1" style="width:60px"> %</label>
    <button id="flatten" class="primary">展平</button>
    <div id="flatInfo"></div>
    <h3>4. 裁片</h3>
    <button id="notch">打对位刀口</button>
    <button id="toggle2d">裁片平面图</button>
    <button id="dxf">导出 DXF</button>
    <h3>版样</h3>
    <input id="pname" type="text" value="帮面版" style="width:60%">
    <button id="save">保存版样</button>
    <div id="msg" class="hint"></div>`;

  const msg = (t: string) => (panel.querySelector('#msg')!.textContent = t);
  const kindSel = panel.querySelector<HTMLSelectElement>('#kind')!;
  kindSel.onchange = () => (drawKind = kindSel.value as LineKind);
  panel.querySelector<HTMLInputElement>('#pname')!.onchange = e => (patternName = (e.target as HTMLInputElement).value);
  panel.querySelector<HTMLInputElement>('#ext')!.onchange = e => (extLimit = parseFloat((e.target as HTMLInputElement).value) || 8);

  // ---------- 3D 显示 ----------
  function showMesh() {
    if (!session) return;
    if (meshObj) { viewer.scene.remove(meshObj); meshObj.geometry.dispose(); }
    meshObj = new THREE.Mesh(session.mesh.toGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xb08a68, roughness: 0.7 }));
    viewer.scene.add(meshObj);
    viewer.pickTarget = meshObj;
    viewer.scene.add(lineGroup, pieceGroup, draftGroup);
    const L = session.record.features.length;
    viewer.frame(new THREE.Vector3(L / 2, 0, 40), L * 0.7);
  }

  function redrawLines() {
    lineGroup.clear();
    if (!session) return;
    const f = session.record.features;
    // 特征点
    lineGroup.add(makePoints([new THREE.Vector3(...f.heelPoint)], 0xff5555, 8));
    lineGroup.add(makePoints([new THREE.Vector3(...f.toePoint)], 0x55ff88, 8));
    const colors: Record<string, number> = {
      '口门线': 0xffe066, '鞋舌线': 0xff9f43, '后帮中缝': 0xff6b81,
      '底口线': 0x54a0ff, '接缝线': 0x1dd1a1, '切口线': 0xf368e0, '辅助线': 0xc8d6e5,
    };
    for (const l of lines) lineGroup.add(makeLine(l.points, colors[l.kind] ?? 0xffffff));
    if (drawPts.length) lineGroup.add(makePoints(drawPts, 0xffffff, 7));
  }

  // ---------- 画线 ----------
  panel.querySelector('#draw')!.addEventListener('click', () => {
    mode = mode === 'draw' ? 'idle' : 'draw';
    drawPts = [];
    msg(mode === 'draw' ? `画线中(${drawKind}),双击结束` : '');
  });
  panel.querySelector('#undo')!.addEventListener('click', () => { drawPts.pop(); redrawLines(); });
  panel.querySelector('#clearLines')!.addEventListener('click', () => { lines = []; pieces = []; region = []; pieceGroup.clear(); redrawLines(); });

  viewer.renderer.domElement.addEventListener('dblclick', () => {
    if (mode !== 'draw' || drawPts.length < 2 || !session) return;
    finishLine();
  });

  function finishLine() {
    if (!session) return;
    const mesh = session.mesh;
    // Catmull-Rom 加密 → 投影回楦面
    const dense = catmullRom(drawPts, 12);
    const snapped = dense.map(p => {
      const cp = mesh.closestPoint(p);
      return [cp.point.x, cp.point.y, cp.point.z];
    });
    lines.push({ id: uid(), kind: drawKind, points: snapped });
    drawPts = [];
    redrawLines();
    msg(`已加入${drawKind},共 ${lines.length} 条线`);
  }

  // ---------- 选区 ----------
  panel.querySelector('#select')!.addEventListener('click', () => {
    mode = mode === 'select' ? 'idle' : 'select';
    msg(mode === 'select' ? '在帮面区域内部点一下' : '');
  });

  function pickRegion(seedPt: THREE.Vector3) {
    if (!session) return;
    const mesh = session.mesh;
    const seed = mesh.closestPoint(seedPt);
    if (seed.tri < 0) return;
    // 线条附近的边封死
    const tol = 2.5;
    const blocked = new Set<string>();
    const lineSegs: { a: THREE.Vector3; b: THREE.Vector3; min: THREE.Vector3; max: THREE.Vector3 }[] = [];
    for (const l of lines) {
      for (let i = 0; i < l.points.length - 1; i++) {
        const a = new THREE.Vector3(...(l.points[i] as [number, number, number]));
        const b = new THREE.Vector3(...(l.points[i + 1] as [number, number, number]));
        const min = a.clone().min(b).addScalar(-tol);
        const max = a.clone().max(b).addScalar(tol);
        lineSegs.push({ a, b, min, max });
      }
    }
    const e0 = new THREE.Vector3(), e1 = new THREE.Vector3(), mid = new THREE.Vector3();
    for (const [key] of mesh.edgeTris) {
      const [a, b] = key.split('_').map(Number);
      mesh.v(a, e0); mesh.v(b, e1);
      mid.addVectors(e0, e1).multiplyScalar(0.5);
      for (const s of lineSegs) {
        if (mid.x < s.min.x || mid.x > s.max.x || mid.y < s.min.y || mid.y > s.max.y || mid.z < s.min.z || mid.z > s.max.z) continue;
        if (segSegDist(e0, e1, s.a, s.b) < tol) { blocked.add(key); break; }
      }
    }
    // 洪泛
    region = [];
    const seen = new Set<number>([seed.tri]);
    const stack = [seed.tri];
    while (stack.length) {
      const t = stack.pop()!;
      region.push(t);
      for (let e = 0; e < 3; e++) {
        const a = mesh.indices[t * 3 + e], b = mesh.indices[t * 3 + ((e + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (blocked.has(key)) continue;
        for (const nt of mesh.edgeTris.get(key) ?? []) {
          if (!seen.has(nt)) { seen.add(nt); stack.push(nt); }
        }
      }
    }
    // 高亮选区
    pieceGroup.clear();
    const pos: number[] = [];
    for (const t of region) {
      for (let k = 0; k < 3; k++) {
        const vi = mesh.indices[t * 3 + k];
        pos.push(mesh.positions[vi * 3], mesh.positions[vi * 3 + 1], mesh.positions[vi * 3 + 2]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const hl = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2f89fc, transparent: true, opacity: 0.35, depthTest: false }));
    pieceGroup.add(hl);
    msg(`选区 ${region.length} 个三角形`);
  }

  // ---------- 展平 ----------
  panel.querySelector('#flatten')!.addEventListener('click', () => {
    if (!session || !region.length) { msg('先选区域'); return; }
    const mesh = session.mesh;
    // 切口拆片
    const cuts = lines.filter(l => l.kind === '切口线')
      .map(l => l.points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    let groups = [region];
    for (const c of cuts) groups = groups.flatMap(g => splitRegionByCut(mesh, g, c));
    groups = groups.filter(g => g.length > 20);
    pieces = [];
    pieceGroup.clear();
    const flatInfo = panel.querySelector('#flatInfo')!;
    let html = '';
    groups.forEach((g, gi) => {
      const flat = flattenRegion(mesh, g);
      // 边界 UV 轮廓
      const outline = flat.boundary.map(v => flat.uv.get(v)!).filter(Boolean) as number[][];
      // 每边界点工艺量:找最近的画线类型
      const allow = flat.boundary.map(v => {
        const p = new THREE.Vector3(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]);
        let bestD = 6, bestKind: LineKind | null = null;
        for (const l of lines) {
          for (const lp of l.points) {
            const d = Math.hypot(lp[0] - p.x, lp[1] - p.y, lp[2] - p.z);
            if (d < bestD) { bestD = d; bestKind = l.kind; }
          }
        }
        return bestKind ? allowanceOf(bestKind).mm : 0;
      });
      const cutOutline = offsetOutline(outline, allow);
      // 变形统计
      let maxS = 0, maxC = 0;
      for (let i = 0; i < flat.stretch.length; i++) {
        maxS = Math.max(maxS, flat.stretch[i]);
        maxC = Math.max(maxC, flat.compress[i]);
      }
      // 回贴精度:用区域内的画线验证
      const inner = lines.map(l => l.points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
      const err = roundTripError(mesh, flat, inner);
      const piece: PatternPiece = {
        id: uid(), name: `${patternName}-${gi + 1}`, triIds: g,
        uv: new Float32Array(mesh.vertCount * 2),
        outline, cutOutline, notches: [],
        maxStretch: maxS, maxCompress: maxC, roundTripErr: err,
      };
      for (const [v, uvv] of flat.uv) { piece.uv[v * 2] = uvv[0]; piece.uv[v * 2 + 1] = uvv[1]; }
      pieces.push(piece);
      // 变形色带画回楦面
      pieceGroup.add(distortionMesh(mesh, flat, extLimit / 100));
      const overS = maxS > extLimit / 100, overC = maxC > extLimit / 100;
      html += `<div>片${gi + 1}:伸长 ${(maxS * 100).toFixed(1)}% ${overS ? '<span class="tag tag-warn">超延伸率</span>' : ''}` +
        ` 压缩 ${(maxC * 100).toFixed(1)}% ${overC ? '<span class="tag tag-warn">超</span>' : ''}` +
        ` 回贴误差 <b class="${err > 0.5 ? 'bad' : ''}" style="${err > 0.5 ? 'color:#ff6b6b' : 'color:#6bd88a'}">${err.toFixed(2)}mm</b>${err > 0.5 ? '(>0.5mm,建议加切口)' : ''}</div>`;
    });
    flatInfo.innerHTML = html;
    msg(`展平 ${pieces.length} 片`);
  });

  // ---------- 刀口 ----------
  panel.querySelector('#notch')!.addEventListener('click', () => {
    mode = mode === 'notch' ? 'idle' : 'notch';
    msg(mode === 'notch' ? '在裁片边缘附近点击打刀口' : '');
  });

  function addNotch(pt: THREE.Vector3) {
    if (!session || !pieces.length) return;
    // 投影到最近片的最近轮廓点
    const mesh = session.mesh;
    const cp = mesh.closestPoint(pt);
    let best: PatternPiece | null = null, bestD = Infinity, bestPt: number[] | null = null;
    for (const pc of pieces) {
      if (!pc.triIds.includes(cp.tri)) continue;
      for (const o of pc.outline) {
        // 轮廓点是 UV,需找回三维:近似用边界顶点
      }
      best = pc; break;
    }
    if (!best) { msg('点击位置不在任何裁片内'); return; }
    // 找该片边界上最近的三维顶点 → 对应 UV
    const bnd = regionBoundary(mesh, new Set(best.triIds));
    let bi = -1; bestD = Infinity;
    for (const v of bnd) {
      const d = Math.hypot(mesh.positions[v * 3] - pt.x, mesh.positions[v * 3 + 1] - pt.y, mesh.positions[v * 3 + 2] - pt.z);
      if (d < bestD) { bestD = d; bi = v; }
    }
    if (bi < 0) return;
    best.notches.push([best.uv[bi * 2], best.uv[bi * 2 + 1]]);
    msg(`刀口 ${best.notches.length} 个`);
    draw2dIfVisible();
  }

  // ---------- 2D 平面图 ----------
  let show2d = false;
  panel.querySelector('#toggle2d')!.addEventListener('click', () => {
    show2d = !show2d;
    if (show2d && !canvas2d) {
      canvas2d = document.createElement('canvas');
      canvas2d.className = 'overlay2d';
      viewport.appendChild(canvas2d);
    }
    if (canvas2d) canvas2d.style.display = show2d ? 'block' : 'none';
    draw2dIfVisible();
  });

  function draw2dIfVisible() {
    if (!show2d || !canvas2d) return;
    const w = viewport.clientWidth, h = viewport.clientHeight;
    canvas2d.width = w; canvas2d.height = h;
    const ctx = canvas2d.getContext('2d')!;
    ctx.fillStyle = 'rgba(16,18,22,0.92)';
    ctx.fillRect(0, 0, w, h);
    if (!pieces.length) { ctx.fillStyle = '#889'; ctx.font = '16px sans-serif'; ctx.fillText('尚未展平', 30, 40); return; }
    // 布局:横排
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let xOff = 0;
    const layouts = pieces.map(pc => {
      let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
      for (const p of pc.cutOutline) { pMinX = Math.min(pMinX, p[0]); pMaxX = Math.max(pMaxX, p[0]); pMinY = Math.min(pMinY, p[1]); pMaxY = Math.max(pMaxY, p[1]); }
      const lay = { dx: xOff - pMinX, dy: -pMinY, w: pMaxX - pMinX, h: pMaxY - pMinY };
      xOff += lay.w + 30;
      minX = Math.min(minX, lay.dx); maxX = Math.max(maxX, lay.dx + lay.w);
      minY = Math.min(minY, lay.dy); maxY = Math.max(maxY, lay.dy + lay.h);
      return lay;
    });
    const scale = Math.min((w - 80) / (maxX - minX), (h - 80) / (maxY - minY));
    ctx.translate(40, 40);
    ctx.scale(scale, scale);
    pieces.forEach((pc, i) => {
      const { dx, dy } = layouts[i];
      // 裁片轮廓(含工艺量)
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.5 / scale;
      path(ctx, pc.cutOutline, dx, dy); ctx.stroke();
      // 净样
      ctx.strokeStyle = '#6bd88a';
      ctx.setLineDash([4 / scale, 3 / scale]);
      path(ctx, pc.outline, dx, dy); ctx.stroke();
      ctx.setLineDash([]);
      // 刀口
      ctx.strokeStyle = '#ff6b6b';
      for (const nt of pc.notches) {
        ctx.beginPath();
        ctx.moveTo(nt[0] + dx - 2, nt[1] + dy); ctx.lineTo(nt[0] + dx + 2, nt[1] + dy);
        ctx.stroke();
      }
      // 纹理方向(沿展开 u 方向)
      const c = pc.outline[Math.floor(pc.outline.length / 2)];
      ctx.strokeStyle = '#54a0ff';
      ctx.beginPath();
      ctx.moveTo(c[0] + dx - 15, c[1] + dy); ctx.lineTo(c[0] + dx + 15, c[1] + dy);
      ctx.lineTo(c[0] + dx + 11, c[1] + dy - 3); ctx.moveTo(c[0] + dx + 15, c[1] + dy);
      ctx.lineTo(c[0] + dx + 11, c[1] + dy + 3);
      ctx.stroke();
      // 标注
      ctx.fillStyle = '#dde1e7';
      ctx.font = `${10 / scale}px sans-serif`;
      ctx.fillText(`${pc.name}  误差${pc.roundTripErr.toFixed(2)}mm`, dx, dy - 6 / scale);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function path(ctx: CanvasRenderingContext2D, pts: number[][], dx: number, dy: number) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + dx, p[1] + dy) : ctx.moveTo(p[0] + dx, p[1] + dy)));
    ctx.closePath();
  }

  // ---------- DXF / 保存 ----------
  panel.querySelector('#dxf')!.addEventListener('click', () => {
    if (!pieces.length) { msg('先展平'); return; }
    downloadFile(`${patternName}.dxf`, exportDXF(pieces.map(p => ({ name: p.name, outline: p.cutOutline, notches: p.notches }))));
    msg('DXF 已导出(单位 mm)');
  });

  panel.querySelector('#save')!.addEventListener('click', async () => {
    if (!session) return;
    const rec: PatternRecord = {
      id: uid(), lastId: session.record.id, name: patternName,
      createdAt: Date.now(), lines, pieces,
    };
    await db.savePattern(rec);
    msg('版样已保存');
  });

  // ---------- 拾取 ----------
  viewer.onPick((pt, ev) => {
    if (!session) return;
    if (mode === 'draw') {
      // 吸附特征点
      const f = session.record.features;
      for (const fp of [f.heelPoint, f.toePoint]) {
        if (pt.distanceTo(new THREE.Vector3(...fp)) < 8) { pt.set(...fp); break; }
      }
      drawPts.push(pt.clone());
      redrawLines();
    } else if (mode === 'select') {
      pickRegion(pt);
      mode = 'idle';
    } else if (mode === 'notch') {
      addNotch(pt);
    }
  });

  // 加载已有版样
  async function loadPattern() {
    if (!session) return;
    const all = await db.listPatterns();
    const rec = all.filter(p => p.lastId === session!.record.id).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (rec) {
      lines = rec.lines;
      pieces = rec.pieces;
      patternName = rec.name;
      redrawLines();
      msg(`已载入版样「${rec.name}」(${lines.length}条线, ${pieces.length}片)`);
    }
  }

  lastSelector(panel, s => {
    session = s;
    showMesh();
    redrawLines();
    loadPattern();
    info.textContent = '流程:画线 → 选区 → 展平 → 刀口 → DXF';
  });

  return () => viewer.dispose();
}

/** Catmull-Rom 样条加密 */
function catmullRom(pts: THREE.Vector3[], segPerSpan: number): THREE.Vector3[] {
  if (pts.length < 2) return pts.slice();
  const out: THREE.Vector3[] = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 0; i < P.length - 3; i++) {
    const p0 = P[i], p1 = P[i + 1], p2 = P[i + 2], p3 = P[i + 3];
    for (let j = 0; j < segPerSpan; j++) {
      const t = j / segPerSpan, t2 = t * t, t3 = t2 * t;
      out.push(new THREE.Vector3(
        0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)));
    }
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

/** 变形色带:蓝=压缩 绿=正常 红=伸长超限 */
function distortionMesh(mesh: MeshData, flat: import('../core/geom/flatten').FlattenResult, limit: number): THREE.Mesh {
  const pos: number[] = [], col: number[] = [];
  const cOk = new THREE.Color(0x3fbf5f), cS = new THREE.Color(0xff4444), cC = new THREE.Color(0x4488ff);
  for (let i = 0; i < flat.tris.length; i++) {
    const t = flat.tris[i];
    const s = flat.stretch[i], c = flat.compress[i];
    let color = cOk;
    if (s > limit) color = cS;
    else if (c > limit) color = cC;
    else if (s > limit * 0.6 || c > limit * 0.6) color = new THREE.Color(0xffc14d);
    for (let k = 0; k < 3; k++) {
      const vi = mesh.indices[t * 3 + k];
      pos.push(mesh.positions[vi * 3], mesh.positions[vi * 3 + 1], mesh.positions[vi * 3 + 2]);
      col.push(color.r, color.g, color.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
}

function segSegDist(p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3): number {
  const d = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0, 1);
    return new THREE.Vector3().copy(a).addScaledVector(ab, t).distanceTo(p);
  };
  return Math.min(d(p1, p3, p4), d(p2, p3, p4), d(p3, p1, p2), d(p4, p1, p2));
}
