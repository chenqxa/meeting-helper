import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ROAClient } = require('@alicloud/pop-core');

// 查询听悟任务状态和结果
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ success: false, error: '缺少 taskId' }, { status: 400 });
    }

    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

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

    console.log('[Tingwu] 查询任务, taskId:', taskId);

    const response = await client.request(
      'GET',
      `/openapi/tingwu/v2/tasks/${taskId}`,
      {},
      '',
      {}
    );

    console.log('[Tingwu] 查询任务响应:', JSON.stringify(response, null, 2));

    const res = response as any;
    if (res.Code !== '0') {
      return NextResponse.json(
        { success: false, error: `查询任务失败: ${res.Message || res.Code}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      taskStatus: res.Data.TaskStatus,
      transcription: res.Data.Transcription,
      meetingAssistance: res.Data.MeetingAssistance,
      summarization: res.Data.Summarization,
      _debug: res.Data, // 调试用
    });
  } catch (error: any) {
    console.error('[Tingwu] GetTask Error:', error.message, error.data);
    return NextResponse.json(
      { success: false, error: `${error.message}${error.data ? ' | ' + JSON.stringify(error.data) : ''}` },
      { status: 500 }
    );
  }
}
