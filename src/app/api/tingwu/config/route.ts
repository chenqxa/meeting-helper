import { NextResponse } from 'next/server';

export async function GET() {
  const appKey = process.env.TINGWU_APP_KEY;
  if (!appKey) {
    return NextResponse.json({ success: false, error: '未配置 TINGWU_APP_KEY' }, { status: 500 });
  }
  return NextResponse.json({ success: true, appKey });
}
