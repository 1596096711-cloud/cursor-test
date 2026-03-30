/**
 * 将模型返回的 bbox 校正到与 img.naturalWidth / naturalHeight 一致的像素坐标。
 * 常见情况：0~1 归一化、或基于缩小预览图估的坐标整体偏小。
 */
export function rescaleBboxesToNatural(
  boxes: readonly [number, number, number, number][],
  nw: number,
  nh: number
): [number, number, number, number][] {
  if (boxes.length === 0 || nw < 2 || nh < 2) {
    return boxes.map((b) => [...b] as [number, number, number, number]);
  }

  let maxR = 0;
  let maxB = 0;
  for (const [x, y, w, h] of boxes) {
    maxR = Math.max(maxR, x + w);
    maxB = Math.max(maxB, y + h);
  }
  if (maxR <= 0 || maxB <= 0) {
    return boxes.map((b) => [...b] as [number, number, number, number]);
  }

  // 归一化 0~1
  if (maxR <= 1.02 && maxB <= 1.02) {
    return boxes.map(([x, y, w, h]) => [
      Math.round(x * nw),
      Math.round(y * nh),
      Math.max(1, Math.round(w * nw)),
      Math.max(1, Math.round(h * nh))
    ]);
  }

  // 坐标整体落在画幅内但明显偏小（模型在低分辨率上估的框）
  const ratioR = maxR / nw;
  const ratioB = maxB / nh;
  if (ratioR < 0.52 && ratioB < 0.52) {
    const s = Math.min(nw / maxR, nh / maxB);
    if (s > 1.04) {
      return boxes.map(([x, y, w, h]) => [
        x * s,
        y * s,
        w * s,
        h * s
      ]);
    }
  }

  // 超出 natural：整体缩小塞进画幅
  if (maxR > nw * 1.02 || maxB > nh * 1.02) {
    const s = Math.min(nw / maxR, nh / maxB);
    return boxes.map(([x, y, w, h]) => [
      x * s,
      y * s,
      w * s,
      h * s
    ]);
  }

  return boxes.map((b) => [...b] as [number, number, number, number]);
}
