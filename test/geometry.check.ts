// 几何核心自检:展平回贴精度 + 放码档差一致性
// 运行: npx tsx test/geometry.check.ts
import * as THREE from 'three';
import { MeshData, polylineLength } from '../src/core/geom/mesh';
import { flattenRegion, roundTripError } from '../src/core/geom/flatten';
import { gradeAll, CN_SIZES } from '../src/core/geom/grading';
import { CN_RULE, zeroParams } from '../src/core/types';
import { girthAt, lastHeightOf } from '../src/core/geom/measure';
import { applyDeform } from '../src/core/geom/deform';

/** 程序化测试楦:长 250mm,截面为半椭圆,平底 */
function makeLast(L = 250, nx = 60, nv = 24): MeshData {
  const width = (t: number) => 34 * Math.sin(Math.PI * Math.min(1, 0.15 + 0.85 * t)) ** 0.6 * (1 - 0.35 * t * t);
  const height = (t: number) => 20 + 45 * Math.sin(Math.PI * t) ** 1.2 * (1 - 0.5 * t);
  const pos: number[] = [];
  const idx: number[] = [];
  // 侧表面:参数 (i 沿长, j 沿截面半椭圆 + 底边)
  for (let i = 0; i <= nx; i++) {
    const t = i / nx;
    const x = t * L;
    const w = width(t), h = height(t);
    for (let j = 0; j <= nv; j++) {
      const a = (j / nv) * Math.PI; // 0..π:从外侧底边经背脊到内侧底边
      const y = Math.cos(a) * w;
      const z = Math.sin(a) * h;
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
  // 底面扇形(简单三角扇到每行中点)
  return new MeshData(new Float32Array(pos), new Uint32Array(idx));
}

function sectionLine(mesh: MeshData, x: number): THREE.Vector3[] {
  const chains = mesh.planeSection(new THREE.Vector3(x, 0, 0), new THREE.Vector3(1, 0, 0));
  return chains.sort((a, b) => polylineLength(b) - polylineLength(a))[0] ?? [];
}

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
}

// ---- 1. 展平回贴精度:圆柱形(可展)区域应远小于 0.5mm ----
{
  const mesh = makeLast();
  // 取中段一条区域(接近可展面)
  const region: number[] = [];
  const p = mesh.positions;
  for (let t = 0; t < mesh.triCount; t++) {
    const cx = (p[mesh.indices[t * 3] * 3] + p[mesh.indices[t * 3 + 1] * 3] + p[mesh.indices[t * 3 + 2] * 3]) / 3;
    const cy = (p[mesh.indices[t * 3 + 1] * 3 + 1] + p[mesh.indices[t * 3 + 1] * 3 + 1] + p[mesh.indices[t * 3 + 2] * 3 + 1]) / 3;
    if (cx > 90 && cx < 160 && cy > -10 && cy < 30) region.push(t);
  }
  const flat = flattenRegion(mesh, region);
  // 区域内测量线:两条截面线 + 一条纵线
  const lines = [sectionLine(mesh, 110), sectionLine(mesh, 140)];
  const err = roundTripError(mesh, flat, lines);
  check('展平回贴误差 ≤0.5mm', err <= 0.5, `误差 ${err.toFixed(3)}mm (${region.length} 三角形)`);
}

// ---- 2. 修型:跖围 +5mm 应体现在测量上 ----
{
  const mesh = makeLast();
  const base = new Float32Array(mesh.positions);
  const L = 250, H = lastHeightOf(mesh);
  const g0 = girthAt(mesh, 'ballGirth', L, H).length;
  const params = zeroParams();
  params.ballGirth = 5;
  applyDeform(mesh, base, params, L);
  const g1 = girthAt(mesh, 'ballGirth', L, lastHeightOf(mesh)).length;
  const dev = Math.abs(g1 - g0 - 5);
  check('跖围 +5mm 修型到位(±0.6mm)', dev <= 0.6, `目标 +5.00 实际 +${(g1 - g0).toFixed(2)}`);
}

// ---- 3. 放码:跖围档差与设定一致 ----
{
  const mesh = makeLast();
  const base = new Float32Array(mesh.positions);
  const L = 250;
  const baseBall = girthAt(mesh, 'ballGirth', L, lastHeightOf(mesh)).length;
  const graded = gradeAll(base, mesh.indices, zeroParams(), CN_RULE, CN_SIZES, 4, baseBall, L);
  let maxDev = 0;
  for (const g of graded) maxDev = Math.max(maxDev, Math.abs(g.ballGirth - g.ballGirthTarget));
  check('整套放码跖围档差一致(±0.8mm)', maxDev <= 0.8, `最大偏差 ${maxDev.toFixed(2)}mm`);
  const lens = graded.map(g => g.length);
  const stepOk = lens.every((l, i) => i === 0 || Math.abs(l - lens[i - 1] - CN_RULE.lengthStep) < 1e-6);
  check('长度档差 = 5mm/码', stepOk, lens.map(l => l.toFixed(1)).join(' '));
}

process.exit(failures ? 1 : 0);
