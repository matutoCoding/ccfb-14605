// ---------- three.js 场景封装 ----------
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  raycaster = new THREE.Raycaster();
  private resizeObs: ResizeObserver;
  private pickHandlers: ((pt: THREE.Vector3, ev: PointerEvent) => void)[] = [];
  pickTarget: THREE.Object3D | null = null;

  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1c1f24);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    this.camera.position.set(150, 120, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334, 1.1);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(120, 200, 150);
    const dir2 = new THREE.DirectionalLight(0x8899ff, 0.5);
    dir2.position.set(-150, 80, -100);
    this.scene.add(hemi, dir, dir2);
    const grid = new THREE.GridHelper(400, 40, 0x333a44, 0x262b33);
    grid.rotation.x = Math.PI / 2; // 地面为 XY? 不,楦坐标 Z 向上 → 网格放 XY 平面
    grid.rotation.x = 0;
    this.scene.add(grid);
    // Z 向上
    this.camera.up.set(0, 0, 1);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    this.renderer.domElement.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || !this.pickTarget) return;
      const pt = this.pick(ev);
      if (pt) this.pickHandlers.forEach(h => h(pt, ev));
    });

    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  pick(ev: PointerEvent): THREE.Vector3 | null {
    if (!this.pickTarget) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.pickTarget, false);
    return hits.length ? hits[0].point.clone() : null;
  }

  onPick(h: (pt: THREE.Vector3, ev: PointerEvent) => void) { this.pickHandlers.push(h); }

  frame(center: THREE.Vector3, radius: number) {
    this.controls.target.copy(center);
    const d = radius * 2.4;
    this.camera.position.set(center.x + d * 0.5, center.y - d, center.z + d * 0.6);
    this.controls.update();
  }

  dispose() {
    this.resizeObs.disconnect();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}

/** 由点数组生成线条对象 */
export function makeLine(pts: THREE.Vector3[] | number[][], color: number, closed = false): THREE.Line {
  const v3 = (pts as any[]).map(p => Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2] ?? 0) : p);
  if (closed && v3.length) v3.push(v3[0]);
  const g = new THREE.BufferGeometry().setFromPoints(v3);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: true }));
}

export function makePoints(pts: THREE.Vector3[], color: number, size = 6): THREE.Points {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
}
