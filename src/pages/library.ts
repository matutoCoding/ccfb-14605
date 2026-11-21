// ---------- 楦型库:导入/摆正/预览/材质 ----------
import * as THREE from 'three';
import { scaffold, overlay } from './ui';
import { parseLastFile, autoOrient } from '../core/geom/lastIO';
import { db, uid } from '../core/db';
import { setCurrentLast } from '../core/session';
import { zeroParams, type LastRecord } from '../core/types';
import { makeLine, makePoints } from '../core/viewer';
import { makeMaterial, MATERIAL_KINDS, type MaterialKind } from '../core/materials';
import { exportSTL, downloadFile } from '../core/geom/exporters';
import { MeshData } from '../core/geom/mesh';

export function renderLibrary(main: HTMLElement): () => void {
  const { panel, viewport, viewer } = scaffold(main);
  const info = overlay(viewport);
  let meshObj: THREE.Mesh | null = null;
  let helperGroup: THREE.Group | null = null;
  let currentRec: LastRecord | null = null;

  panel.innerHTML = `
    <h3>导入扫描楦型</h3>
    <input type="file" id="file" accept=".obj,.stl" style="width:100%">
    <button id="sample" style="width:100%">没有扫描件?生成一只示例楦</button>
    <div class="hint">支持 OBJ / STL。导入后自动找楦底中线、后跟点、前尖点并摆正坐标,同时抽出楦底样板曲线。</div>
    <h3>材质预览</h3>
    <select id="mat" style="width:100%">${MATERIAL_KINDS.map(m => `<option>${m}</option>`).join('')}</select>
    <div class="hint">漆皮看反光,磨砂皮看绒毛方向,网布看透孔。</div>
    <h3>楦型列表</h3>
    <div id="list"></div>
    <h3>操作</h3>
    <button id="exportStl" disabled>导出 STL(刻楦机)</button>
    <button id="del" class="danger" disabled>删除当前楦</button>`;

  const listEl = panel.querySelector('#list')!;
  const matSel = panel.querySelector<HTMLSelectElement>('#mat')!;
  const exportBtn = panel.querySelector<HTMLButtonElement>('#exportStl')!;
  const delBtn = panel.querySelector<HTMLButtonElement>('#del')!;

  matSel.onchange = () => { if (currentRec) show(currentRec); };

  panel.querySelector<HTMLInputElement>('#file')!.onchange = async ev => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      info.textContent = '解析中…';
      const mesh = parseLastFile(f.name, await f.arrayBuffer());
      await importMesh(mesh, f.name.replace(/\.(obj|stl)$/i, ''));
    } catch (e: any) {
      info.textContent = '导入失败:' + e.message;
    }
  };

  panel.querySelector('#sample')!.addEventListener('click', async () => {
    await importMesh(makeSampleLast(), '示例楦-240');
  });

  async function importMesh(mesh: MeshData, name: string) {
    const features = autoOrient(mesh);
    const rec: LastRecord = {
      id: uid(), name, createdAt: Date.now(),
      positions: mesh.positions, indices: mesh.indices,
      params: zeroParams(), features,
    };
    await db.saveLast(rec);
    localStorage.setItem('currentLastId', rec.id);
    setCurrentLast(rec);
    await refresh();
    show(rec);
  }

  async function refresh() {
    const lasts = await db.listLasts();
    listEl.innerHTML = '';
    for (const l of lasts.sort((a, b) => b.createdAt - a.createdAt)) {
      const item = document.createElement('div');
      item.className = 'list-item' + (currentRec?.id === l.id ? ' active' : '');
      item.innerHTML = `<span>${l.name}</span><span class="hint">${l.features.length.toFixed(0)}mm</span>`;
      item.onclick = () => {
        localStorage.setItem('currentLastId', l.id);
        setCurrentLast(l);
        show(l);
        refresh();
      };
      listEl.appendChild(item);
    }
  }

  function show(rec: LastRecord) {
    currentRec = rec;
    exportBtn.disabled = delBtn.disabled = false;
    if (meshObj) { viewer.scene.remove(meshObj); meshObj.geometry.dispose(); }
    if (helperGroup) viewer.scene.remove(helperGroup);
    const mesh = new MeshData(new Float32Array(rec.positions), rec.indices);
    const geom = mesh.toGeometry();
    meshObj = new THREE.Mesh(geom, makeMaterial(matSel.value as MaterialKind));
    viewer.scene.add(meshObj);
    // 特征点 + 楦底中线 + 楦底样板
    helperGroup = new THREE.Group();
    const f = rec.features;
    helperGroup.add(makePoints([new THREE.Vector3(...f.heelPoint)], 0xff5555, 10));
    helperGroup.add(makePoints([new THREE.Vector3(...f.toePoint)], 0x55ff88, 10));
    if (f.bottomCurve.length > 1)
      helperGroup.add(makeLine(f.bottomCurve.map(p => [p[0], 0, p[1] + 0.5]), 0xffcc44));
    if (f.bottomOutline.length > 1)
      helperGroup.add(makeLine(f.bottomOutline.map(p => [p[0], p[1], 0.5]), 0x44aaff, true));
    viewer.scene.add(helperGroup);
    viewer.frame(new THREE.Vector3(f.length / 2, 0, 30), f.length * 0.7);
    info.textContent =
      `${rec.name}\n楦底长 ${f.length.toFixed(1)} mm  三角形 ${mesh.triCount}\n` +
      `红点=后跟点  绿点=前尖点\n黄线=楦底中线断面  蓝线=楦底样板`;
  }

  exportBtn.onclick = () => {
    if (!currentRec) return;
    const mesh = new MeshData(new Float32Array(currentRec.positions), currentRec.indices);
    downloadFile(`${currentRec.name}.stl`, exportSTL(mesh));
  };
  delBtn.onclick = async () => {
    if (!currentRec) return;
    await db.deleteLast(currentRec.id);
    currentRec = null;
    exportBtn.disabled = delBtn.disabled = true;
    if (meshObj) { viewer.scene.remove(meshObj); meshObj = null; }
    if (helperGroup) { viewer.scene.remove(helperGroup); helperGroup = null; }
    info.textContent = '';
    refresh();
  };

  refresh();
  // 默认显示当前楦
  const savedId = localStorage.getItem('currentLastId');
  if (savedId) db.getLast(savedId).then(r => { if (r) { setCurrentLast(r); show(r); refresh(); } });

  return () => viewer.dispose();
}

/** 程序化示例楦(封闭实体,240mm 女单鞋楦) */
function makeSampleLast(L = 240, nx = 72, nv = 28): MeshData {
  // 截面半宽/半高曲线(模拟女鞋楦:前掌宽、腰窝收、后跟圆、统口收窄)
  const width = (t: number) =>
    36 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + 0.88 * t)), 0.55) * (1 - 0.28 * t * t) + 2;
  const height = (t: number) =>
    8 + 58 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 1.1) * (1 - 0.55 * t) + 30 * Math.exp(-((t - 0.28) ** 2) / 0.01);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const t = i / nx;
    const x = t * L;
    const w = width(t), h = height(t);
    for (let j = 0; j <= nv; j++) {
      const a = (j / nv) * Math.PI;
      const y = Math.cos(a) * w;
      let z = Math.sin(a) * h;
      // 前跷/后跷
      z += 12 * Math.pow(Math.max(0, (t - 0.7) / 0.3), 2) + 18 * Math.pow(Math.max(0, (0.2 - t) / 0.2), 2);
      pos.push(x, y, z);
    }
  }
  const row = nv + 1;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * row + j, b = (i + 1) * row + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // 底面:每行两端(j=0 与 j=nv)之间用扇形封底(z 取该行两端均值)
  const bottomCenter: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const t = i / nx;
    const z = 12 * Math.pow(Math.max(0, (t - 0.7) / 0.3), 2) + 18 * Math.pow(Math.max(0, (0.2 - t) / 0.2), 2);
    bottomCenter.push(pos.length / 3);
    pos.push(t * L, 0, z);
  }
  for (let i = 0; i < nx; i++) {
    const a0 = i * row, b0 = i * row + nv;         // 第 i 行底边两端
    const a1 = (i + 1) * row, b1 = (i + 1) * row + nv;
    const c0 = bottomCenter[i], c1 = bottomCenter[i + 1];
    idx.push(a0, a1, c0, a1, c1, c0);   // 外侧
    idx.push(b1, b0, c0, b1, c0, c1);   // 内侧
  }
  // 端面封口
  const cap = (ringStart: number, center: number, flip: boolean) => {
    for (let j = 0; j < nv; j++) {
      const a = ringStart + j, b = ringStart + j + 1;
      if (flip) idx.push(center, b, a);
      else idx.push(center, a, b);
    }
  };
  const heelC = pos.length / 3;
  pos.push(0, 0, height(0) / 2 + 18);
  cap(0, heelC, true);
  const toeC = pos.length / 3;
  pos.push(L, 0, height(1) / 2 + 12);
  cap(nx * row, toeC, false);
  return new MeshData(new Float32Array(pos), new Uint32Array(idx));
}
