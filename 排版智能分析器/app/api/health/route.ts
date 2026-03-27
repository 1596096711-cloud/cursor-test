import { NextResponse } from "next/server";

/** 供局域网内其它设备检测服务是否可达：GET /api/health */
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
