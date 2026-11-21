// ---------- 楦体修型:六参数 + 控制环拖拽 ----------
import * as THREE from 'three';
import { scaffold, overlay, lastSelector } from './ui';
import { applyDeform } from '../core/geom/deform';
import { measureAll, lastHeightOf } from '../core/geom/measure';
import { STATIONS, type LastParams } from '../core/types';
import { db } from '../core/db';
import { makeLine } from '../core/viewer';
import type { LastSession } from '../core/session';

const PARAM_DEFS: { key: keyof LastParams; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'ballGirth',   label: '跖围',   min: -15, max: 15, step: 0.5, unit: 'mm' },
  { key: 'instepGirth', label: '跗围',   min: -15, max: 15, step: 0.5, unit: 'mm' },
  { key: 'heelGirth',   label: '兜跟围', min: -15, max: 15, step: 0.5, unit: 'mm' },
  { key: 'toeSpring',   label: '前跷',   min: -10, max: 20, step: 0.5, unit: 'mm' },
  { key: 'heelLift',    label: '后跷',   min: -10, max: 20, step: 0.5, unit: 'mm' },
  { key: 'topWidth',    label: '统口宽', min: -10, max: 10, step: 0.5, unit: 'mm' },
];

export function renderSculpt(main: HTMLElement): () => void {
  const { panel, viewport, viewer } = scaffold(main);
  const info = overlay(viewport);
  let session: LastSession | null = null;
  let meshObj: THREE.Mesh | null = null;
  let rings: THREE.Group | null = null;
  let girthLines: THREE.Group | null = null;

  const ctrl = document.createElement('div');
  panel.appendChild(ctrl);

  lastSelector(panel, s => { session = s; build(); });

  function build() {
    if (!session) return;
    ctrl.innerHTML = `<h3>修型参数(相对导入状态)</h3>`;
    const params = session.record.params;
    for (const def of PARAM_DEFS) {
      const row = document.createElement('label');
      row.innerHTML = `<span>${def.label}</span><span><input type="number" step="${def.step}" min="${def.min}" max="${def.max}" value="${params[def.key]}"> ${def.unit}</span>`;
      const num = row.querySelector('input')!;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(def.min); slider.max = String(def.max); slider.step = String(def.step);
      slider.value = String(params[def.key]);
      const apply = (v: number) => {
        params[def.key] = v;
        num.value = String(v); slider.value = String(v);
        redeform();
      };
      num.onchange = () => apply(parseFloat(num.value) || 0);
      slider.oninput = () => apply(parseFloat(slider.value));
      ctrl.appendChild(row);
      ctrl.appendChild(slider);
    }
    const btns = document.createElement('div');
    btns.innerHTML = `<h3>操作</h3>
      <button id="save" class="primary">保存修型</button>
      <button id="reset">全部归零</button>
      <div class="hint">也可以直接拖动楦身上的黄色控制环:左右拖改围度,上下拖改跷度。</div>`;
    ctrl.appendChild(btns);
    btns.querySelector('#save')!.addEventListener('click', async () => {
      await db.saveLast(session!.record);
      info.textContent = '已保存。';
    });
    btns.querySelector('#reset')!.addEventListener('click', () => {
      Object.keys(params).forEach(k => (params as any)[k] = 0);
      build();
    });
    redeform();
  }

  function redeform() {
    if (!session) return;
    const { mesh, basePositions, record } = session;
    applyDeform(mesh, basePositions, record.params, record.features.length);
    if (meshObj) { viewer.scene.remove(meshObj); meshObj.geometry.dispose(); }
    meshObj = new THREE.Mesh(mesh.toGeometry(), new THREE.MeshStandardMaterial({ color: 0xb08a68, roughness: 0.7 }));
    viewer.scene.add(meshObj);
    viewer.pickTarget = meshObj;
    // 控制环
    if (rings) viewer.scene.remove(rings);
    rings = new THREE.Group();
    const L = record.features.length, H = lastHeightOf(mesh);
    for (const st of STATIONS) {
      const ring = makeRing(st.t * L, mesh);
      ring.userData.key = st.key;
      rings.add(ring);
    }
    viewer.scene.add(rings);
    // 实时围度
    if (girthLines) viewer.scene.remove(girthLines);
    girthLines = new THREE.Group();
    const ms = measureAll(mesh, L, H);
    const colors = [0xffe066, 0x66d9ff, 0xff8fa3];
    ms.forEach((m, i) => {
      for (const c of m.chains) girthLines!.add(makeLine(c, colors[i], true));
    });
    viewer.scene.add(girthLines);
    info.textContent = ms.map(m => `${m.label} ${m.length.toFixed(1)} mm`).join('\n');
    viewer.frame(new THREE.Vector3(L / 2, 0, H / 2), L * 0.7);
  }

  /** 站位处的控制环(截面多边形) */
  function makeRing(x: number, mesh: import('../core/geom/mesh').MeshData): THREE.Line {
    const chains = mesh.planeSection(new THREE.Vector3(x, 0, 0), new THREE.Vector3(1, 0, 0));
    const pts = chains.sort((a, b) => b.length - a.length)[0] ?? [];
    const line = makeLine(pts, 0xffcc33, true);
    (line.material as THREE.LineBasicMaterial).linewidth = 3;
    return line;
  }

  // 控制环拖拽:命中环附近 → 拖动改参数
  let dragging: string | null = null;
  let lastX = 0, lastY = 0;
  viewer.renderer.domElement.addEventListener('pointerdown', ev => {
    if (!session || !meshObj) return;
    const pt = viewer.pick(ev);
    if (!pt) return;
    const L = session.record.features.length;
    for (const st of STATIONS) {
      if (Math.abs(pt.x - st.t * L) < L * 0.03) {
        dragging = st.key;
        lastX = ev.clientX; lastY = ev.clientY;
        viewer.controls.enabled = false;
        ev.stopPropagation();
        break;
      }
    }
  }, true);
  window.addEventListener('pointermove', ev => {
    if (!dragging || !session) return;
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    lastX = ev.clientX; lastY = ev.clientY;
    const params = session.record.params as any;
    params[dragging] = Math.round((params[dragging] + dx * 0.1 - dy * 0.05) * 2) / 2;
    redeform();
    build();
  });
  window.addEventListener('pointerup', () => {
    if (dragging) { dragging = null; viewer.controls.enabled = true; }
  });

  return () => viewer.dispose();
}
