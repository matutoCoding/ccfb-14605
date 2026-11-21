// ---------- 材质预览:漆皮 / 磨砂皮 / 网布 ----------
import * as THREE from 'three';

export type MaterialKind = '头层皮' | '漆皮' | '磨砂皮' | '网布';

export const MATERIAL_KINDS: MaterialKind[] = ['头层皮', '漆皮', '磨砂皮', '网布'];

/** 生成对应质感的材质;uv 存在时纹理方向跟随展开结果 */
export function makeMaterial(kind: MaterialKind, color = 0x8a5a3a): THREE.Material {
  switch (kind) {
    case '漆皮':
      return new THREE.MeshPhysicalMaterial({
        color, roughness: 0.08, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.05, reflectivity: 0.9,
      });
    case '磨砂皮': {
      const m = new THREE.MeshPhysicalMaterial({
        color, roughness: 0.95, metalness: 0,
        sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(color).multiplyScalar(1.4),
        map: suedeTexture(),
      });
      return m;
    }
    case '网布':
      return new THREE.MeshPhysicalMaterial({
        color, roughness: 0.8, metalness: 0,
        map: meshFabricTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide,
      });
    default:
      return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.02 });
  }
}

/** 磨砂皮:带方向性绒毛纹理 */
function suedeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, 256, 256);
  // 沿对角方向的短绒笔触
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const g = 110 + Math.random() * 60;
    ctx.strokeStyle = `rgba(${g},${g},${g},0.5)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 3 + Math.random() * 3, y + 1 + Math.random() * 2); // 统一绒毛方向
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

/** 网布:透孔格子 */
function meshFabricTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#000';
  const step = 16, r = 5;
  for (let y = 0; y < 128; y += step) {
    for (let x = ((y / step) % 2) * step / 2; x < 128; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  return t;
}
