/**
 * 将模型给出的字体族名与用户字体库名称做相似度匹配，取最高者（需过阈值）。
 * 纯字符串算法，无嵌入模型，适用于 Edge/浏览器。
 */

import { deterministicShuffleStrings } from "@/lib/library-slot";

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s._-]+/g, "")
    .replace(/(regular|normal|bold|medium|light|italic|oblique)$/i, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

export function similarityScore(guess: string, candidate: string): number {
  const g = normalizeName(guess);
  const c = normalizeName(candidate);
  if (!g || !c) return 0;
  if (g === c) return 1;
  if (g.includes(c) || c.includes(g)) return 0.9;
  const maxLen = Math.max(g.length, c.length);
  const d = levenshtein(g, c);
  return 1 - d / maxLen;
}

/** 相似度达到此值才替换为库中名称，否则保留模型原输出（略高以减少误替） */
const MIN_MATCH_SCORE = 0.42;

export function pickBestLibraryFamily(
  modelFamily: string,
  libraryNames: readonly string[]
): { family: string; score: number; fromLibrary: boolean } {
  const raw = [
    ...new Set(
      libraryNames.map((n) => n.trim()).filter((n) => n.length > 0)
    )
  ];
  if (raw.length === 0) {
    return { family: modelFamily, score: 0, fromLibrary: false };
  }

  /** 仍会对全库逐项算分；打乱顺序只为「同分」时不总取字母序最前 */
  const uniq = deterministicShuffleStrings(raw, `match:${modelFamily}`);

  let bestName = modelFamily;
  let bestScore = 0;
  for (const name of uniq) {
    const s = similarityScore(modelFamily, name);
    if (s > bestScore) {
      bestScore = s;
      bestName = name;
    }
  }

  if (bestScore >= MIN_MATCH_SCORE) {
    return { family: bestName, score: bestScore, fromLibrary: true };
  }
  return { family: modelFamily, score: bestScore, fromLibrary: false };
}

/** 无论是否过阈值，均返回本地库中得分最高的一项（用于「最接近建议」文案） */
export function pickTopLibraryCandidate(
  modelFamily: string,
  libraryNames: readonly string[]
): { topName: string; topScore: number } {
  const raw = [
    ...new Set(
      libraryNames.map((n) => n.trim()).filter((n) => n.length > 0)
    )
  ];
  if (raw.length === 0) return { topName: "", topScore: 0 };
  const uniq = deterministicShuffleStrings(raw, `top:${modelFamily}`);
  let bestName = uniq[0]!;
  let bestScore = 0;
  for (const name of uniq) {
    const s = similarityScore(modelFamily, name);
    if (s > bestScore) {
      bestScore = s;
      bestName = name;
    }
  }
  return { topName: bestName, topScore: bestScore };
}

export type FontEntry = { family: string };

export function applyFontLibraryToFonts<T extends FontEntry>(
  fonts: T[],
  libraryNames: readonly string[]
): T[] {
  if (!libraryNames.length) return fonts;
  return fonts.map((f) => {
    const { family } = pickBestLibraryFamily(f.family, libraryNames);
    return { ...f, family };
  });
}

const TOKEN_RE = /[A-Za-z][A-Za-z0-9+.-]{1,}|[\u4e00-\u9fff]{1,4}/g;

function tokenBonus(visualNote: string | undefined, candidate: string): number {
  if (!visualNote?.trim()) return 0;
  const vn = visualNote.toLowerCase();
  const cn = candidate.toLowerCase();
  let bonus = 0;
  const tokens = visualNote.match(TOKEN_RE) ?? [];
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (low.length < 3) continue;
    if (cn.includes(low) || vn.includes(candidate.toLowerCase())) bonus += 0.06;
  }
  return Math.min(bonus, 0.25);
}

/**
 * 从大字库中截取与模型推测、视觉描述最相关的前 K 个族名（供二次 API 精校）。
 */
export function shortlistFontCandidates(
  modelFamily: string,
  visualNote: string | undefined,
  libraryNames: readonly string[],
  k: number,
  usageHint?: string | undefined
): string[] {
  if (!libraryNames.length || k <= 0) return [];
  const uniq = [...new Set(libraryNames.map((n) => n.trim()).filter(Boolean))];
  const hint =
    `${visualNote ?? ""} ${usageHint ?? ""}`.trim().slice(0, 280) || undefined;
  const scored = uniq.map((name) => ({
    name,
    score:
      similarityScore(modelFamily, name) + tokenBonus(hint, name)
  }));
  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.name);
    if (out.length >= k) break;
  }
  return out;
}
