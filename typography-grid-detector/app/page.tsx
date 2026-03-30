"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { rescaleBboxesToNatural } from "../lib/rescale-model-bboxes";
import { tightenGlyphBoxes } from "../lib/tighten-glyph-box";
import {
  buildLayoutTemplateSvg,
  computeNaturalTextBoxes,
  triggerSvgDownload
} from "../lib/layout-to-svg";
import {
  buildFontIdentificationReport,
  mergeColorsIntoReport
} from "../lib/font-identification-report";
import {
  inferLayoutFromUploadedImage,
  inferWeightFromLibraryName
} from "../lib/client-image-analysis";
import { librarySlotIndex } from "../lib/library-slot";
import { sampleDominantInkColor } from "../lib/sample-bbox-colors";

type AnalysisTabKey =
  | "grid"
  | "typography"
  | "leading"
  | "report"
  | "layout"
  | "template";

// 和 /api/analyze 返回结构保持一致
interface FontLibraryEntry {
  id: string;
  familyName: string;
  originalFileName: string;
  uploadedAt: string;
  source?: "upload" | "system";
  storedFileName?: string;
  systemPath?: string;
}

interface LayoutAnalysis {
  type_tags: string[];
  overview_zh: string;
  structure_zh: string;
  composition_focal_zh: string;
  intent_critique_zh: string;
  spatial_labels_zh: string;
  ascii_diagram: string;
  summary_bullets: string[];
}

interface AnalyzeResponse {
  /** 无 API Key 时后端返回演示数据，不会识别你上传图里的真实文字 */
  demo?: boolean;
  /** OpenAI 403 地区限制时已自动改用本地字库，原因说明 */
  fallback_reason_zh?: string;
  /** 浏览器已对上传图做过连通域粗测，避免重复跑 */
  heuristic_enhanced?: boolean;
  grid_system: string;
  columns: number;
  gutter_px: number;
  layout_analysis?: LayoutAnalysis;
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
  font_identification?: {
    disclaimer_zh: string;
    blocks: {
      index: number;
      font_name: string;
      similarity: string;
      position: string;
      size_pt: number;
      color_hex?: string;
      model_ink_hex?: string;
      usage: string;
      bbox: [number, number, number, number];
    }[];
  };
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<AnalysisTabKey>("grid");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [originalDataUrl, setOriginalDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResponse | null>(
    null
  );
  const analysisResultRef = useRef<AnalyzeResponse | null>(null);
  analysisResultRef.current = analysisResult;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [fontLibrary, setFontLibrary] = useState<FontLibraryEntry[]>([]);
  const [fontUploading, setFontUploading] = useState(false);
  const [syncingSystemFonts, setSyncingSystemFonts] = useState(false);

  const refreshFontLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/fonts");
      if (!res.ok) return;
      const data = (await res.json()) as { fonts?: FontLibraryEntry[] };
      setFontLibrary(Array.isArray(data.fonts) ? data.fonts : []);
    } catch {
      setFontLibrary([]);
    }
  }, []);

  useEffect(() => {
    void refreshFontLibrary();
  }, [refreshFontLibrary]);

  const handleFontFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setFontUploading(true);
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/fonts", { method: "POST", body: fd });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `上传失败 (${res.status})`);
          }
        }
        await refreshFontLibrary();
      } catch (e) {
        alert(e instanceof Error ? e.message : "字体上传失败");
      } finally {
        setFontUploading(false);
      }
    },
    [refreshFontLibrary]
  );

  const syncWindowsFonts = useCallback(async () => {
    setSyncingSystemFonts(true);
    try {
      const res = await fetch("/api/fonts/sync-windows", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || data.detail || `同步失败（HTTP ${res.status}）`
        );
      }
      alert(
        `已同步 Windows 字体目录。\n系统字体条目：${data.systemFontFiles ?? 0}\n保留的本地上传：${data.keptUploads ?? 0}\n合计：${data.total ?? 0}`
      );
      await refreshFontLibrary();
    } catch (e) {
      const msg =
        e instanceof TypeError && String(e.message).includes("fetch")
          ? "无法连接服务器（Failed to fetch）。请确认：1）终端里已运行 npm.cmd run dev；2）浏览器地址与终端显示的端口一致（如 http://127.0.0.1:3000）；3）若多次失败，先关掉终端再重新执行 npm.cmd run dev。"
          : e instanceof Error
            ? e.message
            : "同步系统字体失败";
      alert(msg);
    } finally {
      setSyncingSystemFonts(false);
    }
  }, [refreshFontLibrary]);

  const removeFont = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/fonts?id=${encodeURIComponent(id)}`, {
          method: "DELETE"
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "删除失败");
        }
        await refreshFontLibrary();
      } catch (e) {
        alert(e instanceof Error ? e.message : "删除字体失败");
      }
    },
    [refreshFontLibrary]
  );

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setFileName(file.name);

    const reader = new FileReader();
    if (file.type === "application/pdf") {
      // 简化：只处理单页 PDF，将其转为 data URL（真实场景可用 pdf.js 渲染）
      reader.readAsDataURL(file);
      reader.onload = () => {
        setPreviewUrl(null);
        setOriginalDataUrl(reader.result as string);
      };
    } else {
      reader.readAsDataURL(file);
      reader.onload = () => {
        setPreviewUrl(reader.result as string);
        setOriginalDataUrl(reader.result as string);
      };
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      handleFiles(event.dataTransfer.files);
    },
    [handleFiles]
  );

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(event.target.files);
    },
    [handleFiles]
  );

  const drawOnCanvas = useCallback((result: AnalyzeResponse | null) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !result) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!img.complete) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;

    /** 与屏幕上 img 显示尺寸一致，避免「画布按原图像素画、却被 CSS 缩放」导致线框错位 */
    let dw = img.clientWidth;
    let dh = img.clientHeight;
    if (dw < 2 || dh < 2) {
      dw = nw;
      dh = nh;
    }
    const sx = dw / nw;
    const sy = dh / nh;

    const dpr =
      typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    canvas.width = Math.round(dw * dpr);
    canvas.height = Math.round(dh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dw, dh);

    const width = dw;
    const height = dh;

    /** 先校正到 natural 像素，再收紧，再映射到显示坐标 */
    const fontsForDraw =
      Array.isArray(result.fonts) && result.fonts.length > 0
        ? (() => {
            const nat = rescaleBboxesToNatural(
              result.fonts.map((f) => f.bbox),
              nw,
              nh
            );
            const tightNat = tightenGlyphBoxes(img, nat);
            return result.fonts.map((f, i) => {
              const [x, y, w, h] = tightNat[i] ?? nat[i] ?? f.bbox;
              return {
                ...f,
                bbox: [
                  x * sx,
                  y * sy,
                  w * sx,
                  h * sy
                ] as [number, number, number, number]
              };
            });
          })()
        : [];

    const hasFonts = fontsForDraw.length > 0;

    /** 将相近坐标聚类为一条参考线（字形边缘对齐） */
    const clusterMeans = (values: number[], tol: number): number[] => {
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
    };

    const edgeTol = Math.max(3, Math.min(width, height) * 0.004);

    // 1. 字形边缘参考线：由各 bbox 左/右/上/下边聚类得到（优先于均分列网）
    if (hasFonts) {
      const lefts: number[] = [];
      const rights: number[] = [];
      const tops: number[] = [];
      const bottoms: number[] = [];
      for (const f of fontsForDraw) {
        const [x, y, w, h] = f.bbox;
        if (w > 1 && h > 1) {
          lefts.push(x);
          rights.push(x + w);
          tops.push(y);
          bottoms.push(y + h);
        }
      }
      const vx = [
        ...clusterMeans(lefts, edgeTol),
        ...clusterMeans(rights, edgeTol)
      ];
      const hy = [
        ...clusterMeans(tops, edgeTol),
        ...clusterMeans(bottoms, edgeTol)
      ];

      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(16, 185, 129, 0.85)";
      for (const x of vx) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
      for (const y of hy) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 2. 理论列网：gutter/columns 按 natural 理解，换算到显示宽度
    if (result.columns > 0) {
      const columns = result.columns;
      const gutterNat = result.gutter_px ?? 0;
      const totalGutterNat = gutterNat * (columns - 1);
      const columnWidthNat = (nw - totalGutterNat) / columns;
      const gutter = gutterNat * sx;
      const columnWidth = columnWidthNat * sx;
      const totalGutter = gutter * (columns - 1);

      if (!hasFonts) {
        ctx.save();
        for (let i = 0; i < columns; i++) {
          const x = i * columnWidth + i * gutter;
          ctx.fillStyle =
            i % 2 === 0
              ? "rgba(56, 189, 248, 0.08)"
              : "rgba(129, 140, 248, 0.08)";
          ctx.fillRect(x, 0, columnWidth, height);
        }
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = hasFonts
        ? "rgba(59, 130, 246, 0.22)"
        : "rgba(59, 130, 246, 0.7)";
      ctx.lineWidth = hasFonts ? 0.75 : 1;
      for (let i = 0; i <= columns; i++) {
        const x = i * columnWidth + Math.max(0, i - 1) * gutter;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. 基线网格：步长按 natural 高度换算到显示高度
    if (result.line_spacing?.baseline_grid === "yes") {
      const pt = result.line_spacing.pt || 0;
      const stepNat = pt > 0 ? (pt * 96) / 72 : 0;
      const stepPx = stepNat * sy;
      if (stepPx > 0) {
        ctx.save();
        ctx.strokeStyle = hasFonts
          ? "rgba(148, 163, 184, 0.28)"
          : "rgba(148, 163, 184, 0.5)";
        ctx.lineWidth = 0.5;
        for (let y = 0; y <= height; y += stepPx) {
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(width, y + 0.5);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 4. 字形 bbox（红框为像素收紧后的字形外沿）
    if (fontsForDraw.length > 0) {
      ctx.save();
      ctx.lineWidth = 2;
      ctx.font = "12px system-ui";
      ctx.textBaseline = "top";

      fontsForDraw.forEach((font, index) => {
        const [x, y, w, h] = font.bbox;

        // 外框
        ctx.strokeStyle = "rgba(248, 113, 113, 0.9)";
        ctx.strokeRect(x, y, w, h);

        // 标注文字背景
        const label = `${font.usage || "text"} • ${font.size_pt}pt`;
        const paddingX = 4;
        const paddingY = 2;
        const metrics = ctx.measureText(label);
        const textWidth = metrics.width + paddingX * 2;
        const textHeight = 14 + paddingY * 2;

        const labelX = x;
        const labelY = Math.max(0, y - textHeight - 2);

        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(labelX, labelY, textWidth, textHeight);

        ctx.fillStyle = "white";
        ctx.fillText(label, labelX + paddingX, labelY + paddingY);
      });

      ctx.restore();
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!originalDataUrl) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          imageBase64: originalDataUrl,
          fileName,
          fontLibrary:
            fontLibrary.length > 0
              ? fontLibrary.map((f) => ({ family: f.familyName }))
              : undefined
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        const message =
          err?.message ||
          err?.error ||
          `分析失败（HTTP ${res.status}）`;
        throw new Error(message);
      }

      const json = (await res.json()) as AnalyzeResponse;
      setAnalysisResult(json);
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "调用分析接口出错，请检查服务端配置。";
      alert(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [fileName, fontLibrary, originalDataUrl]);

  const handleDownloadLayoutTemplate = useCallback(() => {
    if (!analysisResult) {
      alert("请先完成分析。");
      return;
    }
    const img = imgRef.current;
    if (!img?.naturalWidth || !img.naturalHeight) {
      alert("请等待底部「原始图像」加载完成后再下载模板。");
      return;
    }
    const boxes =
      analysisResult.fonts?.length > 0
        ? computeNaturalTextBoxes(img, analysisResult)
        : [];
    const svg = buildLayoutTemplateSvg(
      analysisResult,
      img.naturalWidth,
      img.naturalHeight,
      boxes
    );
    const base =
      (fileName?.replace(/\.[^.]+$/i, "") || "design").trim() || "design";
    triggerSvgDownload(svg, base);
  }, [analysisResult, fileName]);

  const copyFontIdentification = useCallback(() => {
    const fi = analysisResult?.font_identification;
    if (!fi?.blocks.length) return;
    const esc = (s: string) => s.replace(/\|/g, "｜").replace(/\n/g, " ");
    const lines = [
      "字体名称 | 相似度 | 位置 | 字号 | 主色(采样) | 建议用途",
      ...fi.blocks.map(
        (b) =>
          `${esc(b.font_name)} | ${esc(b.similarity)} | ${esc(b.position)} | ${b.size_pt}pt | ${b.color_hex ?? "—"} | ${esc(b.usage)}`
      )
    ];
    void navigator.clipboard.writeText(lines.join("\n")).then(
      () => alert("已复制到剪贴板（制表符分隔，可粘贴到 Excel）。"),
      () => alert("复制失败，请手动选择表格复制。")
    );
  }, [analysisResult]);

  useEffect(() => {
    if (!analysisResult || !originalDataUrl) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) drawOnCanvas(analysisResult);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [analysisResult, originalDataUrl, drawOnCanvas]);

  /** 无云端或 403 回退时：用浏览器对上传图做连通域 + 列网粗测，替换固定模板 */
  useEffect(() => {
    const ar = analysisResult;
    if (!ar || ar.heuristic_enhanced) return;
    if (!ar.demo && !ar.fallback_reason_zh) return;
    if (fontLibrary.length === 0) return;

    let cancelled = false;
    const libNames = fontLibrary.map((f) => f.familyName.trim()).filter(Boolean);
    if (libNames.length === 0) return;

    const finishWithoutInference = (suffix: string) => {
      if (cancelled) return;
      setAnalysisResult((p) => {
        if (!p || p.heuristic_enhanced) return p;
        return {
          ...p,
          heuristic_enhanced: true,
          grid_system: `${p.grid_system}${suffix}`
        };
      });
    };

    const run = (attempt: number) => {
      if (cancelled) return;
      const img = imgRef.current;
      const cur = analysisResultRef.current;
      if (!cur || cur.heuristic_enhanced) return;

      if (!img?.naturalWidth) {
        if (attempt < 12) {
          window.setTimeout(() => run(attempt + 1), 100);
        } else {
          finishWithoutInference(
            "（本机粗测：图像尚未就绪，未替换版式。请待预览加载后重新分析。）"
          );
        }
        return;
      }

      const inferred = inferLayoutFromUploadedImage(img);
      if (!inferred || inferred.boxes.length === 0) {
        finishWithoutInference(
          "（本机粗测：未从图中分出稳定墨迹块，已保留字库轮询示意。请尽量使用高对比、清晰的设计稿。）"
        );
        return;
      }

      const nh = img.naturalHeight;
      const fonts = inferred.boxes.map((bbox, i) => {
        const bh = bbox[3];
        const size_pt = Math.max(
          9,
          Math.min(120, Math.round((bh / Math.max(1, nh)) * 380))
        );
        const li = librarySlotIndex(i, libNames.length);
        const family = libNames[li] ?? libNames[0]!;
        return {
          family,
          size_pt,
          weight: inferWeightFromLibraryName(family),
          usage: `图像粗检块 #${i + 1}（字库第 ${li + 1}/${libNames.length} 项「${family}」，非字形识别）`,
          bbox,
          region_label_zh: `检测块 ${i + 1}`,
          visual_similarity_zh: ""
        };
      });

      const fi = buildFontIdentificationReport(fonts, libNames, {
        normalizedBBox: false,
        mode: "local_library_only"
      });

      if (cancelled) return;
      setAnalysisResult((p) => {
        if (!p || p.heuristic_enhanced) return p;
        return {
          ...p,
          columns: inferred.columns,
          gutter_px: inferred.gutter_px,
          grid_system: inferred.grid_system,
          fonts,
          font_identification: fi,
          heuristic_enhanced: true
        };
      });
    };

    const t = window.setTimeout(() => run(0), 60);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [analysisResult, fontLibrary]);

  useEffect(() => {
    const fi = analysisResult?.font_identification;
    if (!fi?.blocks.length) return;
    if (fi.blocks.every((b) => b.color_hex)) return;

    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const img = imgRef.current;
        const prev = analysisResultRef.current;
        if (!img?.naturalWidth || !prev?.font_identification) return;
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        const boxes = rescaleBboxesToNatural(
          prev.fonts.map((f) => f.bbox),
          nw,
          nh
        );
        const colors = boxes.map((b) => sampleDominantInkColor(img, b));
        setAnalysisResult((cur) => {
          if (!cur?.font_identification) return cur;
          if (cur.font_identification.blocks.every((b) => b.color_hex)) return cur;
          return {
            ...cur,
            font_identification: mergeColorsIntoReport(
              cur.font_identification,
              colors
            )
          };
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [analysisResult, originalDataUrl]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            排版智能分析器
            <span className="ml-2 text-sm md:text-base text-muted-foreground align-middle">
              Typography & Grid Detector
            </span>
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            上传单页设计稿（JPG/PNG/PDF），自动检测网格系统、字体层级与行距，生成结构化报告。
            未配置密钥时须先<strong className="text-foreground/80"> 同步/上传本地字库 </strong>
            ：仅用字库名称与固定示意版式对照（不读图）；配置后可调用<strong className="text-foreground/80"> GPT-4o </strong>识图。
          </p>
          <p className="text-xs text-muted-foreground max-w-2xl">
            <strong className="font-medium text-foreground/80">给他人用：</strong>
            可双击项目里的 <code className="rounded bg-slate-200/80 px-1">局域网启动.bat</code>
            （会尝试放行防火墙），或执行 <code className="rounded bg-slate-200/80 px-1">npm.cmd run dev:lan</code>，或{" "}
            <code className="rounded bg-slate-200/80 px-1">npm.cmd run build</code> +{" "}
            <code className="rounded bg-slate-200/80 px-1">npm.cmd run start:public</code>
            ，            他人必须打开带端口的地址，例如{" "}
            <code className="rounded bg-slate-200/80 px-1">http://你的IP:3000</code>
            （不要省略 <code className="rounded bg-slate-200/80 px-1">:3000</code>
            ）。防火墙放行该端口；跨设备静态资源报错时在 .env.local 设置{" "}
            <code className="rounded bg-slate-200/80 px-1">NEXT_DEV_ALLOWED_ORIGINS=你的IP</code>
            。可先测{" "}
            <code className="rounded bg-slate-200/80 px-1">/api/health</code> 是否返回 JSON。详见{" "}
            <code className="rounded bg-slate-200/80 px-1">DEPLOY.md</code>。
          </p>
        </header>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：上传区 + 预览 + 开始分析 */}
          <div className="space-y-4">
            <div
              className={[
                "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-colors bg-white/60 backdrop-blur-sm",
                isDragging ? "border-primary bg-primary/5" : "border-borderMuted"
              ].join(" ")}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDrop={onDrop}
            >
              <input
                id="file-input"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                className="hidden"
                onChange={onFileInputChange}
              />
              <label
                htmlFor="file-input"
                className="flex flex-col items-center gap-2 cursor-pointer"
              >
                <span className="text-sm font-medium">
                  拖拽文件到此处，或点击选择
                </span>
                <span className="text-xs text-muted-foreground">
                  支持 JPG / PNG / PDF（单页）
                </span>
              </label>
              {fileName && (
                <p className="mt-3 text-xs text-muted-foreground">
                  当前文件：{fileName}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-borderMuted bg-white/80 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">
                  预览
                </h2>
                <Button
                  size="sm"
                  disabled={!originalDataUrl || isAnalyzing}
                  onClick={handleAnalyze}
                >
                  {isAnalyzing ? "分析中..." : "开始分析"}
                </Button>
              </div>

              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-borderMuted bg-slate-50 flex items-center justify-center">
                {previewUrl ? (
                  <Image
                    ref={imgRef as any}
                    src={previewUrl}
                    alt="预览图像"
                    fill
                    className="object-contain"
                  />
                ) : originalDataUrl ? (
                  <span className="text-xs text-muted-foreground px-4 text-center">
                    当前为 PDF 文件，顶部预览不显示；请查看底部原始图像区域。
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    等待上传图像...
                  </span>
                )}
              </div>
            </div>

            {/* 本地字体库：上传后分析会优先从下列 family 匹配 */}
            <div className="rounded-xl border border-borderMuted bg-white/80 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-muted-foreground">
                  我的字体库
                </h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    disabled={
                      fontUploading || syncingSystemFonts
                    }
                    onClick={() => void syncWindowsFonts()}
                  >
                    {syncingSystemFonts
                      ? "同步中…"
                      : "同步 Windows 字体"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={fontUploading || syncingSystemFonts}
                    onClick={() =>
                      document.getElementById("font-input")?.click()
                    }
                  >
                    {fontUploading ? "上传中…" : "上传字体"}
                  </Button>
                </div>
                <input
                  id="font-input"
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                  multiple
                  className="hidden"
                  disabled={fontUploading || syncingSystemFonts}
                  onChange={(e) => {
                    void handleFontFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                「同步 Windows 字体」会扫描{" "}
                <code className="rounded bg-slate-100 px-1">%WINDIR%\Fonts</code>{" "}
               （一般为{" "}
                <code className="rounded bg-slate-100 px-1">
                  C:\Windows\Fonts
                </code>
                ），把<strong>全部</strong> TTF/OTF/TTC 的族名加入列表（不复制文件，仅本机开发服务可读）。
                手动上传仍保存在项目 <code className="rounded bg-slate-100 px-1">uploads/fonts</code>。
                再次同步会<strong>替换</strong>上一次的系统字体条目，并保留你的上传项。
              </p>
              {fontLibrary.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  尚未添加字体。可点击「同步 Windows 字体」或「上传字体」。
                </p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-auto text-sm">
                  {fontLibrary.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-borderMuted bg-white px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 truncate font-medium">
                          <span className="truncate">{f.familyName}</span>
                          <span
                            className={
                              (f.source ?? "upload") === "system"
                                ? "shrink-0 rounded bg-sky-100 px-1.5 py-0 text-[10px] text-sky-900"
                                : "shrink-0 rounded bg-violet-100 px-1.5 py-0 text-[10px] text-violet-900"
                            }
                          >
                            {(f.source ?? "upload") === "system"
                              ? "系统"
                              : "上传"}
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {f.originalFileName}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-destructive"
                        onClick={() => void removeFont(f.id)}
                      >
                        删除
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 右侧：Tabs 分析结果 */}
          <div className="rounded-xl border border-borderMuted bg-white/90 backdrop-blur-sm p-4 flex flex-col">
            {analysisResult?.fallback_reason_zh && (
              <div className="mb-3 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                <p className="font-medium">OpenAI 不可用，已自动改用本地字库</p>
                <p className="mt-1 text-sky-900/95 whitespace-pre-wrap">
                  {analysisResult.fallback_reason_zh}
                </p>
              </div>
            )}
            {analysisResult?.demo && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <p className="font-medium">当前为本地对照模式</p>
                <p className="mt-1 text-amber-900/90">
                  {analysisResult.fallback_reason_zh
                    ? "上方面板已说明云端接口情况。本机会对**上传图**做墨迹连通域粗测以生成红框与列网估计；**字体名**仍从字库轮询绑定，不是从笔画识别出的字款。"
                    : "未配置 API 时：请先同步/上传字库。分析后浏览器会对**上传图**粗测文字块位置与列网；字体名仍按字库轮询对照。若要云端识字形，请配置 OPENAI_API_KEY 或合规的 OPENAI_API_BASE。"}
                </p>
              </div>
            )}
            <Tabs
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as AnalysisTabKey)}
              className="flex-1 flex flex-col"
            >
              <TabsList className="mb-2 flex max-w-full flex-wrap gap-1 self-start">
                <TabsTrigger value="grid">网格系统</TabsTrigger>
                <TabsTrigger value="layout">版式解读</TabsTrigger>
                <TabsTrigger value="typography">字体层级</TabsTrigger>
                <TabsTrigger value="leading">行距测量</TabsTrigger>
                <TabsTrigger value="report">完整报告</TabsTrigger>
                <TabsTrigger value="template">提取模板</TabsTrigger>
              </TabsList>

              <div className="flex-1 min-h-[260px]">
                <TabsContent value="grid">
                  <h3 className="text-sm font-medium mb-2">网格系统分析</h3>
                  {analysisResult ? (
                    <div className="space-y-2 text-sm">
                      <div className="rounded-md border border-borderMuted p-3 bg-white">
                        <p>
                          <span className="font-medium">网格类型：</span>
                          {analysisResult.grid_system}
                        </p>
                        <p>
                          <span className="font-medium">列数：</span>
                          {analysisResult.columns}
                        </p>
                        <p>
                          <span className="font-medium">列间距：</span>
                          {analysisResult.gutter_px}px
                        </p>
                        {analysisResult.layout_analysis?.type_tags?.length ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              类型标签：
                            </span>
                            {analysisResult.layout_analysis.type_tags.join(" · ")}
                          </p>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        完整文字解读见「版式解读」标签。
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">等待分析结果...</p>
                  )}
                </TabsContent>

                <TabsContent value="layout">
                  <h3 className="text-sm font-medium mb-2">
                    版式与网格解读（文字结果）
                  </h3>
                  {analysisResult?.layout_analysis ? (
                    <div className="max-h-[28rem] space-y-3 overflow-y-auto text-sm">
                      <div className="rounded-md border border-borderMuted bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          网格系统判定
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                          {analysisResult.layout_analysis.overview_zh}
                        </p>
                      </div>
                      <div className="rounded-md border border-borderMuted bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          网格结构细节
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                          {analysisResult.layout_analysis.structure_zh}
                        </p>
                      </div>
                      <div className="rounded-md border border-borderMuted bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          比例与视觉焦点
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                          {analysisResult.layout_analysis.composition_focal_zh}
                        </p>
                      </div>
                      <div className="rounded-md border border-borderMuted bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          设计意图与建议
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                          {analysisResult.layout_analysis.intent_critique_zh}
                        </p>
                      </div>
                      <div className="rounded-md border border-borderMuted bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          具体位置描述
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                          {analysisResult.layout_analysis.spatial_labels_zh}
                        </p>
                      </div>
                      <div className="rounded-md border border-borderMuted bg-slate-950 p-3 text-slate-100">
                        <p className="text-xs font-semibold text-slate-400">
                          文字示意图
                        </p>
                        <pre className="mt-2 overflow-x-auto font-mono text-xs leading-tight">
                          {analysisResult.layout_analysis.ascii_diagram}
                        </pre>
                      </div>
                      {analysisResult.layout_analysis.summary_bullets?.length ? (
                        <div className="rounded-md border border-borderMuted bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            要点列表
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {analysisResult.layout_analysis.summary_bullets.map(
                              (b, i) => (
                                <li key={i}>{b}</li>
                              )
                            )}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : analysisResult ? (
                    <p className="text-xs text-muted-foreground">
                      本次结果未包含版式解读字段，请重新运行分析（需配置 API Key
                      且模型完整返回 JSON）。
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">等待分析结果...</p>
                  )}
                </TabsContent>

                <TabsContent value="typography">
                  <h3 className="text-sm font-medium mb-2">字体识别与层级</h3>
                  {analysisResult ? (
                    <div className="space-y-3 max-h-[min(70vh,520px)] overflow-auto pr-1">
                      {analysisResult.font_identification ? (
                        <>
                          <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-amber-400/80 pl-2">
                            {analysisResult.font_identification.disclaimer_zh}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            标准列对应需求：
                            <strong className="font-medium text-foreground">字体名称</strong> |{" "}
                            <strong className="font-medium text-foreground">相似度</strong> |{" "}
                            <strong className="font-medium text-foreground">位置</strong> |{" "}
                            <strong className="font-medium text-foreground">建议用途</strong>
                            ；另附字号、主色（采样优先，次为模型 ink）。
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={copyFontIdentification}
                            >
                              复制结构化报告
                            </Button>
                          </div>
                          <div className="overflow-x-auto rounded-md border border-borderMuted">
                            <table className="w-full min-w-[640px] text-left text-xs">
                              <thead className="bg-slate-100/90 sticky top-0 z-[1]">
                                <tr>
                                  <th className="p-2 font-medium whitespace-nowrap">
                                    #
                                  </th>
                                  <th className="p-2 font-medium whitespace-nowrap">
                                    字体名称
                                  </th>
                                  <th className="p-2 font-medium min-w-[140px]">
                                    相似度（库匹配+视觉）
                                  </th>
                                  <th className="p-2 font-medium min-w-[120px]">
                                    位置
                                  </th>
                                  <th className="p-2 font-medium whitespace-nowrap">
                                    字号
                                  </th>
                                  <th className="p-2 font-medium whitespace-nowrap">
                                    主色
                                  </th>
                                  <th className="p-2 font-medium min-w-[100px]">
                                    建议用途
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {analysisResult.font_identification.blocks.map(
                                  (b) => (
                                    <tr
                                      key={b.index}
                                      className="border-t border-borderMuted bg-white align-top"
                                    >
                                      <td className="p-2 text-muted-foreground">
                                        {b.index}
                                      </td>
                                      <td className="p-2 font-medium">
                                        {b.font_name}
                                      </td>
                                      <td className="p-2 text-muted-foreground">
                                        {b.similarity}
                                      </td>
                                      <td className="p-2 text-muted-foreground">
                                        {b.position}
                                      </td>
                                      <td className="p-2 whitespace-nowrap">
                                        {b.size_pt}pt
                                      </td>
                                      <td className="p-2">
                                        {b.color_hex ? (
                                          <div className="space-y-0.5">
                                            <span className="inline-flex items-center gap-1.5">
                                              <span
                                                className="inline-block h-4 w-4 rounded border border-borderMuted shrink-0"
                                                style={{
                                                  backgroundColor: b.color_hex
                                                }}
                                                title={b.color_hex}
                                              />
                                              <code className="text-[10px]">
                                                {b.color_hex}
                                              </code>
                                            </span>
                                            {b.model_ink_hex &&
                                            b.model_ink_hex !== b.color_hex ? (
                                              <p className="text-[10px] text-muted-foreground">
                                                模型参考 {b.model_ink_hex}
                                              </p>
                                            ) : null}
                                          </div>
                                        ) : (
                                          <span className="text-muted-foreground">
                                            采样中…
                                          </span>
                                        )}
                                      </td>
                                      <td className="p-2">{b.usage}</td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : null}
                      <p className="text-xs font-medium text-muted-foreground">
                        原始条目（family / bbox）
                      </p>
                      <div className="space-y-2">
                        {analysisResult.fonts.map((font, idx) => (
                          <div
                            key={`${font.usage}-${idx}`}
                            className="rounded-md border border-borderMuted p-3 bg-white text-sm"
                          >
                            <p className="font-medium">{font.usage}</p>
                            <p>字体：{font.family}</p>
                            <p>
                              字号：{font.size_pt}pt · 字重：{font.weight}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              bbox: [{font.bbox.join(", ")}]
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">等待分析结果...</p>
                  )}
                </TabsContent>

                <TabsContent value="leading">
                  <h3 className="text-sm font-medium mb-2">行距测量</h3>
                  {analysisResult ? (
                    <div className="rounded-md border border-borderMuted p-3 bg-white text-sm space-y-1">
                      <p>
                        <span className="font-medium">行距倍率：</span>
                        {analysisResult.line_spacing.em}em
                      </p>
                      <p>
                        <span className="font-medium">行距（pt）：</span>
                        {analysisResult.line_spacing.pt}pt
                      </p>
                      <p>
                        <span className="font-medium">是否贴合基线网格：</span>
                        {analysisResult.line_spacing.baseline_grid === "yes"
                          ? "是"
                          : "否"}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">等待分析结果...</p>
                  )}
                </TabsContent>

                <TabsContent value="template">
                  <h3 className="text-sm font-medium mb-2">提取排版模板（SVG）</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    根据当前分析结果，生成与源图同尺寸的矢量模板：列参考线、（若模型标注三分法）三分辅助线、基线网格示意、文字块占位框与边缘对齐参考线。可在
                    Illustrator / Figma（导入 SVG）中继续编辑。
                  </p>
                  {analysisResult ? (
                    <div className="space-y-3">
                      <Button
                        type="button"
                        onClick={handleDownloadLayoutTemplate}
                        className="w-full sm:w-auto"
                      >
                        下载 SVG 模板
                      </Button>
                      <div className="rounded-md border border-borderMuted bg-white p-3 text-xs text-muted-foreground space-y-1">
                        <p>
                          <span className="font-medium text-foreground">
                            画布尺寸：
                          </span>
                          与底部原始图像的 natural 尺寸一致（当前需已加载出图像）。
                        </p>
                        <p>
                          <span className="font-medium text-foreground">
                            文字框：
                          </span>
                          与叠加层相同逻辑（坐标校正 + 字形外沿收紧）。
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      完成「开始分析」后，可在此下载模板。
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="report">
                  <h3 className="text-sm font-medium mb-2">完整报告</h3>
                  {analysisResult ? (
                    <div className="rounded-md border border-borderMuted p-3 bg-white text-sm space-y-2">
                      <p>
                        <span className="font-medium">对齐方式：</span>
                        {analysisResult.other.alignment}
                      </p>
                      <p>
                        <span className="font-medium">层级评分：</span>
                        {analysisResult.other.hierarchy_score}
                      </p>
                      <div>
                        <p className="font-medium">色板：</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {analysisResult.other.color_palette.map((c) => (
                            <div
                              key={c}
                              className="h-6 w-16 rounded border border-borderMuted text-[10px] text-center leading-6"
                              style={{ backgroundColor: c }}
                              title={c}
                            >
                              {c}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">等待分析结果...</p>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </section>

        {/* 底部：原始图像 + Canvas 叠加 */}
        <section className="mt-2 rounded-xl border border-borderMuted bg-white/90 p-4 space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            原始图像 &amp; 网格/文字框叠加
          </h2>
          <p className="text-xs text-muted-foreground">
            叠加层按<strong>当前显示尺寸</strong>与图片对齐，并自动校正模型坐标（归一化 0~1
            或整体偏小/偏大）。绿/橙线为收紧后 bbox 的边聚类；红框为 ROI
            内亮度分位数阈值得到的墨色外沿。复杂底纹时仍可能有偏差。
          </p>
          <div className="relative w-full overflow-auto border rounded-lg border-borderMuted bg-slate-50">
            <div className="relative inline-block">
              {originalDataUrl ? (
                <>
                  {/* 原始图像 */}
                  {/* 这里不用 next/image，方便和 canvas 绝对对齐 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imgRef}
                    src={originalDataUrl}
                    alt="原始图像"
                    className="block max-h-[480px] w-auto"
                    onLoad={() => {
                      requestAnimationFrame(() =>
                        requestAnimationFrame(() => {
                          const r = analysisResultRef.current;
                          if (r) drawOnCanvas(r);
                        })
                      );
                    }}
                  />
                  {/* Canvas 覆盖层 */}
                  <canvas
                    ref={canvasRef}
                    className="pointer-events-none absolute inset-0 w-full h-full"
                  />
                </>
              ) : (
                <div className="flex items-center justify-center h-40 px-4 text-xs text-muted-foreground">
                  上传图像后，将在此显示原始图像和检测到的网格/文字框。
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

