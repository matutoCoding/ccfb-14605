// ---------- 数据模型 ----------

/** 楦体修型参数(单位 mm / 度) */
export interface LastParams {
  ballGirth: number;    // 跖围增减量 mm
  instepGirth: number;  // 跗围增减量 mm
  heelGirth: number;    // 兜跟围增减量 mm
  toeSpring: number;    // 前跷增减 mm(前尖抬升)
  heelLift: number;     // 后跷增减 mm(后跟抬升)
  topWidth: number;     // 统口宽增减 mm
}

export const zeroParams = (): LastParams => ({
  ballGirth: 0, instepGirth: 0, heelGirth: 0,
  toeSpring: 0, heelLift: 0, topWidth: 0,
});

/** 楦体特征点(摆正后的楦坐标系:X=长向朝前尖, Y=宽向, Z=朝上) */
export interface LastFeatures {
  heelPoint: [number, number, number];   // 后跟点(楦底最后端)
  toePoint: [number, number, number];    // 前尖点
  length: number;                        // 楦底长 mm
  bottomCurve: number[][];               // 楦底中线断面点 [x,z][]
  bottomOutline: number[][];             // 楦底样板曲线(俯视轮廓) [x,y][]
}

/** 存储的楦型记录 */
export interface LastRecord {
  id: string;
  name: string;
  createdAt: number;
  positions: Float32Array;   // 摆正后的顶点
  indices: Uint32Array;
  params: LastParams;        // 当前修型量(相对导入状态)
  features: LastFeatures;
}

/** 帮面线条类型 → 默认工艺量 */
export type LineKind = '口门线' | '鞋舌线' | '后帮中缝' | '底口线' | '接缝线' | '切口线' | '辅助线';

export const LINE_KINDS: LineKind[] = ['口门线', '鞋舌线', '后帮中缝', '底口线', '接缝线', '切口线', '辅助线'];

/** 各线条类型的默认工艺量 mm:折边/压茬/绷帮 */
export function allowanceOf(kind: LineKind): { type: '折边' | '压茬' | '绷帮' | '无'; mm: number } {
  switch (kind) {
    case '口门线': return { type: '折边', mm: 5 };
    case '鞋舌线': return { type: '折边', mm: 5 };
    case '后帮中缝': return { type: '压茬', mm: 8 };
    case '接缝线': return { type: '压茬', mm: 8 };
    case '底口线': return { type: '绷帮', mm: 15 };
    default: return { type: '无', mm: 0 };
  }
}

export interface SurfaceLine {
  id: string;
  kind: LineKind;
  points: number[][];  // 贴在楦面上的样条采样点 [x,y,z][]
}

/** 展平后的一片裁片 */
export interface PatternPiece {
  id: string;
  name: string;
  triIds: number[];        // 源网格三角形
  uv: Float32Array;        // 展平坐标(与 positions 顶点一一对应,仅区域内有效)
  outline: number[][];     // 净样轮廓 [u,v]
  cutOutline: number[][];  // 加工艺量后的裁片轮廓
  notches: number[][];     // 对位刀口 [u,v][]
  maxStretch: number;      // 最大伸长率
  maxCompress: number;     // 最大压缩率
  roundTripErr: number;    // 贴回误差 mm
}

export interface PatternRecord {
  id: string;
  lastId: string;
  name: string;
  createdAt: number;
  lines: SurfaceLine[];
  pieces: PatternPiece[];
}

/** 试穿反馈热点 */
export interface FittingRecord {
  id: string;
  lastId: string;
  size: string;            // 码数 如 "240" / "38"
  kind: '顶脚' | '磨跟' | '压背' | '挤趾' | '空跟';
  position: [number, number, number];
  createdAt: number;
}

/** 放码规则 */
export interface GradingRule {
  system: 'CN' | 'EU';
  lengthStep: number;  // 长度档差 mm/码
  girthStep: number;   // 围度档差 mm/码
}

export const CN_RULE: GradingRule = { system: 'CN', lengthStep: 5, girthStep: 3.5 };
export const EU_RULE: GradingRule = { system: 'EU', lengthStep: 6.67, girthStep: 4 };

/** 标准测量站位(沿楦底长比例,从后跟点起) */
export const STATIONS = [
  { key: 'ballGirth',   label: '跖围',   t: 0.68 },
  { key: 'instepGirth', label: '跗围',   t: 0.52 },
  { key: 'heelGirth',   label: '兜跟围', t: 0.18 },
] as const;
