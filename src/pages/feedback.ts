// ---------- 试穿反馈:热点记录 + 围度调整建议 ----------
import * as THREE from 'three';
import { scaffold, overlay, lastSelector } from './ui';
import { db, uid } from '../core/db';
import { STATIONS, type FittingRecord } from '../core/types';
import type { LastSession } from '../core/session';

const KINDS = ['顶脚', '磨跟', '压背', '挤趾', '空跟'] as const;
const KIND_COLORS: Record<string, number> = {
  '顶脚': 0xff4444, '磨跟': 0xff9f43, '压背': 0xf368e0, '挤趾': 0xffe066, '空跟': 0x54a0ff,
};

export function renderFeedback(main: HTMLElement): () => void {
  const { panel, viewport, viewer } = scaffold(main);
  const info = overlay(viewport);
  let session: LastSession | null = null;
  let meshObj: THREE.Mesh | null = null;
  let spots = new THREE.Group();
  let records: FittingRecord[] = [];
  let placing = false;

  panel.innerHTML = `
    <h3>记录试穿问题</h3>
    <label>码数 <input id="size" type="text" value="240" style="width:70px"></label>
    <label>问题 <select id="kind">${KINDS.map(k => `<option>${k}</option>`).join('')}</select></label>
    <button id="place" class="primary">在楦面上打点</button>
    <div class="hint">选择码数和问题类型后,在楦面对应位置点击打热点。</div>
    <h3>调整建议</h3>
    <div id="suggest" class="hint">积累反馈后自动生成</div>
    <h3>反馈记录</h3>
    <div id="list"></div>`;

  const sizeInp = panel.querySelector<HTMLInputElement>('#size')!;
  const kindSel = panel.querySelector<HTMLSelectElement>('#kind')!;
  const placeBtn = panel.querySelector<HTMLButtonElement>('#place')!;
  placeBtn.onclick = () => {
    placing = !placing;
    placeBtn.textContent = placing ? '点击楦面放置…' : '在楦面上打点';
  };

  viewer.onPick(async pt => {
    if (!placing || !session) return;
    const rec: FittingRecord = {
      id: uid(), lastId: session.record.id,
      size: sizeInp.value || '240', kind: kindSel.value as FittingRecord['kind'],
      position: [pt.x, pt.y, pt.z], createdAt: Date.now(),
    };
    await db.saveFitting(rec);
    placing = false;
    placeBtn.textContent = '在楦面上打点';
    await refresh();
  });

  async function refresh() {
    if (!session) return;
    records = (await db.listFittings()).filter(r => r.lastId === session!.record.id);
    // 热点
    spots.clear();
    for (const r of records) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(2.5, 12, 12),
        new THREE.MeshBasicMaterial({ color: KIND_COLORS[r.kind] ?? 0xffffff, depthTest: false }));
      s.position.set(...r.position);
      spots.add(s);
    }
    // 列表
    const list = panel.querySelector('#list')!;
    list.innerHTML = '';
    for (const r of records.sort((a, b) => b.createdAt - a.createdAt)) {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `<span><span class="tag" style="background:#${(KIND_COLORS[r.kind] ?? 0xffffff).toString(16).padStart(6, '0')};color:#111">${r.kind}</span>${r.size}码</span>
        <span class="hint" style="cursor:pointer">✕</span>`;
      item.querySelector('.hint')!.addEventListener('click', async () => {
        await db.deleteFitting(r.id);
        refresh();
      });
      list.appendChild(item);
    }
    suggest();
  }

  /** 按热点位置聚类到测量站位,生成围度调整建议 */
  function suggest() {
    const el = panel.querySelector('#suggest')!;
    if (!session || records.length < 2) { el.textContent = records.length ? '样本还少,继续积累' : '暂无反馈'; return; }
    const L = session.record.features.length;
    const tips: string[] = [];
    const byKind = new Map<string, FittingRecord[]>();
    for (const r of records) {
      const arr = byKind.get(r.kind) ?? [];
      arr.push(r);
      byKind.set(r.kind, arr);
    }
    for (const [kind, arr] of byKind) {
      if (arr.length < 2) continue;
      const avgX = arr.reduce((a, r) => a + r.position[0], 0) / arr.length;
      const t = avgX / L;
      // 找最近站位
      let nearest: (typeof STATIONS)[number] = STATIONS[0], bestD = Infinity;
      for (const st of STATIONS) {
        const d = Math.abs(st.t - t);
        if (d < bestD) { bestD = d; nearest = st; }
      }
      const n = arr.length;
      switch (kind) {
        case '压背':
          tips.push(`「压背」${n} 次 → 跗围建议加 ${(0.5 * n).toFixed(1)}mm(当前站位 ${nearest.label} 附近)`);
          break;
        case '挤趾':
          tips.push(`「挤趾」${n} 次 → 跖围建议加 ${(0.5 * n).toFixed(1)}mm`);
          break;
        case '顶脚':
          tips.push(`「顶脚」${n} 次 → 长度方向不足,建议放半码(+2.5mm)或检查前跷`);
          break;
        case '磨跟':
          tips.push(`「磨跟」${n} 次 → 兜跟围建议减 ${(0.4 * n).toFixed(1)}mm,或检查后跷`);
          break;
        case '空跟':
          tips.push(`「空跟」${n} 次 → 兜跟围建议减 ${(0.5 * n).toFixed(1)}mm,统口宽收 ${(0.3 * n).toFixed(1)}mm`);
          break;
      }
    }
    el.innerHTML = tips.length ? tips.map(t => `<div>• ${t}</div>`).join('') : '各类问题样本均不足 2 条';
  }

  lastSelector(panel, async s => {
    session = s;
    if (meshObj) { viewer.scene.remove(meshObj); meshObj.geometry.dispose(); }
    meshObj = new THREE.Mesh(s.mesh.toGeometry(), new THREE.MeshStandardMaterial({ color: 0xb08a68, roughness: 0.7 }));
    viewer.scene.add(meshObj);
    viewer.scene.add(spots);
    viewer.pickTarget = meshObj;
    const L = s.record.features.length;
    viewer.frame(new THREE.Vector3(L / 2, 0, 40), L * 0.7);
    info.textContent = '热点颜色:红=顶脚 橙=磨跟 紫=压背 黄=挤趾 蓝=空跟';
    await refresh();
  });

  return () => viewer.dispose();
}
