// ---------- 放码:中国鞋号 / 欧码 ----------
import { MeshData } from './mesh';
import { applyDeform } from './deform';
import { girthAt, lastHeightOf } from './measure';
import { zeroParams, type GradingRule, type LastParams } from '../types';

export interface GradedSize {
  label: string;          // 码号
  delta: number;          // 相对中码的档数
  positions: Float32Array;
  ballGirth: number;      // 实测跖围
  ballGirthTarget: number;
  length: number;
}

/** 中国鞋号系列(毫米脚长) */
export const CN_SIZES = [220, 225, 230, 235, 240, 245, 250, 255, 260];
/** 欧码系列 */
export const EU_SIZES = [35, 36, 37, 38, 39, 40, 41, 42];

/**
 * 整套放码:以中码为基准,长度沿 X 缩放(后跟点为原点),围度走修型参数。
 * 返回每码的楦体顶点与实测跖围(用于和设定档差核对)。
 */
export function gradeAll(
  base: Float32Array,
  indices: Uint32Array,
  baseParams: LastParams,
  rule: GradingRule,
  sizes: number[],
  midIndex: number,
  baseBallGirth: number,
  lastLength: number,
): GradedSize[] {
  const results: GradedSize[] = [];
  for (let i = 0; i < sizes.length; i++) {
    const d = i - midIndex;
    const mesh = new MeshData(new Float32Array(base), indices);
    // 长度档:绕后跟点(x=0)缩放
    const L1 = lastLength + d * rule.lengthStep;
    const kx = L1 / lastLength;
    for (let v = 0; v < mesh.vertCount; v++) mesh.positions[v * 3] *= kx;
    const scaled = new Float32Array(mesh.positions);
    // 围度档:跖围/跗围同步放
    const params: LastParams = { ...baseParams };
    params.ballGirth = (params.ballGirth ?? 0) + d * rule.girthStep;
    params.instepGirth = (params.instepGirth ?? 0) + d * rule.girthStep;
    params.heelGirth = (params.heelGirth ?? 0) + d * rule.girthStep * 0.7;
    applyDeform(mesh, scaled, params, L1);
    const H = lastHeightOf(mesh);
    const ball = girthAt(mesh, 'ballGirth', L1, H).length;
    results.push({
      label: rule.system === 'CN' ? `${sizes[i]}` : `${sizes[i]}码`,
      delta: d,
      positions: mesh.positions,
      ballGirth: ball,
      ballGirthTarget: baseBallGirth + d * rule.girthStep,
      length: L1,
    });
  }
  return results;
}
