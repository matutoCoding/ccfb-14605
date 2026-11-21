// ---------- 三角网格核心:邻接、截面、光顺、最近点 ----------
import * as THREE from 'three';

export class MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  /** 顶点 -> 邻接顶点 */
  vAdj: number[][] = [];
  /** 顶点 -> 邻接三角形 */
  vTris: number[][] = [];
  /** 边(key "a_b", a<b) -> 三角形列表 */
  edgeTris: Map<string, number[]> = new Map();

  constructor(positions: Float32Array, indices: Uint32Array) {
    this.positions = positions;
    this.indices = indices;
    this.buildAdjacency();
  }

  get triCount() { return this.indices.length / 3; }
  get vertCount() { return this.positions.length / 3; }

  buildAdjacency() {
    const nv = this.vertCount;
    this.vAdj = Array.from({ length: nv }, () => []);
    this.vTris = Array.from({ length: nv }, () => []);
    this.edgeTris.clear();
    const adjSet: Set<number>[] = Array.from({ length: nv }, () => new Set());
    for (let t = 0; t < this.triCount; t++) {
      const a = this.indices[t * 3], b = this.indices[t * 3 + 1], c = this.indices[t * 3 + 2];
      adjSet[a].add(b); adjSet[a].add(c);
      adjSet[b].add(a); adjSet[b].add(c);
      adjSet[c].add(a); adjSet[c].add(b);
      this.vTris[a].push(t); this.vTris[b].push(t); this.vTris[c].push(t);
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const key = p < q ? `${p}_${q}` : `${q}_${p}`;
        let arr = this.edgeTris.get(key);
        if (!arr) { arr = []; this.edgeTris.set(key, arr); }
        arr.push(t);
      }
    }
    for (let i = 0; i < nv; i++) this.vAdj[i] = [...adjSet[i]];
  }

  v(i: number, out: THREE.Vector3) { return out.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]); }

  /** 拉普拉斯光顺;mask 为 null 时光顺全部,边界/特征点可固定 */
  smooth(iterations: number, lambda = 0.5, mask: Uint8Array | null = null) {
    const p = this.positions;
    const tmp = new Float32Array(p.length);
    for (let it = 0; it < iterations; it++) {
      tmp.set(p);
      for (let i = 0; i < this.vertCount; i++) {
        if (mask && !mask[i]) continue;
        const nb = this.vAdj[i];
        if (!nb.length) continue;
        let ax = 0, ay = 0, az = 0;
        for (const j of nb) { ax += p[j * 3]; ay += p[j * 3 + 1]; az += p[j * 3 + 2]; }
        const n = nb.length;
        tmp[i * 3]     = p[i * 3]     + lambda * (ax / n - p[i * 3]);
        tmp[i * 3 + 1] = p[i * 3 + 1] + lambda * (ay / n - p[i * 3 + 1]);
        tmp[i * 3 + 2] = p[i * 3 + 2] + lambda * (az / n - p[i * 3 + 2]);
      }
      p.set(tmp);
    }
  }

  /**
   * 平面截网格:返回若干条折线(每条为交点数组)。
   * point 平面上一点, normal 平面法向。
   */
  planeSection(point: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3[][] {
    const p = this.positions, idx = this.indices;
    const lines: THREE.Vector3[][] = [];
    // 每条边与平面求交,交点按三角形串联
    const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const edgeHit = new Map<string, THREE.Vector3>();
    const d = (i: number) => p[i * 3] * normal.x + p[i * 3 + 1] * normal.y + p[i * 3 + 2] * normal.z
      - (point.x * normal.x + point.y * normal.y + point.z * normal.z);
    for (let t = 0; t < this.triCount; t++) {
      const tri = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
      const ds = tri.map(d);
      const hits: THREE.Vector3[] = [];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const da = ds[e], db = ds[(e + 1) % 3];
        if ((da < 0 && db < 0) || (da > 0 && db > 0)) continue;
        const key = edgeKey(a, b);
        let pt = edgeHit.get(key);
        if (!pt) {
          const tt = da / (da - db);
          pt = new THREE.Vector3(
            p[a * 3] + (p[b * 3] - p[a * 3]) * tt,
            p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * tt,
            p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * tt);
          edgeHit.set(key, pt);
        }
        if (!hits.some(h => h.distanceToSquared(pt!) < 1e-12)) hits.push(pt);
      }
      if (hits.length >= 2) lines.push([hits[0], hits[1]]);
    }
    // 串联线段为折线
    return chainSegments(lines);
  }

  /** 点到网格最近点(均匀网格加速)。返回 {point, tri, bary} */
  closestPoint(target: THREE.Vector3, cellHint = 0): { point: THREE.Vector3; tri: number; dist: number } {
    if (!this._grid || (cellHint > 0 && cellHint !== this._gridCell)) this.buildGrid(cellHint || undefined);
    const g = this._grid!;
    const cs = this._gridCell;
    const ci = Math.floor((target.x - g.min.x) / cs);
    const cj = Math.floor((target.y - g.min.y) / cs);
    const ck = Math.floor((target.z - g.min.z) / cs);
    let best: THREE.Vector3 | null = null, bestTri = -1, bestD = Infinity;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const cp = new THREE.Vector3();
    // 逐层扩大搜索邻域
    for (let ring = 1; ring <= Math.max(g.nx, g.ny, g.nz); ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          for (let k = ck - ring; k <= ck + ring; k++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== ring) continue;
            if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
            const cell = g.cells[i + g.nx * (j + g.ny * k)];
            if (!cell) continue;
            for (const t of cell) {
              this.v(this.indices[t * 3], va); this.v(this.indices[t * 3 + 1], vb); this.v(this.indices[t * 3 + 2], vc);
              closestPointTriangle(target, va, vb, vc, cp);
              const dd = cp.distanceToSquared(target);
              if (dd < bestD) { bestD = dd; bestTri = t; best = (best ?? new THREE.Vector3()).copy(cp); }
            }
          }
        }
      }
      // 当前环已找到点且距离小于到环边界的可能距离即可停
      if (best && bestD <= (ring * cs) * (ring * cs)) break;
    }
    return { point: best ?? target.clone(), tri: bestTri, dist: Math.sqrt(bestD) };
  }

  private _grid: { min: THREE.Vector3; nx: number; ny: number; nz: number; cells: (number[] | null)[] } | null = null;
  private _gridCell = 0;
  buildGrid(cellSize?: number) {
    const p = this.positions;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < this.vertCount; i++) {
      min.x = Math.min(min.x, p[i * 3]); min.y = Math.min(min.y, p[i * 3 + 1]); min.z = Math.min(min.z, p[i * 3 + 2]);
      max.x = Math.max(max.x, p[i * 3]); max.y = Math.max(max.y, p[i * 3 + 1]); max.z = Math.max(max.z, p[i * 3 + 2]);
    }
    const diag = max.distanceTo(min);
    const cs = cellSize && cellSize > 0 ? cellSize : diag / 40;
    const nx = Math.max(1, Math.ceil((max.x - min.x) / cs) + 1);
    const ny = Math.max(1, Math.ceil((max.y - min.y) / cs) + 1);
    const nz = Math.max(1, Math.ceil((max.z - min.z) / cs) + 1);
    const cells: (number[] | null)[] = new Array(nx * ny * nz).fill(null);
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const tmin = new THREE.Vector3(), tmax = new THREE.Vector3();
    for (let t = 0; t < this.triCount; t++) {
      this.v(this.indices[t * 3], va); this.v(this.indices[t * 3 + 1], vb); this.v(this.indices[t * 3 + 2], vc);
      tmin.min(va).min(vb).min(vc); tmax.copy(va).max(vb).max(vc);
      const i0 = Math.max(0, Math.floor((tmin.x - min.x) / cs)), i1 = Math.min(nx - 1, Math.floor((tmax.x - min.x) / cs));
      const j0 = Math.max(0, Math.floor((tmin.y - min.y) / cs)), j1 = Math.min(ny - 1, Math.floor((tmax.y - min.y) / cs));
      const k0 = Math.max(0, Math.floor((tmin.z - min.z) / cs)), k1 = Math.min(nz - 1, Math.floor((tmax.z - min.z) / cs));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const c = i + nx * (j + ny * k);
        (cells[c] ??= []).push(t);
      }
    }
    this._grid = { min, nx, ny, nz, cells };
    this._gridCell = cs;
  }

  invalidateGrid() { this._grid = null; }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setIndex(new THREE.BufferAttribute(this.indices, 1));
    g.computeVertexNormals();
    return g;
  }
}

/** 点到三角形最近点(Christer Ericson) */
export function closestPointTriangle(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);
  const bp = new THREE.Vector3().subVectors(p, b);
  const d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return out.copy(a).addScaledVector(ab, d1 / (d1 - d3));
  const cpp = new THREE.Vector3().subVectors(p, c);
  const d5 = ab.dot(cpp), d6 = ac.dot(cpp);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return out.copy(a).addScaledVector(ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return out.copy(b).addScaledVector(new THREE.Vector3().subVectors(c, b), w);
  }
  const denom = 1 / (va + vb + vc);
  return out.copy(a).addScaledVector(ab, vb * denom).addScaledVector(ac, vc * denom);
}

/** 把零散线段串成折线 */
export function chainSegments(segs: THREE.Vector3[][]): THREE.Vector3[][] {
  const used = new Array(segs.length).fill(false);
  const chains: THREE.Vector3[][] = [];
  const eps2 = 1e-8;
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    const chain = [segs[s][0].clone(), segs[s][1].clone()];
    let extended = true;
    while (extended) {
      extended = false;
      for (let t = 0; t < segs.length; t++) {
        if (used[t]) continue;
        const [a, b] = segs[t];
        const head = chain[0], tail = chain[chain.length - 1];
        if (tail.distanceToSquared(a) < eps2) { chain.push(b.clone()); }
        else if (tail.distanceToSquared(b) < eps2) { chain.push(a.clone()); }
        else if (head.distanceToSquared(b) < eps2) { chain.unshift(a.clone()); }
        else if (head.distanceToSquared(a) < eps2) { chain.unshift(b.clone()); }
        else continue;
        used[t] = true; extended = true;
      }
    }
    chains.push(chain);
  }
  return chains;
}

/** 折线长度 */
export function polylineLength(pts: ArrayLike<THREE.Vector3> | number[][]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = (pts as any)[i - 1], b = (pts as any)[i];
    const dx = (b.x ?? b[0]) - (a.x ?? a[0]);
    const dy = (b.y ?? b[1]) - (a.y ?? a[1]);
    const dz = ((b.z ?? b[2]) ?? 0) - ((a.z ?? a[2]) ?? 0);
    L += Math.hypot(dx, dy, dz);
  }
  return L;
}
