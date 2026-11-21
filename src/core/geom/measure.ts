// ---------- 围度测量:标准测量线截面与围长 ----------
import * as THREE from 'three';
import { MeshData, polylineLength } from './mesh';
import { STATIONS } from '../types';

export interface GirthResult {
  key: string;
  label: string;
  length: number;            // 围长 mm
  chains: THREE.Vector3[][]; // 三维测量路径(画回楦面)
}

/**
 * 计算某站位的围度。
 * 跖围/跗围:垂直于楦底长轴的截面周长。
 * 兜跟围:过跟窝、斜向上绕跗面的斜截面(法向在 XZ 面内倾斜 50°)。
 */
export function girthAt(mesh: MeshData, key: string, lastLength: number, lastHeight: number): GirthResult {
  const st = STATIONS.find(s => s.key === key)!;
  let chains: THREE.Vector3[][];
  if (key === 'heelGirth') {
    // 兜跟围:过跟底后点与跗面高点连线、且包含宽向(Y)的斜截面
    const A = new THREE.Vector3(lastLength * 0.02, 0, lastHeight * 0.05);
    const B = new THREE.Vector3(lastLength * 0.55, 0, lastHeight * 0.8);
    const d = new THREE.Vector3().subVectors(B, A);
    const normal = new THREE.Vector3(d.z, 0, -d.x).normalize();
    chains = mesh.planeSection(A, normal);
  } else {
    const x = st.t * lastLength;
    chains = mesh.planeSection(new THREE.Vector3(x, 0, 0), new THREE.Vector3(1, 0, 0));
  }
  // 取最长闭合链为围长路径
  chains.sort((a, b) => polylineLength(b) - polylineLength(a));
  const main = chains.length ? [chains[0]] : [];
  const length = main.length ? polylineLength(main[0]) : 0;
  return { key: st.key, label: st.label, length, chains: main };
}

export function measureAll(mesh: MeshData, lastLength: number, lastHeight: number): GirthResult[] {
  return STATIONS.map(s => girthAt(mesh, s.key, lastLength, lastHeight));
}

export function lastHeightOf(mesh: MeshData): number {
  let zmax = 0;
  for (let i = 0; i < mesh.vertCount; i++) zmax = Math.max(zmax, mesh.positions[i * 3 + 2]);
  return zmax;
}
