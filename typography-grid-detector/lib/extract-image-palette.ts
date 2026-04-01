/**
 * 从整图按像素统计量化分箱，按覆盖面积（像素数）递减提取主色 #RRGGBB。
 * 仅浏览器端；会忽略近透明像素。
 */

function toHex(n: number): string {
  return Math.min(255, Math.max(0, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorDist(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number }
): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * @param maxColors 返回颜色数上限
 * @param maxSide 长边缩小到此像素以内再统计，平衡速度与准确度
 */
export function extractPaletteByPixelArea(
  img: HTMLImageElement,
  maxColors = 12,
  maxSide = 200
): string[] {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return [];

  const scale = Math.min(1, maxSide / Math.max(nw, nh));
  const rw = Math.max(1, Math.round(nw * scale));
  const rh = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = rw;
  canvas.height = rh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  try {
    ctx.drawImage(img, 0, 0, rw, rh);
  } catch {
    return [];
  }

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, rw, rh);
  } catch {
    return [];
  }

  const d = data.data;
  const total = rw * rh;
  /** 4 bit/通道 → 4096 箱，累计面积与颜色和 */
  const bins = new Map<
    string,
    { sr: number; sg: number; sb: number; n: number }
  >();

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    const a = d[i + 3]!;
    if (a < 14) continue;
    const qr = r >> 4;
    const qg = g >> 4;
    const qb = b >> 4;
    const key = `${qr},${qg},${qb}`;
    const cur = bins.get(key);
    if (cur) {
      cur.sr += r;
      cur.sg += g;
      cur.sb += b;
      cur.n++;
    } else {
      bins.set(key, { sr: r, sg: g, sb: b, n: 1 });
    }
  }

  const entries = [...bins.values()].map((v) => ({
    r: Math.round(v.sr / v.n),
    g: Math.round(v.sg / v.n),
    b: Math.round(v.sb / v.n),
    n: v.n
  }));
  entries.sort((a, b) => b.n - a.n);

  const minShare = Math.max(8, total * 0.00025);
  const minSep = 34;
  const out: string[] = [];

  for (const e of entries) {
    if (out.length >= maxColors) break;
    if (e.n < minShare) continue;
    let ok = true;
    for (const hex of out) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      if (colorDist(e, { r, g, b }) < minSep) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(rgbToHex(e.r, e.g, e.b));
  }

  return out;
}
