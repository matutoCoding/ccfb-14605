// ---------- 会话状态:当前楦型 ----------
import { MeshData } from './geom/mesh';
import { db } from './db';
import type { LastRecord } from './types';

export interface LastSession {
  record: LastRecord;
  mesh: MeshData;            // 当前(含修型)网格
  basePositions: Float32Array; // 导入摆正后的原始顶点
}

let current: LastSession | null = null;

export async function loadLast(id: string): Promise<LastSession | null> {
  const rec = await db.getLast(id);
  if (!rec) return null;
  const positions = rec.positions instanceof Float32Array ? rec.positions : new Float32Array(rec.positions);
  const indices = rec.indices instanceof Uint32Array ? rec.indices : new Uint32Array(rec.indices);
  current = {
    record: rec,
    mesh: new MeshData(new Float32Array(positions), indices),
    basePositions: new Float32Array(positions),
  };
  // 应用已保存的修型参数
  if (rec.params) {
    const { applyDeform } = await import('./geom/deform');
    applyDeform(current.mesh, current.basePositions, rec.params, rec.features.length);
  }
  return current;
}

export function setCurrentLast(rec: LastRecord) {
  current = {
    record: rec,
    mesh: new MeshData(new Float32Array(rec.positions), rec.indices),
    basePositions: new Float32Array(rec.positions),
  };
}

export function getLast(): LastSession | null { return current; }

export async function persistParams() {
  if (!current) return;
  await db.saveLast(current.record);
}
