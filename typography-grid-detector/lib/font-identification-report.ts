import {
  pickBestLibraryFamily,
  pickTopLibraryCandidate
} from "@/lib/font-library-match";
import { librarySlotIndex } from "@/lib/library-slot";

export type FontIdentificationBlock = {
  index: number;
  /** 字体家族名 + 粗细/样式（展示列） */
  font_name: string;
  /** 本地库字符串匹配 + 可选：模型视觉相似度说明 */
  similarity: string;
  /** 在画面中的区域描述 */
  position: string;
  /** 字号（pt） */
  size_pt: number;
  /** 主色 #RRGGBB：优先前端采样，失败可回落模型 ink_color_hex */
  color_hex?: string;
  /** 模型估计的墨色（未采样时的参考） */
  model_ink_hex?: string;
  /** 建议用途 */
  usage: string;
  bbox: [number, number, number, number];
};

export type FontIdentificationReport = {
  disclaimer_zh: string;
  blocks: FontIdentificationBlock[];
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** 根据归一化 [0,1] 或像素 bbox 生成中文区域描述 */
export function describeBBoxRegion(
  x: number,
  y: number,
  w: number,
  h: number,
  normalized: boolean
): string {
  if (!normalized) {
    return `约 x=${Math.round(x)} y=${Math.round(y)}，宽 ${Math.round(w)}px × 高 ${Math.round(
      h
    )}px（与模型返回坐标系一致，可与原图像素对照）`;
  }

  const x2 = x + w;
  const y2 = y + h;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const horiz =
    w >= 0.55
      ? "通栏"
      : cx < 0.36
        ? "偏左"
        : cx > 0.64
          ? "偏右"
          : "居中";
  const vert = cy < 0.28 ? "上" : cy > 0.62 ? "下" : "中";
  const span = `横向约 ${pct(x)}～${pct(x2)}、纵向约 ${pct(y)}～${pct(y2)}（相对整图）`;

  if (w >= 0.7) {
    return `画面${vert}部${horiz}（${span}）`;
  }
  return `画面${vert}部、${horiz}区域；${span}`;
}

function formatSimilarity(
  modelFamily: string,
  libraryNames: readonly string[],
  pick: ReturnType<typeof pickBestLibraryFamily>,
  top: ReturnType<typeof pickTopLibraryCandidate>,
  visualNote?: string
): string {
  let local: string;
  if (!libraryNames.length) {
    local =
      "未提供本地字体库：请在侧栏「同步 Windows 字体」或上传字体后重新分析，以便对照本机已安装名称。";
  } else {
    const p = Math.round(pick.score * 100);
    const pt = Math.round(top.topScore * 100);
    if (pick.fromLibrary) {
      if (pick.score >= 0.92) {
        local = `与本地库「${pick.family}」高度匹配（名称相似度约 ${p}%），可作安装参考。`;
      } else {
        local = `接近本地库「${pick.family}」（相似度约 ${p}%），已优先采用该本地名称。`;
      }
    } else if (top.topName && top.topScore >= 0.25) {
      local = `无法与本地库精确对齐「${modelFamily}」；最接近：**${top.topName}**（名称相似度约 ${pt}%）。`;
    } else if (top.topName && top.topScore > 0) {
      local = `本地库弱相关「${top.topName}」（约 ${pt}%）；「${modelFamily}」请人工核对。`;
    } else {
      local = `本地库中无相近名称；保留识别名「${modelFamily}」。`;
    }
  }

  const v = visualNote?.trim();
  if (v) {
    return `${local} **视觉判断**：${v}`;
  }
  return local;
}

export type FontRowInput = {
  family: string;
  size_pt: number;
  weight: string;
  usage: string;
  bbox: [number, number, number, number];
  visual_similarity_zh?: string;
  ink_color_hex?: string;
  region_label_zh?: string;
};

function normalizeHex(h: string | undefined): string | undefined {
  if (!h || typeof h !== "string") return undefined;
  const t = h.trim();
  const m = t.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!m) return undefined;
  return `#${m[1]!.toUpperCase()}`;
}

export function fontsBboxLikelyNormalized(
  fonts: readonly { bbox: readonly [number, number, number, number] }[]
): boolean {
  let maxR = 0;
  let maxB = 0;
  for (const f of fonts) {
    const [x, y, w, h] = f.bbox;
    maxR = Math.max(maxR, x + w);
    maxB = Math.max(maxB, y + h);
  }
  return maxR > 0 && maxR <= 1.02 && maxB <= 1.02;
}

export type FontIdentificationMode = "api" | "local_library_only";

/**
 * 由 fonts 数组生成结构化字体识别表。
 */
export function buildFontIdentificationReport(
  fonts: FontRowInput[],
  libraryNames: readonly string[],
  options: {
    normalizedBBox: boolean;
    mode: FontIdentificationMode;
  }
): FontIdentificationReport {
  const disclaimer_zh =
    options.mode === "local_library_only"
      ? "【无 API · 仅本地字库】`fonts[].family` 来自侧栏列表，各区块按**质数步长**在整库中**分散选取**（避免字库按字母排序时总落在 A 开头几项）；**不做**字形识别。「相似度」列说明与字库条目的绑定。有 API 时，服务端会对**字库全部名称**做相似度比对（同分时不再总偏向字母序最前）。主色为 bbox 采样。"
      : "下列条目由 **OpenAI GPT-4o 多模态**（云端 API）结合图像推断。「相似度」列 = 侧栏本地字体库**名称匹配** + 模型给出的**视觉相似度描述**（若有）。主色优先为浏览器**像素采样**，必要时参考模型 `ink_color_hex`。";

  const blocks: FontIdentificationBlock[] = fonts.map((f, index) => {
    const [bx, by, bw, bh] = f.bbox;
    const region = f.region_label_zh?.trim();
    const boxDesc = describeBBoxRegion(bx, by, bw, bh, options.normalizedBBox);
    const position = region ? `${region}（${boxDesc}）` : boxDesc;
    const modelInk = normalizeHex(f.ink_color_hex);

    let font_name: string;
    let similarity: string;
    if (options.mode === "local_library_only") {
      font_name = `${f.family} · ${f.weight}`.trim();
      const n = libraryNames.length;
      const slotIdx = n > 0 ? librarySlotIndex(index, n) : 0;
      const slotHint =
        n > 0
          ? `（字库共 ${n} 项，本块按分散规则对应排序第 ${slotIdx + 1} 项）`
          : "";
      similarity = `**仅本地对照**：本示意区块当前绑定字库名称「${f.family}」。${slotHint} 非画面内实测字体，请自行与海报比对。`;
    } else {
      const pick = pickBestLibraryFamily(f.family, libraryNames);
      const top = pickTopLibraryCandidate(f.family, libraryNames);
      const display = pick.fromLibrary ? pick.family : f.family;
      font_name = `${display} · ${f.weight}`.trim();
      similarity = formatSimilarity(
        f.family,
        libraryNames,
        pick,
        top,
        f.visual_similarity_zh
      );
    }

    return {
      index: index + 1,
      font_name,
      similarity,
      position,
      size_pt: f.size_pt,
      model_ink_hex: modelInk,
      usage: f.usage,
      bbox: f.bbox
    };
  });

  return { disclaimer_zh, blocks };
}

/** 合并前端采样的颜色到报告块（按索引对齐） */
export function mergeColorsIntoReport(
  report: FontIdentificationReport,
  colors: (string | undefined)[]
): FontIdentificationReport {
  return {
    ...report,
    blocks: report.blocks.map((b, i) => ({
      ...b,
      color_hex: colors[i] ?? b.model_ink_hex ?? b.color_hex
    }))
  };
}
