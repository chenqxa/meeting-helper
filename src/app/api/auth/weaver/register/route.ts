import { NextResponse } from 'next/server';
import { registerWithOA } from '@/lib/weaver-sso';

// 注册许可接口（只需调用一次）
// 调用后会返回 spk 和 secret，需要手动配置到 .env
export async function POST() {
  try {
    console.log('[Weaver SSO] 开始注册, OA URL:', process.env.WEAVER_OA_URL);
    console.log('[Weaver SSO] APPID:', process.env.WEAVER_OA_APPID);
    
    const result = await registerWithOA();

    return NextResponse.json({
      success: true,
      message: '注册成功！请将以下值配置到 .env 文件',
      data: {
        WEAVER_OA_SPK: result.spk,
        WEAVER_OA_SECRET: result.secret,
      },
    });
  } catch (error) {
    console.error('[Weaver SSO] 注册失败:', error);
    console.error('[Weaver SSO] 错误详情:', error instanceof Error ? error.stack : String(error));
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '注册失败',
        details: error instanceof Error ? error.stack : String(error),
      },
      { status: 500 }
    );
  }
}
