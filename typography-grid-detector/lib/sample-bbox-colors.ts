/**
 * 在 bbox 内估计文字主色 #RRGGBB（浏览器端）。
 * 内缩采样区、自动判断深字/浅字、对墨色像素取中位数，减轻背景与抗锯齿污染。
 */

function medianByte(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 将 bbox 各边内缩，减少框沿上的背景、描边与相邻色块。
 */
function shrinkBBox(
  x: number,
  y: number,
  w: number,
  h: number,
  iw: number,
  ih: number
): { x: number; y: number; w: number; h: number } {
  const inset = Math.max(
    1,
    Math.min(
      Math.floor(Math.min(w, h) * 0.1),
      Math.floor(Math.min(w, h) / 3)
    )
  );
  let nx = x + inset;
  let ny = y + inset;
  let nw = w - 2 * inset;
  let nh = h - 2 * inset;
  nx = Math.max(0, Math.min(nx, iw - 2));
  ny = Math.max(0, Math.min(ny, ih - 2));
  nw = Math.max(2, Math.min(nw, iw - nx));
  nh = Math.max(2, Math.min(nh, ih - ny));
  return { x: nx, y: ny, w: nw, h: nh };
}

export function sampleDominantInkColor(
  img: HTMLImageElement,
  bbox: readonly [number, number, number, number]
): string | undefined {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return undefined;

  let [x, y, w, h] = bbox;
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  w = Math.min(iw - x, Math.ceil(w));
  h = Math.min(ih - y, Math.ceil(h));
  if (w < 4 || h < 4) return undefined;

  const inner = shrinkBBox(x, y, w, h, iw, ih);
  x = inner.x;
  y = inner.y;
  w = inner.w;
  h = inner.h;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;

  let data: ImageData;
  try {
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return undefined;
  }

  const d = data.data;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 56));

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const lums: number[] = [];

  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
      const i = (py * w + px) * 4;
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      const L = luminance(r, g, b);
      rs.push(r);
      gs.push(g);
      bs.push(b);
      lums.push(L);
    }
  }

  if (lums.length < 4) return undefined;

  const sortedL = [...lums].sort((a, b) => a - b);
  const medL = sortedL[Math.floor(sortedL.length / 2)]!;

  /** 深字浅底：中位亮度偏高；浅字深底：中位亮度偏低 */
  const darkForeground = medL > 118;

  const pickInkMask = (loose: boolean): boolean[] => {
    const delta = loose ? 6 : 12;
    return lums.map((L) => {
      if (darkForeground) {
        return L < medL - delta && L < 245;
      }
      return L > medL + delta && L > 8;
    });
  };

  let mask = pickInkMask(false);
  let count = mask.filter(Boolean).length;
  if (count < 4) {
    mask = pickInkMask(true);
    count = mask.filter(Boolean).length;
  }
  if (count < 3) {
    /** 极低对比或渐变：取与背景中位数距离最大的约 35% 像素 */
    const dist = lums.map((L) => Math.abs(L - medL));
    const sortedD = [...dist].sort((a, b) => a - b);
    const cut = sortedD[Math.floor(sortedD.length * 0.65)]!;
    mask = dist.map((t) => t >= Math.max(cut, 18));
    count = mask.filter(Boolean).length;
  }
  if (count < 3) return undefined;

  const inkR: number[] = [];
  const inkG: number[] = [];
  const inkB: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    inkR.push(rs[i]!);
    inkG.push(gs[i]!);
    inkB.push(bs[i]!);
  }

  const toHex = (v: number) =>
    Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0");
  return `#${toHex(medianByte(inkR))}${toHex(medianByte(inkG))}${toHex(
    medianByte(inkB)
  )}`;
}
