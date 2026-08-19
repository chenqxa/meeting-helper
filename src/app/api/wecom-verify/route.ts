import { NextRequest, NextResponse } from 'next/server';

/**
 * 企业微信域名验证文件 - 通用处理
 * 匹配所有 /WW_verify_*.txt 请求
 *
 * 使用方法：
 * 1. 从企业微信后台下载验证文件，复制内容
 * 2. 在下面的 VERIFY_FILES 对象中添加配置
 * 3. 重启服务
 * 4. 访问 http://hjoa.chinahy-soft.com:15815/WW_verify_xxxxx.txt
 */

// 配置多个验证文件（如果有多个应用）
const VERIFY_FILES: Record<string, string> = {
  // 示例：'WW_verify_abc123xyz.txt': '这里填写验证文件内容',

  // ⬇️ 请在下面添加你的验证文件配置
  'WW_verify_placeholder.txt': '请将从企业微信下载的验证码内容粘贴到这里',
};

export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const filename = pathname.split('/').pop() || '';

  // 查找对应的验证内容
  const content = VERIFY_FILES[filename];

  if (!content || content.includes('请将')) {
    return NextResponse.json(
      {
        error: '验证文件未配置',
        message: '请编辑 src/middleware.ts 中的 VERIFY_FILES 配置',
        requestedFile: filename,
      },
      { status: 404 }
    );
  }

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
