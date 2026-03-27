/**
 * 在模型给出的粗 bbox 内，按像素亮度收紧到更接近字形墨色外沿。
 * 使用 ROI 内亮度分位数估阈值，避免「边框全是字」时背景均值失真。
 */
export function tightenGlyphBoxes(
  img: HTMLImageElement,
  boxes: readonly [number, number, number, number][]
): [number, number, number, number][] {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h || boxes.length === 0) return [...boxes];

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [...boxes];

  ctx.drawImage(img, 0, 0);
  let full: ImageData;
  try {
    full = ctx.getImageData(0, 0, w, h);
  } catch {
    return [...boxes];
  }
  const d = full.data;

  const getLum = (px: number, py: number) => {
    const i = (py * w + px) * 4;
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  };

  return boxes.map(([bx, by, bw, bh]) => {
    if (bw < 2 || bh < 2) return [bx, by, bw, bh] as [number, number, number, number];

    const pad = Math.max(8, Math.round(Math.min(bw, bh) * 0.12));
    let x0 = Math.max(0, Math.floor(bx - pad));
    let y0 = Math.max(0, Math.floor(by - pad));
    let x1 = Math.min(w, Math.ceil(bx + bw + pad));
    let y1 = Math.min(h, Math.ceil(by + bh + pad));

    const lums: number[] = [];
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        lums.push(getLum(px, py));
      }
    }
    if (lums.length === 0) return [bx, by, bw, bh] as [number, number, number, number];

    lums.sort((a, b) => a - b);
    const q = (p: number) => lums[Math.min(lums.length - 1, Math.floor(p * (lums.length - 1)))];
    const q15 = q(0.15);
    const q50 = q(0.5);
    const q85 = q(0.85);
    /** 浅底深字：中位偏亮，墨色在低端 */
    const lightBackground = q50 > 95;
    let isInk: (px: number, py: number) => boolean;
    if (lightBackground) {
      const thresh = q15 + (q50 - q15) * 0.35;
      isInk = (px, py) => getLum(px, py) < thresh;
    } else {
      const thresh = q85 - (q85 - q50) * 0.35;
      isInk = (px, py) => getLum(px, py) > thresh;
    }

    let minX = x1;
    let minY = y1;
    let maxX = x0;
    let maxY = y0;
    let any = false;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (isInk(px, py)) {
          any = true;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }

    if (!any || minX > maxX || minY > maxY) {
      return [bx, by, bw, bh] as [number, number, number, number];
    }

    return [
      minX,
      minY,
      maxX - minX + 1,
      maxY - minY + 1
    ] as [number, number, number, number];
  });
}
