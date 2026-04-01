import builtin from "@/data/font-catalog.json";

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s._-]+/g, "");
}

/** 内置通用字体族名（Google Fonts 系 + 系统常见 + 中文常用） */
export const BUILTIN_FONT_CATALOG: readonly string[] = builtin as string[];

export function getBuiltinFontCatalogCount(): number {
  return BUILTIN_FONT_CATALOG.length;
}

/**
 * 用户字库（优先、保留原始大小写）与内置大全合并去重。
 */
export function mergeUserAndBuiltinFontNames(userFamilies: readonly string[]): string[] {
  const map = new Map<string, string>();
  for (const raw of userFamilies) {
    const t = raw.trim();
    if (!t) continue;
    const k = normKey(t);
    if (!map.has(k)) map.set(k, t);
  }
  for (const raw of BUILTIN_FONT_CATALOG) {
    const t = String(raw).trim();
    if (!t) continue;
    const k = normKey(t);
    if (!map.has(k)) map.set(k, t);
  }
  return [...map.values()];
}
