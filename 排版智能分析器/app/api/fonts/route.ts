import { writeFile } from "fs/promises";
import { NextRequest } from "next/server";
import path from "path";
import opentype from "opentype.js";
import {
  ensureFontsDir,
  readManifest,
  readNameFromFont,
  removeFontEntry,
  sanitizeFileName,
  UPLOAD_ROOT,
  writeManifest,
  type FontLibraryEntry
} from "@/lib/fonts-store";

export const runtime = "nodejs";

export type { FontLibraryEntry };

export async function GET() {
  await ensureFontsDir();
  const fonts = await readManifest();
  return Response.json({ fonts });
}

export async function POST(request: NextRequest) {
  await ensureFontsDir();
  const form = await request.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return Response.json({ error: "缺少 file 字段" }, { status: 400 });
  }

  const lower = file.name.toLowerCase();
  const ok =
    lower.endsWith(".ttf") ||
    lower.endsWith(".otf") ||
    lower.endsWith(".woff") ||
    lower.endsWith(".woff2");
  if (!ok) {
    return Response.json(
      { error: "仅支持 .ttf / .otf / .woff / .woff2" },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let familyName = path.basename(file.name, path.extname(file.name));
  try {
    const font = opentype.parse(new Uint8Array(buf));
    familyName = readNameFromFont(font) || familyName;
  } catch {
    // 解析失败时退回文件名
  }

  const id = crypto.randomUUID();
  const storedFileName = `${id}-${sanitizeFileName(file.name)}`;
  const diskPath = path.join(UPLOAD_ROOT, storedFileName);
  await writeFile(diskPath, buf);

  const entry: FontLibraryEntry = {
    id,
    familyName,
    originalFileName: file.name,
    storedFileName,
    uploadedAt: new Date().toISOString(),
    source: "upload"
  };

  const list = await readManifest();
  list.push(entry);
  await writeManifest(list);

  return Response.json({ font: entry });
}

export async function DELETE(request: NextRequest) {
  await ensureFontsDir();
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "缺少 id" }, { status: 400 });
  }

  const list = await readManifest();
  const idx = list.findIndex((f) => f.id === id);
  if (idx === -1) {
    return Response.json({ error: "未找到该字体" }, { status: 404 });
  }

  const [removed] = list.splice(idx, 1);
  await removeFontEntry(removed);
  await writeManifest(list);

  return Response.json({ ok: true });
}
