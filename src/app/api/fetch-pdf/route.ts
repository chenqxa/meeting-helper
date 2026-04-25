import { NextRequest, NextResponse } from 'next/server';
import { FetchClient, Config } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const config = new Config();
    const client = new FetchClient(config);

    const response = await client.fetch(url);

    if (response.status_code !== 0) {
      return NextResponse.json({
        error: 'Failed to fetch URL',
        message: response.status_message
      }, { status: 400 });
    }

    // Extract text content
    const textContent = response.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');

    return NextResponse.json({
      title: response.title,
      content: textContent,
      url: response.url,
      filetype: response.filetype,
    });

  } catch (error) {
    console.error('Error fetching URL:', error);
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
