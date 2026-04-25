import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ success: false, error: '未收到文件' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    let text = '';

    if (fileName.endsWith('.txt')) {
      // TXT 直接读取
      text = buffer.toString('utf-8');
    } else if (fileName.endsWith('.docx')) {
      // DOCX 用 mammoth 解析
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      return NextResponse.json({ success: false, error: '仅支持 .txt 和 .docx 文件' }, { status: 400 });
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return NextResponse.json({ success: false, error: '文件内容为空' }, { status: 400 });
    }

    return NextResponse.json({ success: true, text: trimmed, wordCount: trimmed.length });
  } catch (error: any) {
    console.error('[ParseFile] Error:', error);
    return NextResponse.json(
      { success: false, error: '文件解析失败: ' + (error.message || '未知错误') },
      { status: 500 }
    );
  }
}
