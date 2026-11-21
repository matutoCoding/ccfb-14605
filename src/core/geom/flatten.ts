// ---------- 贴楦展平:LSCM 保角参数化 + 变形分析 + 工艺量 ----------
import * as THREE from 'three';
import { MeshData, polylineLength } from './mesh';

export interface FlattenResult {
  uv: Map<number, [number, number]>;   // 顶点 → 平面坐标
  tris: number[];                      // 区域三角形
  boundary: number[];                  // 有序边界顶点环
  stretch: Float32Array;               // 每三角形最大伸长率(小数)
  compress: Float32Array;              // 每三角形最大压缩率(小数)
}

/** 区域边界环(取最长环,按三角形定向串联) */
export function regionBoundary(mesh: MeshData, triSet: Set<number>): number[] {
  const edgeCount = new Map<string, [number, number]>();
  const add = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const e = edgeCount.get(key);
    if (e) e[1]++;
    else edgeCount.set(key, [a, 1]);
  };
  // 记录有向边:以三角形内出现方向为准
  const directed = new Map<number, number>();
  for (const t of triSet) {
    const tri = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const rec = edgeCount.get(key);
      if (rec) rec[1]++;
      else edgeCount.set(key, [a, 1]);
      if (!directed.has(a)) directed.set(a, b);
    }
  }
  // 边界边 = 只出现一次的边
  const next = new Map<number, number>();
  for (const t of triSet) {
    const tri = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (edgeCount.get(key)![1] === 1) next.set(a, b);
    }
  }
  if (!next.size) return [];
  // 串成环(可能多环,取最长)
  const starts = [...next.keys()];
  let best: number[] = [];
  const visited = new Set<number>();
  for (const s of starts) {
    if (visited.has(s)) continue;
    const loop = [s];
    visited.add(s);
    let cur = s;
    while (next.has(cur)) {
      cur = next.get(cur)!;
      if (cur === s || visited.has(cur)) break; // 闭环或非流形顶点都停
      loop.push(cur);
      visited.add(cur);
    }
    if (loop.length > best.length) best = loop;
  }
  return best;
}

/**
 * LSCM 保角展开(Lévy et al. 2002)。
 * 固定边界上相距最远的两个顶点,共轭梯度解最小二乘。
 */
export function flattenRegion(mesh: MeshData, triIds: number[]): FlattenResult {
  const triSet = new Set(triIds);
  // 局部顶点编号
  const vset = new Set<number>();
  for (const t of triIds) for (let k = 0; k < 3; k++) vset.add(mesh.indices[t * 3 + k]);
  const verts = [...vset];
  const local = new Map<number, number>();
  verts.forEach((v, i) => local.set(v, i));
  const n = verts.length;

  // 每三角形局部 2D 坐标(贴到三角形自身平面)
  const triLocal: { lv: number[]; x: number[]; y: number[] }[] = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (const t of triIds) {
    const ia = mesh.indices[t * 3], ib = mesh.indices[t * 3 + 1], ic = mesh.indices[t * 3 + 2];
    mesh.v(ia, va); mesh.v(ib, vb); mesh.v(ic, vc);
    e1.subVectors(vb, va).normalize();
    nrm.subVectors(vc, va).cross(e1).normalize();
    e2.crossVectors(nrm, e1);
    const xs = [0, e1.dot(tmp.subVectors(vb, va)), e1.dot(tmp.subVectors(vc, va))];
    const ys = [0, 0, e2.dot(tmp.subVectors(vc, va))];
    triLocal.push({ lv: [local.get(ia)!, local.get(ib)!, local.get(ic)!], x: xs, y: ys });
  }

  // 边界环,找相距最远的两个边界顶点做固定点
  const boundary = regionBoundary(mesh, triSet);
  let pinA = boundary[0] ?? verts[0], pinB = boundary[1] ?? verts[1];
  let maxD = -1;
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  for (let i = 0; i < boundary.length; i += Math.max(1, boundary.length >> 5)) {
    for (let j = i + 1; j < boundary.length; j += Math.max(1, boundary.length >> 5)) {
      mesh.v(boundary[i], pa); mesh.v(boundary[j], pb);
      const d = pa.distanceToSquared(pb);
      if (d > maxD) { maxD = d; pinA = boundary[i]; pinB = boundary[j]; }
    }
  }
  mesh.v(pinA, pa); mesh.v(pinB, pb);
  const pinDist = pa.distanceTo(pb);
  const fixed = new Map<number, [number, number]>();
  fixed.set(local.get(pinA)!, [0, 0]);
  fixed.set(local.get(pinB)!, [pinDist, 0]);

  // 自由未知量编号
  const freeId = new Int32Array(n).fill(-1);
  let nf = 0;
  for (let i = 0; i < n; i++) if (!fixed.has(i)) freeId[i] = nf++;
  const N = nf * 2;

  // 每三角形系数 a_i = (y_{i+1}-y_{i-1})/W, b_i = -(x_{i+1}-x_{i-1})/W
  interface TC { idx: number[]; a: number[]; b: number[]; w: number }
  const tcs: TC[] = [];
  for (const tl of triLocal) {
    const [x1, x2, x3] = tl.x, [y1, y2, y3] = tl.y;
    const W = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (Math.abs(W) < 1e-12) continue;
    const a = [(y2 - y3) / W, (y3 - y1) / W, (y1 - y2) / W];
    const b = [(x3 - x2) / W, (x1 - x3) / W, (x2 - x1) / W];
    tcs.push({ idx: tl.lv, a, b, w: Math.abs(W) / 2 });
  }

  // H = AᵀA 的隐式 matvec(仅自由变量),并预计算固定点贡献 c
  // 能量行:r1 = Σ a_i u_i - Σ b_i v_i ; r2 = Σ b_i u_i + Σ a_i v_i,权重 w
  const c = new Float64Array(N);
  for (const tc of tcs) {
    // 固定点贡献到 r
    let r1f = 0, r2f = 0;
    for (let k = 0; k < 3; k++) {
      const f = fixed.get(tc.idx[k]);
      if (f) { r1f += tc.a[k] * f[0] - tc.b[k] * f[1]; r2f += tc.b[k] * f[0] + tc.a[k] * f[1]; }
    }
    if (r1f === 0 && r2f === 0) continue;
    for (let k = 0; k < 3; k++) {
      const g = tc.idx[k];
      const id = freeId[g];
      if (id < 0) continue;
      c[id * 2] += tc.w * (tc.a[k] * r1f + tc.b[k] * r2f);
      c[id * 2 + 1] += tc.w * (-tc.b[k] * r1f + tc.a[k] * r2f);
    }
  }
  const matvec = (x: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (const tc of tcs) {
      let r1 = 0, r2 = 0;
      for (let k = 0; k < 3; k++) {
        const g = tc.idx[k];
        const id = freeId[g];
        let u: number, v: number;
        if (id >= 0) { u = x[id * 2]; v = x[id * 2 + 1]; }
        else { const f = fixed.get(g)!; u = f[0]; v = f[1]; }
        r1 += tc.a[k] * u - tc.b[k] * v;
        r2 += tc.b[k] * u + tc.a[k] * v;
      }
      r1 *= tc.w; r2 *= tc.w;
      for (let k = 0; k < 3; k++) {
        const id = freeId[tc.idx[k]];
        if (id < 0) continue;
        out[id * 2] += tc.a[k] * r1 + tc.b[k] * r2;
        out[id * 2 + 1] += -tc.b[k] * r1 + tc.a[k] * r2;
      }
    }
  };

  // 共轭梯度解 H x = -c
  const x = new Float64Array(N);
  const r = new Float64Array(N), d = new Float64Array(N), q = new Float64Array(N);
  for (let i = 0; i < N; i++) { r[i] = -c[i]; d[i] = r[i]; }
  let rsold = dot(r, r);
  for (let iter = 0; iter < 4000 && rsold > 1e-14; iter++) {
    matvec(d, q);
    const dq = dot(d, q);
    if (Math.abs(dq) < 1e-30) break;
    const alpha = rsold / dq;
    for (let i = 0; i < N; i++) { x[i] += alpha * d[i]; r[i] -= alpha * q[i]; }
    const rsnew = dot(r, r);
    if (rsnew < 1e-14) break;
    const beta = rsnew / rsold;
    for (let i = 0; i < N; i++) d[i] = r[i] + beta * d[i];
    rsold = rsnew;
  }

  const uv = new Map<number, [number, number]>();
  for (let i = 0; i < n; i++) {
    const id = freeId[i];
    if (id >= 0) uv.set(verts[i], [x[id * 2], x[id * 2 + 1]]);
    else uv.set(verts[i], fixed.get(i)!);
  }

  // 变形分析:每三角形雅可比奇异值
  const stretch = new Float32Array(triIds.length);
  const compress = new Float32Array(triIds.length);
  for (let ti = 0; ti < tcs.length; ti++) {
    const tc = tcs[ti];
    const [g0, g1, g2] = tc.idx.map(g => verts[g]);
    const [u1, v1] = uv.get(g0)!, [u2, v2] = uv.get(g1)!, [u3, v3] = uv.get(g2)!;
    // dU/dX = Σ a_i u_i, dU/dY = Σ b_i u_i
    const dudx = tc.a[0] * u1 + tc.a[1] * u2 + tc.a[2] * u3;
    const dudy = tc.b[0] * u1 + tc.b[1] * u2 + tc.b[2] * u3;
    const dvdx = tc.a[0] * v1 + tc.a[1] * v2 + tc.a[2] * v3;
    const dvdy = tc.b[0] * v1 + tc.b[1] * v2 + tc.b[2] * v3;
    // J = [[dudx, dudy],[dvdx, dvdy]],奇异值
    const m = dudx * dudx + dvdx * dvdx;
    const n2 = dudx * dudy + dvdx * dvdy;
    const p = dudy * dudy + dvdy * dvdy;
    const tr = m + p;
    const det = m * p - n2 * n2;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const s1 = Math.sqrt(Math.max(1e-12, tr / 2 + disc));
    const s2 = Math.sqrt(Math.max(1e-12, tr / 2 - disc));
    stretch[ti] = Math.max(0, s1 - 1);
    compress[ti] = Math.max(0, 1 - s2);
  }
  return { uv, tris: triIds, boundary, stretch, compress };
}

function dot(a: Float64Array, b: Float64Array) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

/**
 * 按切口线把区域拆片:切口经过的网格边被封死,洪泛分成多组。
 */
export function splitRegionByCut(mesh: MeshData, triIds: number[], cut: THREE.Vector3[], tol = 2): number[][] {
  if (cut.length < 2) return [triIds];
  const triSet = new Set(triIds);
  // 找出与切口相交的边
  const blocked = new Set<string>();
  const seg = new THREE.Vector3(), e0 = new THREE.Vector3(), e1 = new THREE.Vector3();
  for (const t of triIds) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.indices[t * 3 + e], b = mesh.indices[t * 3 + ((e + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (blocked.has(key)) continue;
      mesh.v(a, e0); mesh.v(b, e1);
      for (let s = 0; s < cut.length - 1; s++) {
        if (segSegDist(e0, e1, cut[s], cut[s + 1]) < tol) { blocked.add(key); break; }
      }
    }
  }
  // 洪泛
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const t0 of triIds) {
    if (seen.has(t0)) continue;
    const group: number[] = [];
    const stack = [t0];
    seen.add(t0);
    while (stack.length) {
      const t = stack.pop()!;
      group.push(t);
      for (let e = 0; e < 3; e++) {
        const a = mesh.indices[t * 3 + e], b = mesh.indices[t * 3 + ((e + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (blocked.has(key)) continue;
        for (const nt of mesh.edgeTris.get(key) ?? []) {
          if (triSet.has(nt) && !seen.has(nt)) { seen.add(nt); stack.push(nt); }
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function segSegDist(p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3): number {
  // 简化:采样中点距离
  const m1 = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const m2 = new THREE.Vector3().addVectors(p3, p4).multiplyScalar(0.5);
  const d1 = pointSegDist(p3, p1, p2), d2 = pointSegDist(p4, p1, p2);
  const d3 = pointSegDist(p1, p3, p4), d4 = pointSegDist(p2, p3, p4);
  return Math.min(d1, d2, d3, d4, m1.distanceTo(m2));
}

function pointSegDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0, 1);
  return new THREE.Vector3().copy(a).addScaledVector(ab, t).distanceTo(p);
}

/**
 * 回贴精度验证:把三维测量线(在区域内)映射到展平面,
 * 比较三维线长与二维线长,返回最大误差 mm。
 */
export function roundTripError(mesh: MeshData, flat: FlattenResult, lines3D: THREE.Vector3[][]): number {
  const triSet = new Set(flat.tris);
  let maxErr = 0;
  for (const line of lines3D) {
    const uvPts: [number, number][] = [];
    let ok = true;
    for (const pt of line) {
      const cp = mesh.closestPoint(pt);
      if (cp.tri < 0 || !triSet.has(cp.tri)) { ok = false; break; }
      // 重心坐标
      const t = cp.tri;
      const ids = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
      const bary = barycentric(mesh, pt, t);
      const uv0 = flat.uv.get(ids[0])!, uv1 = flat.uv.get(ids[1])!, uv2 = flat.uv.get(ids[2])!;
      uvPts.push([
        bary[0] * uv0[0] + bary[1] * uv1[0] + bary[2] * uv2[0],
        bary[0] * uv0[1] + bary[1] * uv1[1] + bary[2] * uv2[1],
      ]);
    }
    if (!ok || uvPts.length < 2) continue;
    const l3 = polylineLength(line);
    const l2 = polylineLength(uvPts);
    maxErr = Math.max(maxErr, Math.abs(l3 - l2));
  }
  return maxErr;
}

export function barycentric(mesh: MeshData, p: THREE.Vector3, t: number): [number, number, number] {
  const a = mesh.v(mesh.indices[t * 3], new THREE.Vector3());
  const b = mesh.v(mesh.indices[t * 3 + 1], new THREE.Vector3());
  const c = mesh.v(mesh.indices[t * 3 + 2], new THREE.Vector3());
  const v0 = new THREE.Vector3().subVectors(b, a);
  const v1 = new THREE.Vector3().subVectors(c, a);
  const v2 = new THREE.Vector3().subVectors(p, a);
  const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1);
  const d20 = v2.dot(v0), d21 = v2.dot(v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-20) return [1, 0, 0];
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}

/**
 * 轮廓加工艺量偏移(米特尔 join)。
 * pts: 有序轮廓(闭合,不含重复末点);allow: 每点偏移量 mm(向外为正)。
 */
export function offsetOutline(pts: number[][], allow: number[]): number[][] {
  const n = pts.length;
  // 统一为逆时针,保证 (dy,-dx) 是外法向
  const ccw = signedArea(pts) > 0;
  const P = ccw ? pts : [...pts].reverse();
  const A = ccw ? allow : [...allow].reverse();
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const prev = P[(i - 1 + n) % n], cur = P[i], next = P[(i + 1) % n];
    const e1 = norm2(cur[0] - prev[0], cur[1] - prev[1]);
    const e2 = norm2(next[0] - cur[0], next[1] - cur[1]);
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    const mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const mLen2 = mx * mx + my * my;
    if (mLen2 < 1e-8) { out.push([cur[0] + n1[0] * A[i], cur[1] + n1[1] * A[i]]); continue; }
    // 米特尔:offset = m * allow / |m|²,限制尖角放大倍数 ≤ 3
    const k = Math.min(3, 1 / mLen2) * A[i];
    out.push([cur[0] + mx * k, cur[1] + my * k]);
  }
  return ccw ? out : out.reverse();
}

function norm2(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

export function signedArea(pts: number[][]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
