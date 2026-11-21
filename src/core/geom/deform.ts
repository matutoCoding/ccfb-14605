// ---------- 楦体修型:六参数编辑 + 过渡光顺 ----------
import * as THREE from 'three';
import { MeshData } from './mesh';
import { girthAt, lastHeightOf } from './measure';
import { STATIONS, type LastParams } from '../types';

/**
 * 把修型参数应用到网格上(从 basePositions 重算,幂等)。
 * 围度:在站位处把截面点相对截面形心做径向缩放,权重沿长向高斯衰减,
 *       使相邻区域自然过渡;Taubin λ/μ 光顺过渡带,不起棱也不缩围度;
 *       最后复测围长做残差校正,保证实测值与设定值一致。
 * 前跷/后跷:端部抬升,平滑斜坡过渡。
 * 统口宽:统口区域宽向缩放。
 */
export function applyDeform(mesh: MeshData, base: Float32Array, params: LastParams, lastLength: number) {
  const p = mesh.positions;
  p.set(base);
  const n = mesh.vertCount;
  const H = lastHeightOf(mesh);
  const influence = new Float32Array(n);
  const sigma = lastLength * 0.09;

  /** 站位围度径向缩放(delta 为相对当前网格的增减量) */
  const girthScale = (stKey: string, delta: number, record: boolean) => {
    if (!delta) return;
    const st = STATIONS.find(s => s.key === stKey)!;
    const g0 = girthAt(mesh, stKey, lastLength, H).length;
    if (g0 <= 0) return;
    const scale = (g0 + delta) / g0;
    const x0 = st.t * lastLength;
    let cy = 0, cz = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(p[i * 3] - x0) < sigma * 0.5) { cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; cnt++; }
    }
    if (!cnt) return;
    cy /= cnt; cz /= cnt;
    for (let i = 0; i < n; i++) {
      const dx = p[i * 3] - x0;
      const w = Math.exp(-(dx * dx) / (2 * sigma * sigma));
      if (w < 0.01) continue;
      const s = 1 + (scale - 1) * w;
      p[i * 3 + 1] = cy + (p[i * 3 + 1] - cy) * s;
      p[i * 3 + 2] = cz + (p[i * 3 + 2] - cz) * s;
      if (record) influence[i] = Math.max(influence[i], w);
    }
  };

  // --- 前跷(前尖抬升) ---
  if (params.toeSpring) {
    const x0 = lastLength * 0.6;
    for (let i = 0; i < n; i++) {
      const t = THREE.MathUtils.clamp((p[i * 3] - x0) / (lastLength - x0), 0, 1);
      const s = t * t * (3 - 2 * t); // smoothstep
      if (s <= 0) continue;
      p[i * 3 + 2] += params.toeSpring * s;
      influence[i] = Math.max(influence[i], s * 0.8);
    }
  }
  // --- 后跷(后跟抬升) ---
  if (params.heelLift) {
    const x0 = lastLength * 0.25;
    for (let i = 0; i < n; i++) {
      const t = THREE.MathUtils.clamp(1 - p[i * 3] / x0, 0, 1);
      const s = t * t * (3 - 2 * t);
      if (s <= 0) continue;
      p[i * 3 + 2] += params.heelLift * s;
      influence[i] = Math.max(influence[i], s * 0.8);
    }
  }
  // --- 统口宽 ---
  if (params.topWidth) {
    const zTh = H * 0.55, xTh = lastLength * 0.5;
    let w0 = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (p[i * 3 + 2] > zTh && p[i * 3] < xTh) { w0 += Math.abs(p[i * 3 + 1]); cnt++; }
    }
    if (cnt) {
      w0 /= cnt;
      const k = params.topWidth / 2 / Math.max(w0, 1);
      for (let i = 0; i < n; i++) {
        const wz = THREE.MathUtils.clamp((p[i * 3 + 2] - zTh) / (H - zTh), 0, 1);
        const wx = THREE.MathUtils.clamp(1 - p[i * 3] / xTh, 0, 1);
        const w = wz * wx;
        if (w <= 0.01) continue;
        p[i * 3 + 1] *= 1 + k * w;
        influence[i] = Math.max(influence[i], w);
      }
    }
  }

  // --- 围度初调 ---
  const baseMesh = new MeshData(new Float32Array(base), mesh.indices);
  const girthTargets: { key: string; target: number }[] = [];
  for (const st of STATIONS) {
    const delta = (params as any)[st.key] as number;
    if (!delta) continue;
    const gBase = girthAt(baseMesh, st.key, lastLength, H).length;
    if (gBase <= 0) continue;
    girthTargets.push({ key: st.key, target: gBase + delta });
    girthScale(st.key, delta, true);
  }

  // --- 影响区光顺(Taubin λ/μ:过渡带不起棱且不缩围度) ---
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (influence[i] > 0.005) mask[i] = 1;
  for (let i = 0; i < n; i++) {
    if (mask[i]) continue;
    if (mesh.vAdj[i].some(j => mask[j])) mask[i] = 1;
  }
  mesh.smooth(3, 0.5, mask);
  mesh.smooth(3, -0.53, mask);

  // --- 围度残差校正(站位间会互相牵扯,整体迭代两轮,收敛到 0.1mm 内) ---
  for (let round = 0; round < 2; round++) {
    let maxRes = 0;
    for (const gt of girthTargets) {
      const g1 = girthAt(mesh, gt.key, lastLength, H).length;
      const residual = gt.target - g1;
      maxRes = Math.max(maxRes, Math.abs(residual));
      if (Math.abs(residual) >= 0.1) girthScale(gt.key, residual, false);
    }
    if (maxRes < 0.1) break;
  }
  mesh.invalidateGrid();
}
