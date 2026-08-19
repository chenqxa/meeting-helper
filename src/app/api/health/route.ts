import { NextResponse } from 'next/server';

// GET /api/health - 健康检查（docker healthcheck 使用）
export async function GET() {
  return NextResponse.json({ status: 'ok', time: new Date().toISOString() });
}
