import { shortlistFontCandidates } from "@/lib/font-library-match";

export type AnalyzeFontsShape = {
  fonts: Array<{
    family: string;
    size_pt: number;
    weight: string;
    usage: string;
    bbox: [number, number, number, number];
    visual_similarity_zh?: string;
    ink_color_hex?: string;
    region_label_zh?: string;
  }>;
};

const DEFAULT_REFINE_MODEL = "gpt-4o-mini";
const CANDIDATES_PER_FONT = 56;

/**
 * 在视觉模型给出 family 初值后，用轻量文本模型从「用户∪内置」字库候选中择名，提升大字库下的命中率。
 */
export async function refineFontFamiliesAgainstCatalog(
  parsed: AnalyzeFontsShape,
  mergedLibraryNames: readonly string[],
  opts: {
    apiKey: string;
    apiBase: string;
    refineModel: string;
    outputLocale?: "zh" | "en";
  }
): Promise<AnalyzeFontsShape> {
  const fonts = parsed.fonts;
  if (!fonts.length || mergedLibraryNames.length < 2) return parsed;

  const blocks = fonts.map((f, i) => {
    const candidates = shortlistFontCandidates(
      f.family,
      f.visual_similarity_zh,
      mergedLibraryNames,
      CANDIDATES_PER_FONT,
      f.usage
    );
    return {
      i,
      guess: f.family,
      visual: (f.visual_similarity_zh ?? "").slice(0, 220),
      region: (f.region_label_zh ?? "").slice(0, 120),
      usage: (f.usage ?? "").slice(0, 140),
      size_pt: f.size_pt,
      candidates: candidates.length ? candidates : [f.family]
    };
  });

  const sysEn =
    "You are a font naming expert. Each block has: guess, region, visual note, visible text usage, size_pt, and candidates.\n" +
    "For each block, copy **exactly one** string from that block's candidates as the final family (same spelling/case; never invent names).\n" +
    "Use visual cues (serifs, skeleton, weight) and usage (Latin/CJK) to disambiguate.\n" +
    "Output only JSON: {\"picks\":[{\"i\":0,\"family\":\"exact string from candidates\"},...]} covering every block.";
  const sysZh =
    "你是字体命名专家。每块含：初猜族名、区域、视觉描述、可见文字摘录 usage、字号 size_pt、以及 candidates 候选列表。\n" +
    "对每一块，必须从该块 candidates 中**原样复制一条**作为最终族名（大小写与列表完全一致，禁止列表外名称）。\n" +
    "结合 visual 的衬线/骨架/字重线索；用 usage 判断拉丁/西里尔/中日韩：中文正文勿选成纯西文 UI 字体除非 usage 全是英文。\n" +
    "size_pt 明显大于相邻块时多为标题层，族名可与正文不同；同级多行应保持同一族名（仅 weight 变）。\n" +
    "若初猜已在 candidates 且与 visual+usage 不矛盾，可保留初猜。\n" +
    "只输出 JSON：{\"picks\":[{\"i\":0,\"family\":\"候选中的确切字符串\"},...]}，i 与输入一致，须覆盖所有块。";

  const payload = {
    model: opts.refineModel,
    messages: [
      {
        role: "system" as const,
        content: opts.outputLocale === "en" ? sysEn : sysZh
      },
      {
        role: "user" as const,
        content: JSON.stringify({ blocks })
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096,
    temperature: 0.2
  };

  const res = await fetch(`${opts.apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const t = await res.text();
    console.warn("refineFontFamiliesAgainstCatalog: API error", res.status, t);
    return parsed;
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return parsed;

  let picks: { i: number; family: string }[] = [];
  try {
    const j = JSON.parse(content) as { picks?: { i: number; family: string }[] };
    picks = Array.isArray(j.picks) ? j.picks : [];
  } catch {
    return parsed;
  }

  const byIndex = new Map<number, string>();
  for (const p of picks) {
    if (
      typeof p.i === "number" &&
      typeof p.family === "string" &&
      p.family.trim()
    ) {
      byIndex.set(p.i, p.family.trim());
    }
  }

  const nextFonts = fonts.map((f, i) => {
    const chosen = byIndex.get(i);
    if (!chosen) return f;
    const allowed = blocks[i]?.candidates ?? [];
    const ok = allowed.some(
      (c) => c.toLowerCase() === chosen.toLowerCase()
    );
    if (!ok) return f;
    const canonical =
      allowed.find((c) => c.toLowerCase() === chosen.toLowerCase()) ?? chosen;
    return { ...f, family: canonical };
  });

  return { ...parsed, fonts: nextFonts };
}

export function getRefineModelFromEnv(): string {
  return (
    process.env.OPENAI_REFINE_MODEL?.trim() || DEFAULT_REFINE_MODEL
  );
}

export function isFontRefineEnabled(): boolean {
  const v = process.env.OPENAI_REFINE_FONTS?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}
