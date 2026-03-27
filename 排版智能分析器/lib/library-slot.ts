/**
 * 字库名称列表常为字母序，若用 slot % len 会反复落在列表前段（多为 A 开头）。
 * 用与 len 互质的步长打散，使各区块分散覆盖整库。
 */

const STRIDE_PRIME = 9973;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}

/** 第 slot 个版式块应对应字库中的下标（0..len-1） */
export function librarySlotIndex(slot: number, length: number): number {
  if (length <= 0) return 0;
  const off = (slot * STRIDE_PRIME + length * 31) % length;
  return off < 0 ? off + length : off;
}

/**
 * 对字库名列表做确定性打乱，避免「并列最高相似度」时总偏向字母序最前项。
 */
export function deterministicShuffleStrings(
  items: readonly string[],
  seedKey: string
): string[] {
  const arr = [...items];
  let seed = hashString(seedKey + String(arr.length)) >>> 0;
  const next = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}
