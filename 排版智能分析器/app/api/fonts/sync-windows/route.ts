import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import opentype from "opentype.js";
import {
  ensureFontsDir,
  readManifest,
  readNameFromFont,
  writeManifest,
  type FontLibraryEntry
} from "@/lib/fonts-store";

export const runtime = "nodejs";

/** 超过此大小不整文件读入内存，仅用文件名作为族名（避免 OOM / 超时导致 Failed to fetch） */
const MAX_PARSE_BYTES = 12 * 1024 * 1024;

export async function POST() {
  try {
    if (process.platform !== "win32") {
      return Response.json(
        { error: "仅支持在 Windows 上从系统字体目录同步" },
        { status: 400 }
      );
    }

    await ensureFontsDir();

    const windir = process.env.WINDIR || "C:\\Windows";
    const fontsDir = path.join(windir, "Fonts");

    let dirNames: string[];
    try {
      dirNames = await readdir(fontsDir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json(
        { error: `无法读取系统字体目录：${fontsDir}`, detail: msg },
        { status: 500 }
      );
    }

    const existing = await readManifest();
    const kept = existing.filter((e) => e.source === "upload");

    const systemEntries: FontLibraryEntry[] = [];
    const fileNames = dirNames.filter((n) => /\.(ttf|otf|ttc)$/i.test(n));

    for (const name of fileNames) {
      const fullPath = path.join(fontsDir, name);
      let familyName = path.basename(name, path.extname(name));
      const lower = name.toLowerCase();

      try {
        if (lower.endsWith(".ttc")) {
          // 合集文件往往很大，opentype.js 易失败或占内存；仅用文件名
          systemEntries.push({
            id: crypto.randomUUID(),
            familyName,
            originalFileName: name,
            systemPath: fullPath,
            uploadedAt: new Date().toISOString(),
            source: "system"
          });
          continue;
        }

        const st = await stat(fullPath);
        if (!st.isFile()) continue;

        if (st.size > MAX_PARSE_BYTES) {
          systemEntries.push({
            id: crypto.randomUUID(),
            familyName,
            originalFileName: name,
            systemPath: fullPath,
            uploadedAt: new Date().toISOString(),
            source: "system"
          });
          continue;
        }

        const buf = await readFile(fullPath);
        try {
          const font = opentype.parse(new Uint8Array(buf));
          familyName = readNameFromFont(font) || familyName;
        } catch {
          // 解析失败保留文件名
        }
      } catch {
        // stat/read 失败则跳过该文件
        continue;
      }

      systemEntries.push({
        id: crypto.randomUUID(),
        familyName,
        originalFileName: name,
        systemPath: fullPath,
        uploadedAt: new Date().toISOString(),
        source: "system"
      });
    }

    await writeManifest([...kept, ...systemEntries]);

    return Response.json({
      ok: true,
      systemFontFiles: systemEntries.length,
      keptUploads: kept.length,
      total: kept.length + systemEntries.length,
      fontsDir
    });
  } catch (e) {
    console.error("[sync-windows]", e);
    const message = e instanceof Error ? e.message : "同步失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
