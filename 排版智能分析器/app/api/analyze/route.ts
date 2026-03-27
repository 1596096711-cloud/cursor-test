import { NextRequest } from "next/server";
import { applyFontLibraryToFonts } from "@/lib/font-library-match";
import {
  buildFontIdentificationReport,
  fontsBboxLikelyNormalized,
  type FontIdentificationReport
} from "@/lib/font-identification-report";
import { librarySlotIndex } from "@/lib/library-slot";

export const runtime = "edge";

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
  fontLibrary?: { family: string }[]
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

  const systemPrompt =
    "你是一位**专业字体识别与排版分析专家**，同时负责网格系统分析。只输出 JSON，禁止输出 JSON 以外的任何文字。" +
          "**字体识别**：逐块观察字形骨架、笔画对比度、字谷、衬线/无衬线、字重、宽窄与西文/中日韩风格；为每个文字块给出最可信的**西文或中文通用字体族名**（可用 PostScript 名或常见商用名，如 Helvetica Neue / PingFang SC / 思源黑体 / Arial Black）及**粗细与样式**（Bold、Medium、Italic 等）。" +
          "若用户提供字体库列表，你须在 family 中优先使用能与其**字面最接近**的名称以便后续匹配；无法确定时用业界常见近似名。" +
          "你必须穷尽识别图中**所有**可读文字区域，不得只给标题而忽略正文、说明、按钮、导航、页脚、图注等。" +
          "bbox [x,y,w,h] 必须严格贴合**可见字形外轮廓**（墨色上/下/左/右极限），勿随意扩大留白。" +
          "推断 columns、gutter_px、grid_system 时应对齐**重复出现的字形块边缘**，而非随意等分整图。";

  const fontLibBlock =
    fontLibrary && fontLibrary.length > 0
      ? "【用户自定义字体库】\n" +
        "下列名称来自用户上传或系统同步的字体文件（字体内嵌族名）。\n" +
        "fonts[].family 可先写你对画面字体的**视觉推测**（任意合理名称）；\n" +
        "服务端会在返回前用**字符串相似度**自动将每条 family **校正为库中与推测最接近的一项**（相似度不足则保留推测名）。\n" +
        "字体库列表（请在推断 family 时**优先向这些字符串靠拢**，便于用户对照本机已安装字体）：\n" +
        JSON.stringify(fontLibrary.map((f) => f.family)) +
        "\n\n"
      : "";

  const userPrompt =
    fontLibBlock +
    "请根据提供的页面图像，以**字体识别专家**身份完成分析。\n\n" +
    "【fonts 数组 — 最重要】必须为每一块字填写下列字段：\n" +
    "1) family、weight、size_pt：给出**家族名 + 粗细/样式**（如「思源黑体」+「Bold」、「PingFang SC」+「Medium」）。\n" +
    "2) visual_similarity_zh：**必填**。用 1～2 句中文说明**视觉相似度**，例如「非常接近 Arial Black」「 neo-grotesk 无衬线，近似 Helvetica Neue Bold」「中文黑体，接近 微软雅黑 Bold」；若与用户字体库中某项名称明显对应，写明「可与库中 ×× 对照」。\n" +
    "3) region_label_zh：**必填**。用一句中文标出在图中的区域，如「海报顶部通栏主标题」「左下脚版权小号字」「右侧栏正文第二段」。\n" +
    "4) ink_color_hex：该文字块**主体墨色**的近似色，格式 **#RRGGBB**（从画面目测，若无把握可给最主要深色）。\n" +
    "5) usage：建议用途 + 该块**可见文字摘录**（约 8~20 字）。\n" +
    "6) bbox [x,y,w,h] 像素整数，紧贴字形外沿；多字体必须**拆成多条**，分别写清 region_label_zh。\n" +
    "7) 按阅读顺序排列（自上而下、从左到右）。\n\n" +
    "【网格 columns / gutter_px】\n" +
    "应从字形块列对齐与栏间距**实测**推断：例如多段正文左缘共线则列宽与 gutter 须与该对齐一致；不要假设整幅图被等分。\n\n" +
    "【layout_analysis — 必须输出】须用**清晰中文**写满下列字段，结合画面具体位置（如「左上约 1/3」「中央垂直参考线」）：\n" +
    "1) type_tags：从 column_grid | modular_grid | baseline_grid | rule_of_thirds | golden_ratio | symmetrical_grid | hierarchical_grid | other 中选 1～5 个标签。\n" +
    "2) overview_zh：判断属于哪种网格系统（可多选混合），例如规则列网格、模块化（行列区块）、基线网格、九宫格/三分法、黄金比例/φ 网格、对称网格、层级网格等。\n" +
    "3) structure_zh：列数与行（估算）、gutters 与 margins、关键对齐线、文字/图片/色块如何沿网格对齐、是否有隐形辅助线或叠加网格层。\n" +
    "4) composition_focal_zh：是否遵循三分法、黄金比例≈1.618、黄金螺旋等；视觉焦点落在哪些交点或区域。\n" +
    "5) intent_critique_zh：网格如何帮助信息层级、平衡与视觉流动；优点与潜在改进（可选）。\n" +
    "6) spatial_labels_zh：用具体方位描述关键元素与网格关系。\n" +
    "7) ascii_diagram：多行 ASCII 简单示意版面分区（可用 + - |）。\n" +
    "8) summary_bullets：字符串数组，3～8 条，列表总结网格结构。\n\n" +
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
          color_palette: ["#000000", "#FFFFFF"],
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
    max_tokens: 12288
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
  usage: string;
  bbox: [number, number, number, number];
}> = [
  { size_pt: 42, usage: "页眉主标题（示意区块）", bbox: [0.06, 0.05, 0.88, 0.09] },
  { size_pt: 14, usage: "导航 / 副标题条（示意区块）", bbox: [0.06, 0.16, 0.88, 0.04] },
  { size_pt: 18, usage: "左栏小标题（示意区块）", bbox: [0.06, 0.24, 0.38, 0.035] },
  { size_pt: 11, usage: "左栏正文段落（示意区块）", bbox: [0.06, 0.29, 0.38, 0.28] },
  { size_pt: 18, usage: "右栏小标题（示意区块）", bbox: [0.5, 0.24, 0.44, 0.035] },
  { size_pt: 11, usage: "右栏正文 / 说明（示意区块）", bbox: [0.5, 0.29, 0.44, 0.32] },
  { size_pt: 10, usage: "页脚版权 / 备注（示意区块）", bbox: [0.06, 0.9, 0.88, 0.045] }
];

/**
 * 无 API：用质数步长在整库中分散选取名称绑定示意版式（非画面识别）。
 */
function buildLocalLibraryOnlyResponse(
  libraryNames: string[]
): AnalyzeResponse & { demo: true } {
  const names = [...new Set(libraryNames.map((n) => n.trim()).filter(Boolean))];
  const fonts = LOCAL_ONLY_LAYOUT_SLOTS.map((slot, i) => {
    const idx = librarySlotIndex(i, names.length);
    const family = names[idx] ?? names[0];
    const weight = inferWeightFromLibraryName(family);
    return {
      family,
      size_pt: slot.size_pt,
      weight,
      visual_similarity_zh: "",
      region_label_zh: slot.usage.replace(/（示意区块）/, "").trim(),
      usage: `${slot.usage} → 字库第 ${idx + 1}/${names.length} 项：${family}`,
      bbox: slot.bbox
    };
  });

  return {
    demo: true,
    grid_system:
      "仅本地字库模式 · 12 栏示意网格（无 API：字体名在整库中按步长分散选取后绑定示意区块，非图像识别）",
    columns: 12,
    gutter_px: 20,
    fonts,
    line_spacing: { em: 1.45, pt: 16, baseline_grid: "yes" },
    other: {
      alignment: "left",
      color_palette: ["#0f172a", "#475569", "#e2e8f0", "#f8fafc"],
      hierarchy_score: 7.5
    },
    layout_analysis: {
      type_tags: ["column_grid", "modular_grid", "baseline_grid"],
      overview_zh:
        "【仅本地字库】版式区块为固定示意模板，随图像尺寸缩放。每条字体系名从您已同步/上传的**字库列表按顺序循环取用**，用于在界面和报告中对照本机可用字体名称；**不能**从海报中自动读出实际用字。",
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
        "无 API：须先同步/上传字库",
        "family 仅从字库列表轮询，不读图",
        "主色等仍以 bbox 在浏览器中采样",
        "配置密钥后可切换为多模态识图"
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
      /** 可选：用户字体库，分析时优先匹配这些 family */
      fontLibrary?: { family: string }[];
    };

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

    const hasApiKey = Boolean(process.env.OPENAI_API_KEY?.trim());

    let result: AnalyzeResponse;
    /** true = 未走通云端（无密钥或 403 已回退），按本地字库生成报告 */
    let useLocalLibraryOnly = !hasApiKey;
    let fallbackReasonZh: string | undefined;

    if (!hasApiKey) {
      if (libNames.length === 0) {
        return new Response(
          JSON.stringify({
            error: "需要本地字体库",
            code: "FONT_LIBRARY_REQUIRED",
            message:
              "当前未配置 OPENAI_API_KEY。本应用在此模式下**只使用侧栏已同步/上传的字体库**与示意版式对照。请先点击「同步 Windows 字体」或上传字体后，再点击「开始分析」。"
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      result = buildLocalLibraryOnlyResponse(libNames);
    } else {
      try {
        result = await callGPT4o(
          imageSource,
          body.fileName ?? null,
          fontLibrary
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isOpenAIRegionBlockedError(msg)) {
          if (libNames.length === 0) {
            return new Response(
              JSON.stringify({
                error: "OpenAI 地区不可用",
                code: "REGION_BLOCK_NO_LIBRARY",
                message:
                  "OpenAI 返回 403（Country, region, or territory not supported）。已无法调用官方识图。\n请先点击侧栏「同步 Windows 字体」或上传字体，以便自动使用**仅本地字库**模式；或在 .env.local 中将 OPENAI_API_BASE 改为所在地区可用的**兼容 API 基地址**后重启服务。\n也可暂时删除 OPENAI_API_KEY，将始终走本地字库模式。"
              }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          result = buildLocalLibraryOnlyResponse(libNames);
          useLocalLibraryOnly = true;
          fallbackReasonZh =
            "OpenAI 官方接口返回 403（当前地区或网络策略不支持）。已**自动切换**为「仅本地字库」对照：示意版式 + 字库名称轮询，**不进行云端识图**。若需云端分析，请在 .env.local 设置合规的 OPENAI_API_BASE（兼容 Chat Completions 的服务商）后重启。";
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
        ? buildFontIdentificationReport(fontsForReport, libNames, {
            normalizedBBox: normalizedForReport,
            mode: useLocalLibraryOnly ? "local_library_only" : "api"
          })
        : undefined;

    if (!useLocalLibraryOnly && libNames.length > 0 && fontsForReport.length > 0) {
      result = {
        ...result,
        fonts: applyFontLibraryToFonts(result.fonts, libNames)
      };
    }

    if (fallbackReasonZh) {
      result = { ...result, fallback_reason_zh: fallbackReasonZh };
    }

    if (font_identification) {
      result = { ...result, font_identification };
    }

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

