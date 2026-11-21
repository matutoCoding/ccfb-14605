// ---------- 导出:裁片 DXF(激光裁床) / 楦体 STL(数控刻楦机) ----------
import { MeshData } from './mesh';

/** 多段闭合轮廓 + 刀口标记 → DXF(AC1015, LWPOLYLINE) */
export function exportDXF(pieces: { name: string; outline: number[][]; notches: number[][] }[]): string {
  let s = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n';
  s += '0\nSECTION\n2\nENTITIES\n';
  let yOff = 0;
  for (const piece of pieces) {
    // 每片竖向排开,避免重叠
    let minY = Infinity, maxY = -Infinity;
    for (const p of piece.outline) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const dy = yOff - minY;
    yOff = yOff + (maxY - minY) + 20;
    s += lwPolyline(piece.outline.map(p => [p[0], p[1] + dy]), true, 'CUT');
    // 刀口:2mm 小刻线
    for (const nt of piece.notches) {
      s += lwPolyline([[nt[0] - 1, nt[1] + dy], [nt[0] + 1, nt[1] + dy]], false, 'NOTCH');
    }
    // 片名文字
    s += `0\nTEXT\n8\nLABEL\n10\n${piece.outline[0]?.[0] ?? 0}\n20\n${(piece.outline[0]?.[1] ?? 0) + dy}\n40\n5\n1\n${piece.name}\n`;
  }
  s += '0\nENDSEC\n0\nEOF\n';
  return s;
}

function lwPolyline(pts: number[][], closed: boolean, layer: string): string {
  let s = `0\nLWPOLYLINE\n8\n${layer}\n90\n${pts.length}\n70\n${closed ? 1 : 0}\n`;
  for (const p of pts) s += `10\n${p[0].toFixed(4)}\n20\n${p[1].toFixed(4)}\n`;
  return s;
}

/** 二进制 STL */
export function exportSTL(mesh: MeshData): ArrayBuffer {
  const n = mesh.triCount;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  const p = mesh.positions, idx = mesh.indices;
  let off = 84;
  for (let t = 0; t < n; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true);
    dv.setFloat32(off + 12, p[a], true); dv.setFloat32(off + 16, p[a + 1], true); dv.setFloat32(off + 20, p[a + 2], true);
    dv.setFloat32(off + 24, p[b], true); dv.setFloat32(off + 28, p[b + 1], true); dv.setFloat32(off + 32, p[b + 2], true);
    dv.setFloat32(off + 36, p[c], true); dv.setFloat32(off + 40, p[c + 1], true); dv.setFloat32(off + 44, p[c + 2], true);
    dv.setUint16(off + 48, 0, true);
    off += 50;
  }
  return buf;
}

export function downloadFile(name: string, data: string | ArrayBuffer, mime = 'application/octet-stream') {
  const blob = data instanceof ArrayBuffer ? new Blob([data], { type: mime }) : new Blob([data], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
