/**
 * 在 bbox 内采样偏暗像素（假定文字为前景），返回主色 #RRGGBB。仅浏览器可用。
 */
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
  if (w < 2 || h < 2) return undefined;

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
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 48));

  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
      const i = (py * w + px) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum < 185) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
    }
  }

  if (n < 3) {
    r = g = b = 0;
    n = 0;
    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const i = (py * w + px) * 4;
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
    }
  }

  if (n === 0) return undefined;
  const toHex = (v: number) =>
    Math.min(255, Math.round(v / n))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
