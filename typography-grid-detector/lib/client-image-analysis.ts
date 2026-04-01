/**
 * 浏览器端对上传图做轻量级版式粗测（无云端 API）：
 * 二值化 + 连通域 → 疑似文字块 bbox；竖向投影 → 粗估列数。
 * 复杂底纹/照片/低对比度时误差大，仅作辅助。
 */

export type HeuristicLayoutResult = {
  columns: number;
  gutter_px: number;
  grid_system: string;
  /** 原图像素坐标 [x,y,w,h] */
  boxes: [number, number, number, number][];
};

const MAX_SIDE = 520;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** 从字库名粗猜字重（与 route 逻辑一致） */
export function inferWeightFromLibraryName(name: string): string {
  const n = name.toLowerCase();
  if (/black|heavy/.test(n)) return "Black";
  if (/bold/.test(n)) return "Bold";
  if (/semibold|demi/.test(n)) return "Semibold";
  if (/medium/.test(n)) return "Medium";
  if (/light|thin/.test(n)) return "Light";
  if (/italic|oblique/.test(n)) return "Italic";
  return "Regular";
}

type Rect = { x: number; y: number; w: number; h: number; cy: number };

function mergeLineBoxes(boxes: Rect[]): Rect[] {
  if (boxes.length === 0) return [];
  const sorted = [...boxes].sort((a, b) => a.cy - b.cy || a.x - b.x);
  const out: Rect[] = [{ ...sorted[0]! }];

  const vOverlap = (a: Rect, b: Rect) => {
    const t = Math.max(a.y, b.y);
    const bot = Math.min(a.y + a.h, b.y + b.h);
    return Math.max(0, bot - t);
  };

  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i]!;
    const last = out[out.length - 1]!;
    const ov = vOverlap(last, b);
    const mh = Math.min(last.h, b.h);
    const sameLine =
      mh > 2 &&
      ov > 0.45 * mh &&
      Math.abs(last.cy - b.cy) < 0.45 * mh &&
      b.x - (last.x + last.w) < Math.max(14, 0.02 * (last.w + b.w));

    if (sameLine) {
      const nx = Math.min(last.x, b.x);
      const ny = Math.min(last.y, b.y);
      const nr = Math.max(last.x + last.w, b.x + b.w) - nx;
      const nb = Math.max(last.y + last.h, b.y + b.h) - ny;
      last.x = nx;
      last.y = ny;
      last.w = nr;
      last.h = nb;
      last.cy = last.y + last.h / 2;
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/**
 * 对 <img> 当前帧做粗测；失败返回 null。
 */
export function inferLayoutFromUploadedImage(
  img: HTMLImageElement
): HeuristicLayoutResult | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;

  const scale = Math.min(1, MAX_SIDE / Math.max(nw, nh));
  const rw = Math.max(32, Math.round(nw * scale));
  const rh = Math.max(32, Math.round(nh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = rw;
  canvas.height = rh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.drawImage(img, 0, 0, rw, rh);
  } catch {
    return null;
  }

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, rw, rh);
  } catch {
    return null;
  }

  const d = data.data;
  const lum = new Float32Array(rw * rh);
  let sum = 0;
  for (let i = 0, p = 0; i < rw * rh; i++, p += 4) {
    const L = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    lum[i] = L;
    sum += L;
  }
  const mean = sum / (rw * rh);
  /** 深字浅底：墨迹偏暗 */
  const ink = new Uint8Array(rw * rh);
  const thresh = mean > 110 ? mean - 28 : mean + 28;
  let inkCount = 0;
  for (let i = 0; i < rw * rh; i++) {
    if (mean > 110 ? lum[i]! < thresh : lum[i]! > thresh) {
      ink[i] = 1;
      inkCount++;
    }
  }
  if (inkCount < 80 || inkCount > rw * rh * 0.72) return null;

  const labels = new Int32Array(rw * rh);
  const stack: number[] = [];
  type BBox = { minX: number; maxX: number; minY: number; maxY: number; n: number };
  const bbs: BBox[] = [];
  let label = 0;

  for (let idx = 0; idx < ink.length; idx++) {
    if (!ink[idx] || labels[idx]) continue;
    label++;
    stack.length = 0;
    stack.push(idx);
    labels[idx] = label;
    let minX = rw,
      maxX = 0,
      minY = rh,
      maxY = 0,
      n = 0;

    while (stack.length) {
      const cur = stack.pop()!;
      const x = cur % rw;
      const y = (cur / rw) | 0;
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const w = cur - 1;
        if (ink[w] && !labels[w]) {
          labels[w] = label;
          stack.push(w);
        }
      }
      if (x + 1 < rw) {
        const e = cur + 1;
        if (ink[e] && !labels[e]) {
          labels[e] = label;
          stack.push(e);
        }
      }
      if (y > 0) {
        const nidx = cur - rw;
        if (ink[nidx] && !labels[nidx]) {
          labels[nidx] = label;
          stack.push(nidx);
        }
      }
      if (y + 1 < rh) {
        const s = cur + rw;
        if (ink[s] && !labels[s]) {
          labels[s] = label;
          stack.push(s);
        }
      }
    }

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const area = n;
    const ar = w / Math.max(1, h);
    const imgArea = rw * rh;
    if (
      area < 120 ||
      area > imgArea * 0.38 ||
      w < 4 ||
      h < 6 ||
      ar > 48 ||
      h / Math.max(1, w) > 24
    ) {
      continue;
    }
    bbs.push({ minX, maxX, minY, maxY, n: area });
  }

  if (bbs.length === 0) return null;

  bbs.sort((a, b) => b.n - a.n);
  const top = bbs.slice(0, 36);

  const rects: Rect[] = top.map((b) => {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    return {
      x: b.minX,
      y: b.minY,
      w,
      h,
      cy: b.minY + h / 2
    };
  });

  const merged = mergeLineBoxes(rects);
  merged.sort((a, b) => a.cy - b.cy || a.x - b.x);

  const invS = 1 / scale;
  const boxes: [number, number, number, number][] = merged.map((r) => [
    Math.round(r.x * invS),
    Math.round(r.y * invS),
    Math.round(r.w * invS),
    Math.round(r.h * invS)
  ]);

  /** 竖向墨迹投影，估 gutter 与列数 */
  const colSum = new Float64Array(rw);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (ink[y * rw + x]) colSum[x] += 1;
    }
  }
  const win = 5;
  const smooth = new Float64Array(rw);
  for (let x = 0; x < rw; x++) {
    let s = 0;
    let c = 0;
    for (let dx = -win; dx <= win; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < rw) {
        s += colSum[xx]!;
        c++;
      }
    }
    smooth[x] = s / c;
  }
  let mx = 0;
  for (let x = 0; x < rw; x++) if (smooth[x]! > mx) mx = smooth[x]!;
  const valleyTh = mx * 0.22;
  const valleys: number[] = [];
  for (let x = 2; x < rw - 2; x++) {
    if (
      smooth[x]! < valleyTh &&
      smooth[x]! <= smooth[x - 1]! &&
      smooth[x]! <= smooth[x + 1]!
    ) {
      if (
        valleys.length === 0 ||
        x - valleys[valleys.length - 1]! > rw * 0.04
      ) {
        valleys.push(x);
      }
    }
  }

  const valleyColumns = clamp(valleys.length + 1, 1, 12);

  /** 用文字块几何估计栏数：排除通栏超宽块后，对 x 中心排序，大间隙视为分栏 */
  function median(nums: number[]): number {
    if (nums.length === 0) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  }

  const colCandidates = merged.filter((r) => r.w < rw * 0.44);
  let blockColumns = 1;
  let blockGutterScaled = 0;
  if (colCandidates.length >= 2) {
    const centers = colCandidates
      .map((r) => r.x + r.w / 2)
      .sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < centers.length; i++) {
      gaps.push(centers[i]! - centers[i - 1]!);
    }
    const medG = median(gaps);
    const splitTh = Math.max(rw * 0.048, medG * 2.6);
    let splits = 0;
    const betweenColGaps: number[] = [];
    for (const g of gaps) {
      if (g > splitTh) {
        splits++;
        betweenColGaps.push(g);
      }
    }
    blockColumns = clamp(splits + 1, 1, 12);
    blockGutterScaled =
      betweenColGaps.length > 0 ? median(betweenColGaps) : medG;
  }

  /** 块几何与竖向投影互相校验：差异大时更信任块几何（对海报/UI 更稳） */
  let columns = blockColumns;
  if (colCandidates.length >= 3 && Math.abs(blockColumns - valleyColumns) <= 1) {
    columns = Math.round((blockColumns + valleyColumns) / 2);
  } else if (colCandidates.length >= 3) {
    columns = blockColumns;
  } else {
    columns = valleyColumns;
  }
  columns = clamp(columns, 1, 12);

  let gutter_px = 0;
  if (columns > 1) {
    const fromBlocks =
      blockGutterScaled > 0
        ? Math.round(blockGutterScaled * invS)
        : Math.round(clamp((nw / columns) * 0.055, 8, 120));
    const fromValley = Math.round(clamp((nw / columns) * 0.06, 8, 96));
    gutter_px = Math.round(
      colCandidates.length >= 3 ? fromBlocks * 0.65 + fromValley * 0.35 : fromValley
    );
    gutter_px = clamp(gutter_px, 6, 160);
  }

  const grid_system = `本机粗测 · 主内容约 ${columns} 栏（块 x 中心间隙 + 竖向墨迹谷值交叉验证），栏间 gutter≈${gutter_px}px；检出 ${boxes.length} 个文字连通域。复杂底纹/反色/摄影背景时仅供参考，配 API 可获专业网格解读。`;

  return { columns, gutter_px, grid_system, boxes };
}
