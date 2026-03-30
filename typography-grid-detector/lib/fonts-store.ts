import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import opentype from "opentype.js";

export const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "fonts");
export const MANIFEST = path.join(UPLOAD_ROOT, "manifest.json");

/** source=upload：文件在 uploads；source=system：仅记录 Windows\Fonts 路径，不复制文件 */
export type FontLibraryEntry = {
  id: string;
  familyName: string;
  originalFileName: string;
  uploadedAt: string;
  source: "upload" | "system";
  storedFileName?: string;
  systemPath?: string;
};

export async function ensureFontsDir() {
  await mkdir(UPLOAD_ROOT, { recursive: true });
}

export function readNameFromFont(font: opentype.Font): string {
  const names = font.names;
  const pick = (v: unknown): string | undefined => {
    if (!v) return undefined;
    if (typeof v === "string") return v;
    if (typeof v === "object" && v !== null && "en" in v) {
      const en = (v as { en?: string }).en;
      if (typeof en === "string" && en.trim()) return en.trim();
    }
    return undefined;
  };
  return (
    pick(names.fontFamily) ||
    pick(names.fullName) ||
    pick(names.postScriptName) ||
    "Unknown"
  );
}

function normalizeManifestRow(raw: Record<string, unknown>): FontLibraryEntry {
  const id = String(raw.id ?? "");
  const familyName = String(raw.familyName ?? "");
  const originalFileName = String(raw.originalFileName ?? "");
  const uploadedAt = String(raw.uploadedAt ?? new Date().toISOString());
  const systemPath =
    typeof raw.systemPath === "string" ? raw.systemPath : undefined;
  const storedFileName =
    typeof raw.storedFileName === "string" ? raw.storedFileName : undefined;
  const sourceRaw = raw.source;
  const source: "upload" | "system" =
    sourceRaw === "system" || systemPath
      ? "system"
      : "upload";
  return {
    id,
    familyName,
    originalFileName,
    uploadedAt,
    source,
    ...(storedFileName ? { storedFileName } : {}),
    ...(systemPath ? { systemPath } : {})
  };
}

export async function readManifest(): Promise<FontLibraryEntry[]> {
  try {
    const text = await readFile(MANIFEST, "utf-8");
    const data = JSON.parse(text) as unknown;
    if (!Array.isArray(data)) return [];
    return data.map((row) =>
      normalizeManifestRow(typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {})
    );
  } catch {
    return [];
  }
}

export async function writeManifest(entries: FontLibraryEntry[]) {
  await writeFile(MANIFEST, JSON.stringify(entries, null, 2), "utf-8");
}

export function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export async function removeFontEntry(entry: FontLibraryEntry) {
  if (entry.source === "upload" && entry.storedFileName) {
    try {
      await unlink(path.join(UPLOAD_ROOT, entry.storedFileName));
    } catch {
      // 忽略
    }
  }
}
