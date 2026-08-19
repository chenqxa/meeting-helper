import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ROAClient } = require('@alicloud/pop-core');

// 创建听悟实时记录任务（ROA 风格 API）
// 文档: https://help.aliyun.com/zh/tingwu/api-tingwu-2023-09-30-createtask
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { speakerCount } = body;

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
        Format: 'pcm',
        SampleRate: 16000,
        SourceLanguage: 'cn',
      },
      Parameters: {
        Transcription: {
          OutputLevel: 2,
          DiarizationEnabled: true,
          Diarization: {
            SpeakerCount: typeof speakerCount === 'number' && speakerCount > 0 ? speakerCount : 0,
          },
        },
      },
    };

    console.log('[Tingwu] 创建任务...');

    const response = await client.request(
      'PUT',
      '/openapi/tingwu/v2/tasks',
      { type: 'realtime' },
      JSON.stringify(requestBody),
      { 'Content-Type': 'application/json' }
    );

    console.log('[Tingwu] CreateTask 响应:', response);

    const res = response as any;
    if (res.Code !== '0') {
      return NextResponse.json(
        { success: false, error: `创建任务失败: ${res.Message || res.Code}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      taskId: res.Data.TaskId,
      streamUrl: res.Data.MeetingJoinUrl,
    });
  } catch (error: any) {
    console.error('[Tingwu] CreateTask Error:', error.message, error.data);
    return NextResponse.json(
      { success: false, error: `${error.message}${error.data ? ' | ' + JSON.stringify(error.data) : ''}` },
      { status: 500 }
    );
  }
}
