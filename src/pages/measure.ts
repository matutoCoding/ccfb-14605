// ---------- 围度测量:标准测量线 + 目标尺寸表对比 ----------
import * as THREE from 'three';
import { scaffold, overlay, lastSelector } from './ui';
import { measureAll, lastHeightOf } from '../core/geom/measure';
import { makeLine } from '../core/viewer';
import type { LastSession } from '../core/session';

const TOL = 1.5; // 默认公差 mm

export function renderMeasure(main: HTMLElement): () => void {
  const { panel, viewport, viewer } = scaffold(main);
  const info = overlay(viewport);
  let session: LastSession | null = null;
  let meshObj: THREE.Mesh | null = null;
  let lines: THREE.Group | null = null;

  const ctrl = document.createElement('div');
  panel.appendChild(ctrl);
  ctrl.innerHTML = `<h3>目标尺寸表(mm)</h3><div id="tbl"></div>
    <div class="hint">测量线按标准站位画在三维楦上,数值随修型实时更新;超过公差 ±${TOL}mm 标红。</div>
    <button id="refresh">重新测量</button>`;

  lastSelector(panel, s => { session = s; show(); });
  ctrl.querySelector('#refresh')!.addEventListener('click', () => show());

  // 目标值缓存
  const targets: Record<string, number> = JSON.parse(localStorage.getItem('girthTargets') ?? '{}');

  function show() {
    if (!session) return;
    const { mesh, record } = session;
    const L = record.features.length, H = lastHeightOf(mesh);
    if (meshObj) { viewer.scene.remove(meshObj); meshObj.geometry.dispose(); }
    meshObj = new THREE.Mesh(mesh.toGeometry(), new THREE.MeshStandardMaterial({ color: 0x9a8f82, roughness: 0.8 }));
    viewer.scene.add(meshObj);
    if (lines) viewer.scene.remove(lines);
    lines = new THREE.Group();
    const ms = measureAll(mesh, L, H);
    const tbl = ctrl.querySelector('#tbl')!;
    tbl.innerHTML = '';
    const table = document.createElement('table');
    table.innerHTML = `<tr><th>部位</th><th>实测</th><th>目标</th><th>偏差</th></tr>`;
    ms.forEach((m, i) => {
      const colors: Record<string, number> = { ballGirth: 0xffe066, instepGirth: 0x66d9ff, heelGirth: 0xff8fa3 };
      for (const c of m.chains) lines!.add(makeLine(c, colors[m.key] ?? 0xffffff, true));
      const t = targets[m.key] ?? 0;
      const dev = m.length - t;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="text-align:center">${m.label}</td>
        <td>${m.length.toFixed(1)}</td>
        <td><input type="number" step="0.5" value="${t || ''}" data-key="${m.key}" style="width:70px"></td>
        <td class="${t ? (Math.abs(dev) > TOL ? 'bad' : 'good') : ''}">${t ? (dev > 0 ? '+' : '') + dev.toFixed(1) : '—'}</td>`;
      table.appendChild(tr);
    });
    tbl.appendChild(table);
    tbl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        targets[(inp as HTMLInputElement).dataset.key!] = parseFloat((inp as HTMLInputElement).value) || 0;
        localStorage.setItem('girthTargets', JSON.stringify(targets));
        show();
      });
    });
    viewer.scene.add(lines);
    viewer.frame(new THREE.Vector3(L / 2, 0, H / 2), L * 0.7);
    info.textContent = '黄=跖围  青=跗围  粉=兜跟围';
  }

  return () => viewer.dispose();
}
