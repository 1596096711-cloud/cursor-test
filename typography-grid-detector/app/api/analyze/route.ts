import { NextRequest } from "next/server";
import { applyFontLibraryToFonts } from "@/lib/font-library-match";
import {
  mergeUserAndBuiltinFontNames,
  getBuiltinFontCatalogCount
} from "@/lib/font-catalog-merge";
import {
  refineFontFamiliesAgainstCatalog,
  getRefineModelFromEnv,
  isFontRefineEnabled
} from "@/lib/refine-fonts-openai";
import {
  buildFontIdentificationReport,
  fontsBboxLikelyNormalized,
  type FontIdentificationReport
} from "@/lib/font-identification-report";
import { librarySlotIndex } from "@/lib/library-slot";

export const runtime = "edge";

type OutputLocale = "zh" | "en";

/** 版式与网格的深度文字解读（中文，须结合画面具体描述） */
interface LayoutAnalysis {
  /** 从下列英文键中选 1～5 个最符合的：column_grid | modular_grid | baseline_grid | rule_of_thirds | golden_ratio | symmetrical_grid | hierarchical_grid | other */
  type_tags: string[];
  /** 判断使用了哪种网格系统（可多选混合），用清晰中文段落说明依据 */
  overview_zh: string;
  /** 列数、行（估算）、gutters、margins；关键对齐线；文字/图/色块如何贴线；是否有隐形辅助线或叠加网格层 */
  structure_zh: string;
  /** 是否体现三分法、黄金比≈1.618、黄金螺旋等；视觉焦点落在哪些交点或区域（结合位置描述） */
  composition_focal_zh: string;
  /** 网格如何支撑层级、平衡与视觉流动；优点与可改进点 */
  intent_critique_zh: string;
  /** 用「左上约 1/3」「中央垂直线偏右」等具体位置描述关键元素与网格关系 */
  spatial_labels_zh: string;
  /** 简单 ASCII 示意图（多行字符串，可用 + - | 表示区域） */
  ascii_diagram: string;
  /** 3～8 条要点列表，总结网格结构 */
  summary_bullets: string[];
}

// 严格定义返回 JSON 结构（与你提供的 Schema 对齐）
interface AnalyzeResponse {
  /** 无 OPENAI_API_KEY 时返回本地演示数据，不识别真实画面 */
  demo?: boolean;
  /** 配置了密钥但官方接口 403 地区限制时，已自动改用本地字库模式 */
  fallback_reason_zh?: string;
  grid_system: string;
  columns: number;
  gutter_px: number;
  /** 版式、网格类型、比例与意图的深度解读 */
  layout_analysis: LayoutAnalysis;
  fonts: {
    family: string;
    size_pt: number;
    weight: string;
    usage: string;
    bbox: [number, number, number, number];
    visual_similarity_zh?: string;
    ink_color_hex?: string;
    region_label_zh?: string;
  }[];
  line_spacing: {
    em: number;
    pt: number;
    baseline_grid: string;
  };
  other: {
    alignment: string;
    color_palette: string[];
    hierarchy_score: number;
  };
  /** 结构化字体识别表（本地库匹配 + 区域描述；颜色由前端采样） */
  font_identification?: FontIdentificationReport;
  /** 字体匹配池统计（用户字库 + 内置大全 + 是否经过二次 API 精校） */
  meta_font_matching?: {
    builtin_catalog_count: number;
    user_library_count: number;
    merged_pool_count: number;
    refine_pass_applied: boolean;
  };
}

/** 检测 OpenAI 官方「地区不支持」403（避免误把其它 403 当地区限制） */
function isOpenAIRegionBlockedError(message: string): boolean {
  if (!message) return false;
  if (message.includes("unsupported_country_region_territory")) return true;
  try {
    const idx = message.indexOf("{");
    if (idx < 0) return false;
    const j = JSON.parse(message.slice(idx)) as { error?: { code?: string } };
    return j?.error?.code === "unsupported_country_region_territory";
  } catch {
    return false;
  }
}

async function callGPT4o(
  imageUrlOrBase64: string,
  fileName: string | null,
  fontLibrary: { family: string }[] | undefined,
  builtinCatalogCount: number,
  imageDims: { width: number; height: number } | null | undefined,
  outputLocale: OutputLocale
): Promise<AnalyzeResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "未配置 OPENAI_API_KEY：请在项目根目录 .env.local 中设置密钥后重启开发服务。"
    );
  }

  const apiBase = (
    process.env.OPENAI_API_BASE || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o";

  const langRule =
    outputLocale === "en"
      ? "\n\n【Output language — CRITICAL】Write **every** descriptive string in **English** (same JSON keys, including fields ending in _zh — put English text inside them). fonts[].usage, region_label_zh, visual_similarity_zh, grid_system, layout_analysis paragraphs & bullets, line_spacing.baseline_grid note, other.alignment: all English. type_tags stay English snake_case as specified."
      : "\n\n【输出语言】所有自然语言说明须为**简体中文**（JSON 键名保持不变，含 *_zh 字段内仍为中文）。\n";

  const systemPrompt =
    langRule +
    "你是一位**专业字体识别、色彩取样与版式网格分析**专家（印刷/UI/海报）。只输出 JSON，禁止输出 JSON 以外的任何文字。" +
    "**字体**：逐字块比对——衬线形状、字碗 a/g/o、e 字腔、x-height、大写 O 圆度、数字 1/0、中西混排字面宽；区分 neo-grotesk / humanist / geometric sans、传统中文黑体/宋明/等线。" +
    "同一视觉字族不同字重：family **相同**，weight 区分。family 必须是**可检索的正式 PostScript/OTF 族级名称**；禁止「某种黑体」式含糊词。用户字库列表优先。" +
    "穷尽标题/副标/正文/按钮/导航/脚注/图注；**不要把 Logo 纯图形、图表数据区、装饰几何误报为 fonts[]**。" +
    "bbox [x,y,w,h] 为整像素、贴墨色外沿；西文含 ascender/descender，中文含下降笔画。" +
    "**颜色**：ink_color_hex 必须与肉眼主墨色一致；反白/深色底上的浅字勿填成 #000000；品牌色、链接色如实给出色相。" +
    "**网格（专业表述）**：columns = **主阅读区**稳定竖栏数（看主文左缘或块对齐组，不含偶然窄条广告）；单栏长文=1。" +
    "gutter_px = **相邻两栏文字块之间**典型空白像素（非页边距）；与给定图像像素尺度一致。" +
    "grid_system 一句话写清判据（如「双栏左对齐，gutter≈32px，通栏头尾」）。" +
    "layout_analysis 须体现**栏格 modular / 基线 rhythm / 三分或 φ 比例**等行业概念，并结合**具体元素贴线关系**，避免空泛套话。";

  const userLibList =
    fontLibrary && fontLibrary.length > 0
      ? fontLibrary.map((f) => f.family.trim()).filter(Boolean)
      : [];

  const fontLibBlock =
    (userLibList.length > 0
      ? "【用户本机/上传字体库】\n" +
        "下列名称来自用户上传或系统同步的字体文件（字体内嵌族名）。\n" +
        "推断 fonts[].family 时请**优先**向这些字符串靠拢；若画面明显不是其中任一款，再使用业界常见精确族名。\n" +
        JSON.stringify(userLibList) +
        "\n\n"
      : "") +
    `【内置通用字体名称库 · 约 ${builtinCatalogCount} 个】\n` +
    "服务端已将常见西文/中文开源与系统字体族名合并进匹配池（不在此逐条列出以节省 token）。\n" +
    "请为每个文字块给出**尽可能标准的字体族名**（如 Inter、Helvetica Neue、思源黑体、PingFang SC），避免含糊词如「无衬线黑体」不作正式族名。\n" +
    "fonts[].family 可先写视觉推测；随后服务端会用**全库模糊匹配** + **二次文本模型**从候选集中择名。\n\n";

  const dimBlock =
    imageDims &&
    imageDims.width > 0 &&
    imageDims.height > 0 &&
    Number.isFinite(imageDims.width) &&
    Number.isFinite(imageDims.height)
      ? `【图像像素尺寸】宽 ${Math.round(imageDims.width)} px × 高 ${Math.round(
          imageDims.height
        )} px。\n` +
        "fonts[].bbox 必须使用该分辨率下的**绝对像素坐标**（左上原点，x 右、y 下），勿使用 0~1 归一化。\n" +
        "columns、gutter_px、栏宽、边距等均在此像素尺度下估算。\n\n"
      : "";

  const userPrompt =
    dimBlock +
    fontLibBlock +
    "请根据提供的页面图像，以**字体识别专家**身份完成分析。\n\n" +
    "【fonts 数组 — 最重要】必须为每一块字填写下列字段：\n" +
    "1) family、weight、size_pt：家族名 + 粗细；size_pt 由**字高像素相对整图高度**换算为合理印刷/屏幕 pt（约 9–200），同图层级关系一致。\n" +
    "2) visual_similarity_zh：**必填**。用 1～2 句中文说明**视觉相似度**，例如「非常接近 Arial Black」「 neo-grotesk 无衬线，近似 Helvetica Neue Bold」「中文黑体，接近 微软雅黑 Bold」；若与用户字体库中某项名称明显对应，写明「可与库中 ×× 对照」。\n" +
    "3) region_label_zh：**必填**。用一句中文标出在图中的区域，如「海报顶部通栏主标题」「左下脚版权小号字」「右侧栏正文第二段」。\n" +
    "4) ink_color_hex：该块**肉眼主墨色** #RRGGBB（浅底深字/深底浅字均如实；渐变字取视觉重心色；勿一律 #000）。\n" +
    "5) usage：建议用途 + 该块**可见文字摘录**（约 8~20 字）。\n" +
    "6) bbox [x,y,w,h] 像素整数，紧贴字形外沿；多字体必须**拆成多条**，分别写清 region_label_zh。\n" +
    "7) 按阅读顺序排列（自上而下、从左到右）。\n\n" +
    "【网格 columns / gutter_px】\n" +
    "columns：统计**主内容区**内、左缘（或右缘）明显对齐的**竖栏条数**；通栏标题不单独加栏数。\n" +
    "gutter_px：取**相邻两栏文字块之间**典型水平间隙的像素值（可对照图像宽度校验合理性）。\n" +
    "若存在侧栏+主栏，说明主次栏宽比例（在 structure_zh 中）。不要无依据地把整图均分。\n\n" +
    "【layout_analysis — 必须输出】须用**清晰中文**写满下列字段，结合画面具体位置（如「左上约 1/3」「中央垂直参考线」）：\n" +
    "1) type_tags：从 column_grid | modular_grid | baseline_grid | rule_of_thirds | golden_ratio | symmetrical_grid | hierarchical_grid | other 中选 1～5 个标签。\n" +
    "2) overview_zh：判断属于哪种网格系统（可多选混合），例如规则列网格、模块化（行列区块）、基线网格、九宫格/三分法、黄金比例/φ 网格、对称网格、层级网格等。\n" +
    "3) structure_zh：须含**页边距约占版宽的大致百分比**、主栏宽与侧栏（若有）比例；列数、行带、gutter、关键垂直/水平对齐线；图/文/色块如何贴线；是否像 8px 或 4 的倍数 UI 步进。\n" +
    "4) composition_focal_zh：是否遵循三分法、黄金比例≈1.618、黄金螺旋等；视觉焦点落在哪些交点或区域。\n" +
    "5) intent_critique_zh：网格如何帮助信息层级、平衡与视觉流动；优点与潜在改进（可选）。\n" +
    "6) spatial_labels_zh：用具体方位描述关键元素与网格关系。\n" +
    "7) ascii_diagram：多行 ASCII 简单示意版面分区（可用 + - |）。\n" +
    "8) summary_bullets：字符串数组，3～8 条，列表总结网格结构。\n\n" +
    "other.color_palette：列出 **5～10 个**画面中面积最大的**区分色**（背景、主文色、强调色、分隔色等），均为 #RRGGBB，按视觉重要性排序。\n" +
    "最后须在 JSON 内完整输出上述全部字段，勿省略 layout_analysis。\n\n" +
    "输出必须是严格 JSON，对象结构示例如下（字段名和结构必须一致；fonts 长度应随图中文字块数量增减；layout_analysis 必须存在且字段齐全）：" +
    JSON.stringify(
      {
        grid_system:
          "12-column modular grid | 3-column asymmetric | baseline grid 8pt",
        columns: 3,
        gutter_px: 32,
        fonts: [
          {
            family: "Helvetica Neue",
            size_pt: 72,
            weight: "Bold",
            visual_similarity_zh:
              "neo-grotesk 无衬线，非常接近 Helvetica Neue Bold；与常见系统界面黑体相比笔画更几何。",
            region_label_zh: "画面上方通栏主标题区",
            ink_color_hex: "#0F172A",
            usage: "主标题：Summer Festival 2025",
            bbox: [100, 120, 600, 80]
          }
        ],
        line_spacing: { em: 1.5, pt: 36, baseline_grid: "yes" },
        other: {
          alignment: "left/center",
          color_palette: [
            "#0F172A",
            "#FFFFFF",
            "#3B82F6",
            "#94A3B8",
            "#E2E8F0"
          ],
          hierarchy_score: 9.2
        },
        layout_analysis: {
          type_tags: ["column_grid", "modular_grid"],
          overview_zh: "…",
          structure_zh: "…",
          composition_focal_zh: "…",
          intent_critique_zh: "…",
          spatial_labels_zh: "…",
          ascii_diagram: "+---+\n|   |\n+---+",
          summary_bullets: ["…", "…"]
        }
      },
      null,
      2
    );

  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          {
            type: "text",
            text: `文件名: ${fileName ?? "unknown"}`
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrlOrBase64,
              detail: "high"
            }
          }
        ]
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 12288,
    temperature: 0.35
  };

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API 错误: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI API 响应中缺少内容");
  }

  // response_format: json_object 时，content 为 JSON 字符串
  const parsed = JSON.parse(content) as AnalyzeResponse;
  parsed.layout_analysis = normalizeLayoutAnalysis(parsed.layout_analysis);
  sanitizeColorFields(parsed);
  return parsed;
}

function emptyLayoutAnalysis(): LayoutAnalysis {
  return {
    type_tags: ["other"],
    overview_zh: "（模型未返回版式解读，请重新分析或检查输出是否被截断。）",
    structure_zh: "—",
    composition_focal_zh: "—",
    intent_critique_zh: "—",
    spatial_labels_zh: "—",
    ascii_diagram: "(无)",
    summary_bullets: []
  };
}

function normalizeLayoutAnalysis(raw: unknown): LayoutAnalysis {
  const base = emptyLayoutAnalysis();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const tags = o.type_tags;
  if (Array.isArray(tags) && tags.every((t) => typeof t === "string")) {
    base.type_tags = tags as string[];
  }
  for (const key of [
    "overview_zh",
    "structure_zh",
    "composition_focal_zh",
    "intent_critique_zh",
    "spatial_labels_zh",
    "ascii_diagram"
  ] as const) {
    if (typeof o[key] === "string" && (o[key] as string).trim()) {
      base[key] = o[key] as string;
    }
  }
  const bullets = o.summary_bullets;
  if (Array.isArray(bullets) && bullets.every((b) => typeof b === "string")) {
    base.summary_bullets = bullets as string[];
  }
  return base;
}

function normalizeHex6(h: unknown): string | undefined {
  if (typeof h !== "string") return undefined;
  const m = h.trim().match(/^#?([0-9A-Fa-f]{6})$/);
  if (!m) return undefined;
  return `#${m[1]!.toLowerCase()}`;
}

/** 规范模型返回的色板与墨色字段，去掉非法项 */
function sanitizeColorFields(result: AnalyzeResponse): void {
  if (result.other && Array.isArray(result.other.color_palette)) {
    result.other.color_palette = result.other.color_palette
      .map((c) => normalizeHex6(c))
      .filter((c): c is string => Boolean(c));
  }
  if (Array.isArray(result.fonts)) {
    for (const f of result.fonts) {
      const hx = normalizeHex6(f.ink_color_hex);
      if (hx) f.ink_color_hex = hx;
    }
  }
}

/** 从字库文件名/族名中粗猜字重（仅本地模式排版用） */
function inferWeightFromLibraryName(name: string): string {
  const n = name.toLowerCase();
  if (/black|heavy/.test(n)) return "Black";
  if (/bold/.test(n)) return "Bold";
  if (/semibold|demi/.test(n)) return "Semibold";
  if (/medium/.test(n)) return "Medium";
  if (/light|thin/.test(n)) return "Light";
  if (/italic|oblique/.test(n)) return "Italic";
  return "Regular";
}

const LOCAL_ONLY_LAYOUT_SLOTS: Array<{
  size_pt: number;
  usage_zh: string;
  usage_en: string;
  region_zh: string;
  region_en: string;
  bbox: [number, number, number, number];
}> = [
  {
    size_pt: 42,
    usage_zh: "页眉主标题（示意区块）",
    usage_en: "Header hero title (placeholder block)",
    region_zh: "页眉主标题",
    region_en: "Header hero title",
    bbox: [0.06, 0.05, 0.88, 0.09]
  },
  {
    size_pt: 14,
    usage_zh: "导航 / 副标题条（示意区块）",
    usage_en: "Nav / subhead strip (placeholder)",
    region_zh: "导航 / 副标题条",
    region_en: "Nav / subhead strip",
    bbox: [0.06, 0.16, 0.88, 0.04]
  },
  {
    size_pt: 18,
    usage_zh: "左栏小标题（示意区块）",
    usage_en: "Left column subheading (placeholder)",
    region_zh: "左栏小标题",
    region_en: "Left column subheading",
    bbox: [0.06, 0.24, 0.38, 0.035]
  },
  {
    size_pt: 11,
    usage_zh: "左栏正文段落（示意区块）",
    usage_en: "Left column body (placeholder)",
    region_zh: "左栏正文段落",
    region_en: "Left column body",
    bbox: [0.06, 0.29, 0.38, 0.28]
  },
  {
    size_pt: 18,
    usage_zh: "右栏小标题（示意区块）",
    usage_en: "Right column subheading (placeholder)",
    region_zh: "右栏小标题",
    region_en: "Right column subheading",
    bbox: [0.5, 0.24, 0.44, 0.035]
  },
  {
    size_pt: 11,
    usage_zh: "右栏正文 / 说明（示意区块）",
    usage_en: "Right column body / caption (placeholder)",
    region_zh: "右栏正文 / 说明",
    region_en: "Right column body / caption",
    bbox: [0.5, 0.29, 0.44, 0.32]
  },
  {
    size_pt: 10,
    usage_zh: "页脚版权 / 备注（示意区块）",
    usage_en: "Footer / legal line (placeholder)",
    region_zh: "页脚版权 / 备注",
    region_en: "Footer / legal line",
    bbox: [0.06, 0.9, 0.88, 0.045]
  }
];

/**
 * 无 API：用质数步长在整库中分散选取名称绑定示意版式（非画面识别）。
 */
function buildLocalLibraryOnlyResponse(
  libraryNames: string[],
  outputLocale: OutputLocale
): AnalyzeResponse & { demo: true } {
  const names = [...new Set(libraryNames.map((n) => n.trim()).filter(Boolean))];
  const en = outputLocale === "en";
  const fonts = LOCAL_ONLY_LAYOUT_SLOTS.map((slot, i) => {
    const idx = librarySlotIndex(i, names.length);
    const family = names[idx] ?? names[0];
    const weight = inferWeightFromLibraryName(family);
    const usageLabel = en ? slot.usage_en : slot.usage_zh;
    const regionLabel = en ? slot.region_en : slot.region_zh;
    return {
      family,
      size_pt: slot.size_pt,
      weight,
      visual_similarity_zh: "",
      region_label_zh: regionLabel,
      usage: en
        ? `${usageLabel} → library entry ${idx + 1}/${names.length}: ${family}`
        : `${slot.usage_zh} → 字库第 ${idx + 1}/${names.length} 项：${family}`,
      bbox: slot.bbox
    };
  });

  return {
    demo: true,
    grid_system: en
      ? "Local-only mode · 12-column placeholder grid (no API: family names bound from built-in ∪ user pool by spread rule—not vision OCR)."
      : "仅本地模式 · 12 栏示意网格（无 API：字体名从「内置通用库 ∪ 用户字库」合并池中按步长分散绑定示意区块，非云端字形识别）",
    columns: 12,
    gutter_px: 20,
    fonts,
    line_spacing: { em: 1.45, pt: 16, baseline_grid: en ? "yes" : "yes" },
    other: {
      alignment: en ? "left" : "left",
      color_palette: ["#0f172a", "#475569", "#e2e8f0", "#f8fafc"],
      hierarchy_score: 7.5
    },
    layout_analysis: en
      ? {
          type_tags: ["column_grid", "modular_grid", "baseline_grid"],
          overview_zh:
            "[Local-only] Blocks are a fixed template. Each family name is picked from the **built-in catalog ∪ your library** by a spread rule—for name reference only; **not** read from the artwork.",
          structure_zh:
            "Placeholder: two columns + full-width header/footer; default column/gutter. Configure a vision API for real grid inference.",
          composition_focal_zh:
            "Zones only help draw overlays; mapping to library rows is a **hand-tuned rule**, not detection.",
          intent_critique_zh:
            "Useful to preview names and export SVG guides without a key; add OPENAI_API_KEY (or a compatible base URL) for real identification.",
          spatial_labels_zh:
            "Seven blocks cover nav, two text columns, footer; coordinates are relative to the image, not OCR.",
          ascii_diagram:
            "+------------------------------+\n| Library bind (full width)    |\n+----------+---------+---------+\n| Left col |         | Right col|\n|          |         |          |\n+----------+---------+---------+\n| Library rotation (full)      |\n+------------------------------+",
          summary_bullets: [
            "No API: large built-in name list; optional sidebar library",
            "family bound by pool rule—does not read glyphs",
            "Ink colors: bbox sampling in the browser",
            "OPENAI_API_KEY enables vision + second-pass naming"
          ]
        }
      : {
          type_tags: ["column_grid", "modular_grid", "baseline_grid"],
          overview_zh:
            "【仅本地模式】版式区块为固定示意模板。每条字体系名从 **内置通用字体名库 ∪ 您已同步/上传的字库** 合并池中按规则分散取用，用于对照常见族名与本机字体；**不能**从海报中自动读出实际用字。",
          structure_zh:
            "示意：双栏 + 通栏头尾；列网与 gutter 为默认值。真实网格请在配置多模态 API 后由模型推断。",
          composition_focal_zh:
            "示意分区仅帮助在画面上叠框；与字库条目的对应关系为**人工编排的轮询规则**，非视觉检测。",
          intent_critique_zh:
            "适合在没有云端密钥时预览字库名称与导出 SVG 线框；要自动识别字形请配置 OPENAI_API_KEY 或使用兼容网关。",
          spatial_labels_zh:
            "七个示意块覆盖常见的上导航、双主文栏、页脚；坐标为相对整图比例，非 OCR 结果。",
          ascii_diagram:
            "+------------------------------+\n| 绑定字库项（通栏示意）         |\n+----------+---------+---------+\n| 左栏示意  |         | 右栏示意 |\n|          |         |         |\n+----------+---------+---------+\n| 字库轮询绑定（通栏）           |\n+------------------------------+",
          summary_bullets: [
            "无 API：已内置大量通用字体名，侧栏字库可选",
            "family 从合并池轮询绑定示意块，不读图",
            "主色仍以 bbox 在浏览器中采样",
            "配置 OPENAI_API_KEY 可云端识图 + API 二次择名"
          ]
        }
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      imageBase64?: string; // dataURL 或纯 base64
      image_url?: string; // 远程 URL
      fileName?: string | null;
      /** 可选：原图像素宽高，用于校准 bbox 与 gutter_px */
      imageWidth?: number;
      imageHeight?: number;
      /** 可选：界面语言；英文时模型与本地示意文案均输出英文 */
      outputLocale?: string;
      /** 可选：用户字体库，分析时优先匹配这些 family */
      fontLibrary?: { family: string }[];
    };

    const outputLocale: OutputLocale =
      body.outputLocale === "en" ? "en" : "zh";

    const imageSource = body.image_url ?? body.imageBase64;
    if (!imageSource) {
      return new Response(
        JSON.stringify({ error: "缺少 imageBase64 或 image_url 字段" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const fontLibrary = Array.isArray(body.fontLibrary)
      ? body.fontLibrary.filter(
          (f): f is { family: string } =>
            f != null && typeof f.family === "string" && f.family.trim().length > 0
        )
      : undefined;

    const libNames = [
      ...new Set(
        (fontLibrary ?? []).map((f) => f.family.trim()).filter((n) => n.length > 0)
      )
    ];
    const builtinCount = getBuiltinFontCatalogCount();
    const mergedNames = mergeUserAndBuiltinFontNames(libNames);

    const imageDims =
      typeof body.imageWidth === "number" &&
      typeof body.imageHeight === "number" &&
      body.imageWidth > 0 &&
      body.imageHeight > 0
        ? {
            width: Math.round(body.imageWidth),
            height: Math.round(body.imageHeight)
          }
        : null;

    const hasApiKey = Boolean(process.env.OPENAI_API_KEY?.trim());

    let result: AnalyzeResponse;
    /** true = 未走通云端（无密钥或 403 已回退），按本地字库生成报告 */
    let useLocalLibraryOnly = !hasApiKey;
    let fallbackReasonZh: string | undefined;
    let fontRefineApplied = false;

    if (!hasApiKey) {
      result = buildLocalLibraryOnlyResponse(mergedNames, outputLocale);
    } else {
      try {
        result = await callGPT4o(
          imageSource,
          body.fileName ?? null,
          fontLibrary,
          builtinCount,
          imageDims,
          outputLocale
        );

        if (
          isFontRefineEnabled() &&
          Array.isArray(result.fonts) &&
          result.fonts.length > 0 &&
          mergedNames.length > 0
        ) {
          const apiKey = process.env.OPENAI_API_KEY!.trim();
          const apiBase = (
            process.env.OPENAI_API_BASE || "https://api.openai.com/v1"
          ).replace(/\/+$/, "");
          const refined = await refineFontFamiliesAgainstCatalog(
            { fonts: result.fonts },
            mergedNames,
            {
              apiKey,
              apiBase,
              refineModel: getRefineModelFromEnv(),
              outputLocale
            }
          );
          result = { ...result, fonts: refined.fonts };
          fontRefineApplied = true;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isOpenAIRegionBlockedError(msg)) {
          result = buildLocalLibraryOnlyResponse(mergedNames, outputLocale);
          useLocalLibraryOnly = true;
          fallbackReasonZh =
            outputLocale === "en"
              ? "OpenAI returned HTTP 403 (unsupported region or policy). Switched to **local-library** demo: placeholder layout + rotated names—**no cloud vision**. Set a compliant OPENAI_API_BASE in .env.local and restart for full analysis."
              : "OpenAI 官方接口返回 403（当前地区或网络策略不支持）。已**自动切换**为「仅本地字库」对照：示意版式 + 字库名称轮询，**不进行云端识图**。若需云端分析，请在 .env.local 设置合规的 OPENAI_API_BASE（兼容 Chat Completions 的服务商）后重启。";
        } else {
          throw e;
        }
      }
    }

    const fontsForReport = Array.isArray(result.fonts) ? result.fonts : [];
    const normalizedForReport =
      useLocalLibraryOnly || fontsBboxLikelyNormalized(fontsForReport);

    const font_identification =
      fontsForReport.length > 0
        ? buildFontIdentificationReport(fontsForReport, mergedNames, {
            normalizedBBox: normalizedForReport,
            mode: useLocalLibraryOnly ? "local_library_only" : "api",
            outputLocale
          })
        : undefined;

    if (!useLocalLibraryOnly && mergedNames.length > 0 && fontsForReport.length > 0) {
      result = {
        ...result,
        fonts: applyFontLibraryToFonts(result.fonts, mergedNames)
      };
    }

    if (fallbackReasonZh) {
      result = { ...result, fallback_reason_zh: fallbackReasonZh };
    }

    if (font_identification) {
      result = { ...result, font_identification };
    }

    result = {
      ...result,
      meta_font_matching: {
        builtin_catalog_count: builtinCount,
        user_library_count: libNames.length,
        merged_pool_count: mergedNames.length,
        refine_pass_applied: fontRefineApplied
      }
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    console.error(error);
    return new Response(
      JSON.stringify({
        error: "分析失败",
        message: error?.message ?? "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

