import { NextResponse } from 'next/server';
import WebSocket from 'ws';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProbeResult = {
  url: string;
  outcome: 'session.updated' | 'error' | 'unexpected-response' | 'close' | 'timeout';
  durationMs: number;
  detail?: string;
  closeCode?: number;
  closeReason?: string;
  events: string[];
};

function sanitizeEnv(value: string | undefined) {
  return String(value || '').replace(/[^\x20-\x7E]/g, '').trim();
}

function resolveDashscopeApiKey() {
  const dashscopeKey = sanitizeEnv(process.env.DASHSCOPE_API_KEY);
  const qwenKey = sanitizeEnv(process.env.QWEN_API_KEY);
  const isRealKey = (value: string) => /^sk-[A-Za-z0-9]{16,}$/.test(value);

  if (isRealKey(dashscopeKey)) return { apiKey: dashscopeKey, keySource: 'DASHSCOPE_API_KEY' as const };
  if (isRealKey(qwenKey)) return { apiKey: qwenKey, keySource: 'QWEN_API_KEY' as const };
  return {
    apiKey: dashscopeKey || qwenKey,
    keySource: dashscopeKey ? 'DASHSCOPE_API_KEY' as const : qwenKey ? 'QWEN_API_KEY' as const : 'none' as const,
  };
}

function buildTargets(model: string) {
  const region = sanitizeEnv(process.env.QWEN_REGION || 'cn').toLowerCase();
  const defaultBase = region === 'intl'
    ? 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime'
    : 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
  const primaryBase = sanitizeEnv(process.env.QWEN_WS_BASE_URL || defaultBase);
  const backupBase = primaryBase.includes('dashscope-intl.aliyuncs.com')
    ? 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
    : 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';
  return [
    `${primaryBase}?model=${encodeURIComponent(model)}`,
    `${backupBase}?model=${encodeURIComponent(model)}`,
  ];
}

function probe(url: string, apiKey: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const events: string[] = [];
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
      handshakeTimeout: 10000,
    });

    let settled = false;
    const finish = (result: Omit<ProbeResult, 'url' | 'durationMs' | 'events'>) => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch {}
      resolve({
        url,
        durationMs: Date.now() - startedAt,
        events,
        ...result,
      });
    };

    const failTimer = setTimeout(() => {
      finish({ outcome: 'timeout', detail: 'No open/session.updated within timeout window' });
    }, 15000);

    ws.on('open', () => {
      events.push('open');
      ws.send(JSON.stringify({
        event_id: `health_${Date.now()}`,
        type: 'session.update',
        session: {
          input_audio_format: 'pcm',
          sample_rate: 16000,
          input_audio_transcription: { language: 'zh' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.0,
            silence_duration_ms: 400,
          },
        },
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const type = String(msg?.type || 'unknown');
        events.push(type);
        if (type === 'session.updated') {
          clearTimeout(failTimer);
          finish({ outcome: 'session.updated' });
          return;
        }
        if (type === 'error') {
          clearTimeout(failTimer);
          finish({
            outcome: 'error',
            detail: msg?.error?.message || msg?.message || 'Unknown error',
          });
        }
      } catch {
        events.push('message:non-json');
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(failTimer);
      finish({
        outcome: 'unexpected-response',
        detail: `HTTP ${res.statusCode || 0}`,
      });
    });

    ws.on('error', (error) => {
      clearTimeout(failTimer);
      finish({
        outcome: 'error',
        detail: error.message,
      });
    });

    ws.on('close', (code, reason) => {
      clearTimeout(failTimer);
      finish({
        outcome: 'close',
        closeCode: code,
        closeReason: reason.toString(),
      });
    });
  });
}

export async function GET() {
  const { apiKey, keySource } = resolveDashscopeApiKey();
  const model = sanitizeEnv(process.env.QWEN_MODEL || 'qwen3-asr-flash-realtime').toLowerCase();

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: '未配置 DASHSCOPE_API_KEY 或 QWEN_API_KEY',
      },
      { status: 500 }
    );
  }

  const targets = buildTargets(model);
  const results: ProbeResult[] = [];
  for (const url of targets) {
    results.push(await probe(url, apiKey));
  }

  const summary = results.some((item) => item.outcome === 'session.updated')
    ? 'ok'
    : results.every((item) => item.outcome === 'timeout')
      ? 'network-or-egress-timeout'
      : 'upstream-rejected-or-closed';

  return NextResponse.json({
    success: true,
    summary,
    model,
    keySource,
    keyLength: apiKey.length,
    results,
  });
}
