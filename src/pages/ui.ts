// ---------- 页面公共脚手架 ----------
import { Viewer } from '../core/viewer';
import { db } from '../core/db';
import { loadLast, getLast, type LastSession } from '../core/session';

export function scaffold(main: HTMLElement): { panel: HTMLElement; viewport: HTMLElement; viewer: Viewer } {
  main.innerHTML = `<div class="page"><div class="panel"></div><div class="viewport"></div></div>`;
  const panel = main.querySelector('.panel') as HTMLElement;
  const viewport = main.querySelector('.viewport') as HTMLElement;
  const viewer = new Viewer(viewport);
  return { panel, viewport, viewer };
}

/** 楦型选择器:没有当前楦时显示提示,选中后回调 */
export async function lastSelector(panel: HTMLElement, onReady: (s: LastSession) => void) {
  const lasts = await db.listLasts();
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h3>当前楦型</h3>`;
  panel.prepend(wrap);
  if (!lasts.length) {
    wrap.innerHTML += `<div class="hint">楦型库为空,请先到「楦型库」导入 OBJ / STL 扫描件。</div>`;
    return;
  }
  const sel = document.createElement('select');
  sel.style.width = '100%';
  sel.innerHTML = `<option value="">— 选择楦型 —</option>` +
    lasts.map(l => `<option value="${l.id}">${l.name}(楦底长 ${l.features.length.toFixed(1)}mm)</option>`).join('');
  wrap.appendChild(sel);
  const savedId = localStorage.getItem('currentLastId');
  const cur = getLast();
  const initId = cur?.record.id ?? savedId ?? lasts[0].id;
  sel.value = initId;
  const load = async (id: string) => {
    const s = await loadLast(id);
    if (s) {
      localStorage.setItem('currentLastId', id);
      onReady(s);
    }
  };
  sel.onchange = () => sel.value && load(sel.value);
  if (initId) await load(initId);
}

export function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
}

export function overlay(viewport: HTMLElement): HTMLElement {
  const o = document.createElement('div');
  o.className = 'overlay';
  viewport.appendChild(o);
  return o;
}
