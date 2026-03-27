import { rescaleBboxesToNatural } from "@/lib/rescale-model-bboxes";
import { tightenGlyphBoxes } from "@/lib/tighten-glyph-box";

export type LayoutTemplateAnalyzeResult = {
  grid_system: string;
  columns: number;
  gutter_px: number;
  layout_analysis?: { type_tags?: string[] };
  fonts: {
    family: string;
    size_pt: number;
    weight: string;
    usage: string;
    bbox: [number, number, number, number];
  }[];
  line_spacing: {
    em: number;
    pt: number;
    baseline_grid: string;
  };
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clusterMeans(values: number[], tol: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    const cur = clusters[clusters.length - 1];
    if (v - cur[cur.length - 1] <= tol) cur.push(v);
    else clusters.push([v]);
  }
  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}

/** 与画布一致：先 rescale 到 natural，再像素收紧 */
export function computeNaturalTextBoxes(
  img: HTMLImageElement,
  result: LayoutTemplateAnalyzeResult
): [number, number, number, number][] {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh || !result.fonts?.length) return [];
  const raw = result.fonts.map((f) => f.bbox);
  const nat = rescaleBboxesToNatural(raw, nw, nh);
  return tightenGlyphBoxes(img, nat);
}

/**
 * 根据分析结果生成与源图同尺寸的排版模板 SVG（列网、可选三分线、基线参考、文字块占位框）。
 */
export function buildLayoutTemplateSvg(
  result: LayoutTemplateAnalyzeResult,
  naturalWidth: number,
  naturalHeight: number,
  textBoxes: readonly [number, number, number, number][]
): string {
  const nw = Math.max(1, Math.round(naturalWidth));
  const nh = Math.max(1, Math.round(naturalHeight));
  const tags = result.layout_analysis?.type_tags ?? [];
  const showThirds = tags.some((t) => t === "rule_of_thirds");

  const columns = Math.max(0, Math.round(result.columns || 0));
  const gutterNat = Math.max(0, result.gutter_px ?? 0);
  let columnLines: number[] = [];
  if (columns > 0) {
    const totalGutterNat = gutterNat * (columns - 1);
    const columnWidthNat = (nw - totalGutterNat) / columns;
    for (let i = 0; i <= columns; i++) {
      const x = i * columnWidthNat + Math.max(0, i - 1) * gutterNat;
      columnLines.push(x);
    }
  }

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${nw}" height="${nh}" viewBox="0 0 ${nw} ${nh}">`
  );
  parts.push(
    `<title>${escapeXml("排版模板 — " + (result.grid_system || "").slice(0, 80))}</title>`
  );
  parts.push(
    `<desc>${escapeXml(
      `列数 ${columns} · gutter ${gutterNat}px · 与源图 ${nw}×${nh} 对齐`
    )}</desc>`
  );

  parts.push(`<defs>
    <style><![CDATA[
      .col-line { stroke: rgb(59,130,246); stroke-width: 1; fill: none; opacity: 0.45; }
      .col-fill-a { fill: rgb(56,189,248); opacity: 0.06; }
      .col-fill-b { fill: rgb(129,140,248); opacity: 0.06; }
      .third { stroke: rgb(168,85,247); stroke-width: 0.75; stroke-dasharray: 6 4; fill: none; opacity: 0.4; }
      .baseline { stroke: rgb(148,163,184); stroke-width: 0.5; fill: none; opacity: 0.35; }
      .guide-v { stroke: rgb(16,185,129); stroke-width: 0.75; stroke-dasharray: 4 4; fill: none; opacity: 0.55; }
      .guide-h { stroke: rgb(245,158,11); stroke-width: 0.75; stroke-dasharray: 4 4; fill: none; opacity: 0.55; }
      .region { fill: none; stroke: rgb(248,113,113); stroke-width: 2; opacity: 0.9; }
      .label { fill: rgb(15,23,42); font-family: system-ui, sans-serif; font-size: 11px; }
    ]]></style>
  </defs>`);

  // 交替列浅底（与画布语义一致）
  if (columns > 0 && textBoxes.length === 0) {
    const totalGutterNat = gutterNat * (columns - 1);
    const cw = (nw - totalGutterNat) / columns;
    for (let i = 0; i < columns; i++) {
      const x = i * cw + i * gutterNat;
      parts.push(
        `<rect class="${i % 2 === 0 ? "col-fill-a" : "col-fill-b"}" x="${x}" y="0" width="${cw}" height="${nh}"/>`
      );
    }
  }

  if (columnLines.length > 0) {
    parts.push(`<g id="columns">`);
    for (const x of columnLines) {
      parts.push(
        `<line class="col-line" x1="${x}" y1="0" x2="${x}" y2="${nh}"/>`
      );
    }
    parts.push(`</g>`);
  }

  if (showThirds) {
    const vx = [nw / 3, (2 * nw) / 3];
    const hy = [nh / 3, (2 * nh) / 3];
    parts.push(`<g id="rule-of-thirds">`);
    for (const x of vx) {
      parts.push(
        `<line class="third" x1="${x}" y1="0" x2="${x}" y2="${nh}"/>`
      );
    }
    for (const y of hy) {
      parts.push(
        `<line class="third" x1="0" y1="${y}" x2="${nw}" y2="${y}"/>`
      );
    }
    parts.push(`</g>`);
  }

  if (result.line_spacing?.baseline_grid === "yes") {
    const pt = result.line_spacing.pt || 0;
    const stepNat = pt > 0 ? (pt * 96) / 72 : 0;
    if (stepNat > 2) {
      parts.push(`<g id="baseline-grid">`);
      for (let y = 0; y <= nh; y += stepNat) {
        parts.push(
          `<line class="baseline" x1="0" y1="${y}" x2="${nw}" y2="${y}"/>`
        );
      }
      parts.push(`</g>`);
    }
  }

  const edgeTol = Math.max(3, Math.min(nw, nh) * 0.004);
  if (textBoxes.length > 0) {
    const lefts: number[] = [];
    const rights: number[] = [];
    const tops: number[] = [];
    const bottoms: number[] = [];
    for (const [x, y, w, h] of textBoxes) {
      if (w > 1 && h > 1) {
        lefts.push(x);
        rights.push(x + w);
        tops.push(y);
        bottoms.push(y + h);
      }
    }
    const vx = [...clusterMeans(lefts, edgeTol), ...clusterMeans(rights, edgeTol)];
    const hy = [...clusterMeans(tops, edgeTol), ...clusterMeans(bottoms, edgeTol)];
    parts.push(`<g id="edge-guides">`);
    for (const x of vx) {
      parts.push(
        `<line class="guide-v" x1="${x}" y1="0" x2="${x}" y2="${nh}"/>`
      );
    }
    for (const y of hy) {
      parts.push(
        `<line class="guide-h" x1="0" y1="${y}" x2="${nw}" y2="${y}"/>`
      );
    }
    parts.push(`</g>`);
  }

  parts.push(`<g id="text-regions">`);
  result.fonts.forEach((font, i) => {
    const b = textBoxes[i];
    if (!b) return;
    const [x, y, w, h] = b;
    if (w < 1 || h < 1) return;
    const usage = escapeXml((font.usage || "文字块").slice(0, 120));
    parts.push(
      `<rect class="region" x="${x}" y="${y}" width="${w}" height="${h}"><title>${usage}</title></rect>`
    );
    const fs = Math.min(
      Math.max(9, Math.min(font.size_pt * 0.65, Math.min(w, h) * 0.28)),
      h * 0.42
    );
    let labelY = y - 6;
    if (labelY < fs + 4) labelY = y + fs + 2;
    const shortLabel = escapeXml(
      `${font.usage || "块"} · ${font.size_pt}pt`.slice(0, 60)
    );
    parts.push(
      `<text class="label" x="${x}" y="${labelY}" font-size="${fs}">${shortLabel}</text>`
    );
  });
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

export function triggerSvgDownload(svg: string, baseFileName: string) {
  const safe = baseFileName.replace(/[^\w\u4e00-\u9fff.-]+/g, "_").slice(0, 80);
  const name = safe ? `${safe}-layout-template.svg` : "layout-template.svg";
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
