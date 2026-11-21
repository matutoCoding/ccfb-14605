// ---------- 楦型导入:OBJ/STL 解析、自动摆正、特征点与楦底曲线 ----------
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshData, chainSegments, polylineLength } from './mesh';
import type { LastFeatures } from '../types';

export function parseLastFile(name: string, buf: ArrayBuffer): MeshData {
  let geom: THREE.BufferGeometry;
  if (/\.stl$/i.test(name)) {
    geom = new STLLoader().parse(buf);
  } else if (/\.obj$/i.test(name)) {
    const text = new TextDecoder().decode(buf);
    const obj = new OBJLoader().parse(text);
    let found: THREE.BufferGeometry | null = null;
    obj.traverse(o => { if ((o as THREE.Mesh).isMesh && !found) found = (o as THREE.Mesh).geometry; });
    if (!found) throw new Error('OBJ 中没有网格');
    geom = found;
  } else {
    throw new Error('仅支持 OBJ / STL');
  }
  // 统一为索引网格
  const g = geom.index ? geom : mergeVertices(geom);
  const pos = g.getAttribute('position');
  const positions = new Float32Array(pos.array as Float32Array);
  const indices = g.index
    ? new Uint32Array(g.index.array)
    : new Uint32Array([...Array(pos.count).keys()]);
  return new MeshData(positions, indices);
}

/** 简单按坐标合并重复顶点(STL 是三角汤) */
function mergeVertices(geom: THREE.BufferGeometry, tol = 1e-4): THREE.BufferGeometry {
  const pos = geom.getAttribute('position');
  const map = new Map<string, number>();
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x / tol)}_${Math.round(y / tol)}_${Math.round(z / tol)}`;
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(x, y, z); }
    idx.push(id);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

/**
 * 自动摆正:
 * 1. PCA 主轴 → 长轴对齐 X
 * 2. 底面判定:在垂直长轴平面内,选"低处点最平"的方向为 -Z(楦底朝下)
 * 3. 前后判定:两端截面周长小的一端为前尖(+X)
 * 返回摆正后的网格与特征点。
 */
export function autoOrient(mesh: MeshData): LastFeatures {
  const p = mesh.positions;
  const n = mesh.vertCount;
  // 质心
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  // 协方差
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const dx = p[i * 3] - cx, dy = p[i * 3 + 1] - cy, dz = p[i * 3 + 2] - cz;
    xx += dx * dx; xy += dx * dy; xz += dx * dz;
    yy += dy * dy; yz += dy * dz; zz += dz * dz;
  }
  const cov = new THREE.Matrix3().set(xx, xy, xz, xy, yy, yz, xz, yz, zz);
  const [e1, e2, e3] = eigenSym3(cov); // 按特征值降序
  // 旋转到主轴系
  const R = new THREE.Matrix4().makeBasis(e1, e2, e3);
  if (new THREE.Matrix3().setFromMatrix4(R).determinant() < 0) e3.negate(); // 保持右手系
  const Rt = new THREE.Matrix4().copy(R).invert(); // 主轴→世界 的逆 = 世界→主轴
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(p[i * 3] - cx, p[i * 3 + 1] - cy, p[i * 3 + 2] - cz).applyMatrix4(Rt);
    p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
  }
  // 现在 X=最长轴。找底面:统计 ±Z 低端 10% 点的平面度,底侧更平
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) { zmin = Math.min(zmin, p[i * 3 + 2]); zmax = Math.max(zmax, p[i * 3 + 2]); }
  const planarity = (lo: boolean) => {
    const zs: number[] = [];
    const th = lo ? zmin + (zmax - zmin) * 0.1 : zmax - (zmax - zmin) * 0.1;
    for (let i = 0; i < n; i++) { const z = p[i * 3 + 2]; if (lo ? z <= th : z >= th) zs.push(z); }
    if (zs.length < 10) return Infinity;
    const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
    return zs.reduce((a, b) => a + (b - mean) ** 2, 0) / zs.length;
  };
  if (planarity(false) < planarity(true)) {
    for (let i = 0; i < n; i++) p[i * 3 + 2] = -p[i * 3 + 2]; // 翻转 Z,让底朝下
    [zmin, zmax] = [-zmax, -zmin];
  }
  // 前后判定:比较两端 10% 区域的截面周长,小的是前尖
  let xmin = Infinity, xmax = -Infinity;
  for (let i = 0; i < n; i++) { xmin = Math.min(xmin, p[i * 3]); xmax = Math.max(xmax, p[i * 3]); }
  const endPerimeter = (atMin: boolean) => {
    const x0 = atMin ? xmin + (xmax - xmin) * 0.08 : xmax - (xmax - xmin) * 0.08;
    const chains = mesh.planeSection(new THREE.Vector3(x0, 0, 0), new THREE.Vector3(1, 0, 0));
    return chains.reduce((a, c) => a + polylineLength(c), 0);
  };
  if (endPerimeter(false) < endPerimeter(true)) {
    for (let i = 0; i < n; i++) p[i * 3] = -p[i * 3]; // 前尖朝 +X
    [xmin, xmax] = [-xmax, -xmin];
  }
  // 平移:后跟点 x=0,楦底 z=0,宽向居中
  let ymin = Infinity, ymax = -Infinity;
  zmin = Infinity;
  for (let i = 0; i < n; i++) {
    ymin = Math.min(ymin, p[i * 3 + 1]); ymax = Math.max(ymax, p[i * 3 + 1]);
    zmin = Math.min(zmin, p[i * 3 + 2]);
  }
  const ymid = (ymin + ymax) / 2;
  for (let i = 0; i < n; i++) { p[i * 3] -= xmin; p[i * 3 + 1] -= ymid; p[i * 3 + 2] -= zmin; }
  mesh.invalidateGrid();
  return extractFeatures(mesh);
}

/** 提取后跟点、前尖点、楦底中线断面、楦底样板轮廓 */
export function extractFeatures(mesh: MeshData): LastFeatures {
  const p = mesh.positions, n = mesh.vertCount;
  let xmax = -Infinity;
  for (let i = 0; i < n; i++) xmax = Math.max(xmax, p[i * 3]);
  // 楦底中线:竖直中面 Y=0 与楦底交线的下缘
  const centerChains = mesh.planeSection(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
  // 取最长的一条作为中剖线
  centerChains.sort((a, b) => polylineLength(b) - polylineLength(a));
  const centerLine = centerChains[0] ?? [];
  // 下缘点(每 x 取最小 z)
  const bottomCurve: number[][] = centerLine.map(pt => [pt.x, pt.z]);
  // 后跟点:中剖线上 x 最小且 z 接近 0 的点
  let heel = new THREE.Vector3(0, 0, 0);
  let best = Infinity;
  for (const pt of centerLine) {
    const score = pt.x + pt.z * 2;
    if (score < best) { best = score; heel = pt.clone(); }
  }
  // 前尖点:x 最大处附近的点
  let toe = new THREE.Vector3(xmax, 0, 0);
  best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(p[i * 3] - xmax) + Math.abs(p[i * 3 + 1]) * 0.5;
    if (d < best) { best = d; toe.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); }
  }
  // 楦底样板曲线:水平面 z = 1mm 处截面外轮廓(俯视)
  const outlineChains = mesh.planeSection(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1));
  outlineChains.sort((a, b) => polylineLength(b) - polylineLength(a));
  const bottomOutline = (outlineChains[0] ?? []).map(pt => [pt.x, pt.y]);
  return {
    heelPoint: [heel.x, heel.y, heel.z],
    toePoint: [toe.x, toe.y, toe.z],
    length: xmax,
    bottomCurve,
    bottomOutline,
  };
}

/** 对称 3x3 矩阵特征向量(Jacobi 迭代),返回按特征值降序的三个单位向量 */
function eigenSym3(m: THREE.Matrix3): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  let a = [[m.elements[0], m.elements[1], m.elements[2]],
           [m.elements[3], m.elements[4], m.elements[5]],
           [m.elements[6], m.elements[7], m.elements[8]]];
  let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 50; iter++) {
    // 找最大非对角元
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { p = 0; q = 2; max = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > max) { p = 1; q = 2; max = Math.abs(a[1][2]); }
    if (max < 1e-10) break;
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
    }
  }
  const eig = [0, 1, 2].map(i => ({ val: a[i][i], vec: new THREE.Vector3(v[0][i], v[1][i], v[2][i]) }));
  eig.sort((x, y) => y.val - x.val);
  return [eig[0].vec, eig[1].vec, eig[2].vec];
}
