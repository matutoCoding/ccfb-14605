// ---------- 入口:路由 + 导航 ----------
import './style.css';
import { renderLibrary } from './pages/library';
import { renderSculpt } from './pages/sculpt';
import { renderMeasure } from './pages/measure';
import { renderPattern } from './pages/pattern';
import { renderGrading } from './pages/grading';
import { renderFeedback } from './pages/feedback';

const PAGES: { hash: string; label: string; render: (el: HTMLElement) => void | (() => void) }[] = [
  { hash: 'library',  label: '楦型库',   render: renderLibrary },
  { hash: 'sculpt',   label: '楦体修型', render: renderSculpt },
  { hash: 'measure',  label: '围度测量', render: renderMeasure },
  { hash: 'pattern',  label: '帮面开版', render: renderPattern },
  { hash: 'grading',  label: '放码',     render: renderGrading },
  { hash: 'feedback', label: '试穿反馈', render: renderFeedback },
];

let cleanup: (() => void) | void = undefined;

function route() {
  const hash = location.hash.replace('#/', '').replace('#', '') || 'library';
  const page = PAGES.find(p => p.hash === hash) ?? PAGES[0];
  document.querySelectorAll('nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === `#/${page.hash}`);
  });
  const main = document.getElementById('main')!;
  if (cleanup) cleanup();
  main.innerHTML = '';
  cleanup = page.render(main);
}

function boot() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <header>
      <h1>楦型开版工作室</h1>
      <nav>${PAGES.map(p => `<a href="#/${p.hash}">${p.label}</a>`).join('')}</nav>
    </header>
    <div id="main"></div>`;
  window.addEventListener('hashchange', route);
  route();
}

boot();
