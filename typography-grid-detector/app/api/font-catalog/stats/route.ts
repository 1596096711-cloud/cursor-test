import {
  getBuiltinFontCatalogCount
} from "@/lib/font-catalog-merge";

export const runtime = "edge";

export async function GET() {
  return Response.json({
    builtinCount: getBuiltinFontCatalogCount()
  });
}
