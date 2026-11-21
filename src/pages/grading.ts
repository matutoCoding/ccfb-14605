// ---------- 放码:中国鞋号 / 欧码,整套尺码输出与叠图对比 ----------
import * as THREE from 'three';
import { scaffold, overlay, lastSelector } from './ui';
import { gradeAll, CN_SIZES, EU_SIZES, type GradedSize } from '../core/geom/grading';
import { CN_RULE, EU_RULE, type GradingRule } from '../core/types';
import { girthAt, lastHeightOf } from '../core/geom/measure';
import { MeshData } from '../core/geom/mesh';
import { exportSTL, downloadFile } from '../core/geom/exporters';
import { extractFeatures } from '../core/geom/lastIO';
import type { LastSession } from '../core/session';

export function renderGrading(main: HTMLElement): () => void {
  const { panel, viewport, viewer } = scaffold(main);
  const info = overlay(viewport);
  let session: LastSession | null = null;
  let graded: GradedSize[] = [];
  let meshGroup = new THREE.Group();
  viewer.scene.add(meshGroup);

  panel.innerHTML = `
    <h3>放码规则</h3>
    <label>码制 <select id="sys"><option value="CN">中国鞋号</option><option value="EU">欧码</option></select></label>
    <label>长度档差 <input id="lstep" type="number" step="0.01" value="5" style="width:60px"> mm/码</label>
    <label>围度档差 <input id="gstep" type="number" step="0.1" value="3.5" style="width:60px"> mm/码</label>
    <button id="run" class="primary">整套放码</button>
    <h3>各码跖围核对</h3>
    <div id="tbl"></div>
    <h3>操作</h3>
    <button id="overlay">各码叠图对比</button>
    <button id="stlAll">导出全部 STL</button>
    <div class="hint">长度档差与围度档差分开设定;整套尺码的楦体一起出,跖围实测值应与设定档差一致。</div>`;

  const sysSel = panel.querySelector<HTMLSelectElement>('#sys')!;
  const lstep = panel.querySelector<HTMLInputElement>('#lstep')!;
  const gstep = panel.querySelector<HTMLInputElement>('#gstep')!;
  sysSel.onchange = () => {
    const r = sysSel.value === 'CN' ? CN_RULE : EU_RULE;
    lstep.value = String(r.lengthStep);
    gstep.value = String(r.girthStep);
  };

  let canvas2d: HTMLCanvasElement | null = null;

  panel.querySelector('#run')!.addEventListener('click', () => {
    if (!session) return;
    const rule: GradingRule = {
      system: sysSel.value as 'CN' | 'EU',
      lengthStep: parseFloat(lstep.value) || 5,
      girthStep: parseFloat(gstep.value) || 3.5,
    };
    const sizes = rule.system === 'CN' ? CN_SIZES : EU_SIZES;
    const mid = Math.floor(sizes.length / 2);
    const { mesh, record, basePositions } = session;
    const L = record.features.length;
    const baseBall = girthAt(mesh, 'ballGirth', L, lastHeightOf(mesh)).length;
    graded = gradeAll(basePositions, mesh.indices, record.params, rule, sizes, mid, baseBall, L);
    // 表格
    const tbl = panel.querySelector('#tbl')!;
    let html = `<table><tr><th>码</th><th>楦底长</th><th>跖围实测</th><th>跖围目标</th><th>偏差</th></tr>`;
    for (const g of graded) {
      const dev = g.ballGirth - g.ballGirthTarget;
      html += `<tr><td style="text-align:center">${g.label}</td><td>${g.length.toFixed(1)}</td>
        <td>${g.ballGirth.toFixed(1)}</td><td>${g.ballGirthTarget.toFixed(1)}</td>
        <td class="${Math.abs(dev) > 0.5 ? 'bad' : 'good'}">${dev >= 0 ? '+' : ''}${dev.toFixed(2)}</td></tr>`;
    }
    tbl.innerHTML = html + '</table>';
    // 显示中码与两端码的楦体
    meshGroup.clear();
    const showIdx = [0, mid, graded.length - 1];
    const colors = [0x54a0ff, 0xb08a68, 0xff6b81];
    showIdx.forEach((gi, i) => {
      const g = graded[gi];
      const m = new MeshData(g.positions, session!.mesh.indices);
      const obj = new THREE.Mesh(m.toGeometry(), new THREE.MeshStandardMaterial({
        color: colors[i], transparent: i !== 1, opacity: i === 1 ? 1 : 0.45, roughness: 0.7,
      }));
      meshGroup.add(obj);
    });
    viewer.frame(new THREE.Vector3(L / 2, 0, 40), L * 0.8);
    info.textContent = `蓝=${graded[0].label}  本色=${graded[mid].label}  红=${graded[graded.length - 1].label}`;
  });

  panel.querySelector('#overlay')!.addEventListener('click', () => {
    if (!graded.length || !session) return;
    if (!canvas2d) {
      canvas2d = document.createElement('canvas');
      canvas2d.className = 'overlay2d';
      viewport.appendChild(canvas2d);
    }
    canvas2d.style.display = canvas2d.style.display === 'none' ? 'block' : 'none';
    if (canvas2d.style.display === 'none') return;
    const w = viewport.clientWidth, h = viewport.clientHeight;
    canvas2d.width = w; canvas2d.height = h;
    const ctx = canvas2d.getContext('2d')!;
    ctx.fillStyle = 'rgba(16,18,22,0.92)';
    ctx.fillRect(0, 0, w, h);
    // 各码楦底样板轮廓,后跟点对齐
    const outlines = graded.map(g => {
      const m = new MeshData(new Float32Array(g.positions), session!.mesh.indices);
      return extractFeatures(m).bottomOutline;
    }).filter(o => o.length > 2);
    let maxX = -Infinity, maxY = -Infinity, minY = Infinity;
    for (const o of outlines) for (const p of o) {
      maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); minY = Math.min(minY, p[1]);
    }
    const scale = Math.min((w - 100) / maxX, (h - 100) / (maxY - minY));
    ctx.translate(60, h / 2 - ((maxY + minY) / 2) * scale);
    ctx.scale(scale, scale);
    outlines.forEach((o, i) => {
      const t = i / (outlines.length - 1);
      ctx.strokeStyle = `hsl(${210 - t * 180}, 80%, 60%)`;
      ctx.lineWidth = 1.2 / scale;
      ctx.beginPath();
      o.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
      // 码号标注在前尖
      const toe = o.reduce((a, b) => (b[0] > a[0] ? b : a));
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `${9 / scale}px sans-serif`;
      ctx.fillText(graded[i].label, toe[0] + 2 / scale, toe[1]);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#889';
    ctx.font = '13px sans-serif';
    ctx.fillText('各码楦底样板叠图(后跟点对齐,再点一次关闭)', 20, 24);
  });

  panel.querySelector('#stlAll')!.addEventListener('click', () => {
    if (!graded.length || !session) return;
    graded.forEach((g, i) => {
      const m = new MeshData(g.positions, session!.mesh.indices);
      setTimeout(() => downloadFile(`${session!.record.name}-${g.label}.stl`, exportSTL(m)), i * 300);
    });
  });

  lastSelector(panel, s => {
    session = s;
    info.textContent = '设定规则后点「整套放码」';
  });

  return () => viewer.dispose();
}
