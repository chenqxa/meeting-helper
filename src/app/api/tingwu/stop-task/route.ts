import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ROAClient } = require('@alicloud/pop-core');

// 停止听悟实时任务
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json({ success: false, error: '缺少 taskId' }, { status: 400 });
    }

    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
    const appKey = process.env.TINGWU_APP_KEY;

    if (!appKey) {
      return NextResponse.json({ success: false, error: '未配置 TINGWU_APP_KEY' }, { status: 500 });
    }

    if (!accessKeyId || !accessKeySecret) {
      return NextResponse.json(
        { success: false, error: '未配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET' },
        { status: 500 }
      );
    }

    const client = new ROAClient({
      accessKeyId,
      accessKeySecret,
      endpoint: 'https://tingwu.cn-beijing.aliyuncs.com',
      apiVersion: '2023-09-30',
    });

    const requestBody = {
      AppKey: appKey,
      Input: {
        TaskId: taskId,
      },
    };

    console.log('[Tingwu] 停止任务, taskId:', taskId);

    const response = await client.request(
      'PUT',
      '/openapi/tingwu/v2/tasks',
      { type: 'realtime', operation: 'stop' },
      JSON.stringify(requestBody),
      { 'Content-Type': 'application/json' }
    );

    console.log('[Tingwu] 停止任务响应:', response);

    const res = response as any;
    if (res.Code !== '0') {
      return NextResponse.json(
        { success: false, error: `停止任务失败: ${res.Message || res.Code}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Tingwu] StopTask Error:', error.message, error.data);
    return NextResponse.json(
      { success: false, error: `${error.message}${error.data ? ' | ' + JSON.stringify(error.data) : ''}` },
      { status: 500 }
    );
  }
}
