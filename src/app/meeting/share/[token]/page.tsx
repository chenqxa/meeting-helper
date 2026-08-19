'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function MeetingSharePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const traceId = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('_t')
        || `page-${Date.now().toString(36)}`
      : 'page-ssr';
    const log = (step: string, extra: Record<string, unknown> = {}) => {
      console.log('[share-trace]', JSON.stringify({ traceId, step, tokenPrefix: token?.slice(0, 8), ...extra }));
    };
    log('share.page.mount', { url: typeof window !== 'undefined' ? window.location.href : '' });
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    async function validateAndRedirect() {
      try {
        const res = await fetch(`/api/meetings/share/${token}?_t=${encodeURIComponent(traceId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await res.json();
        log('share.page.api.response', { status: res.status, success: data.success, redirectUrl: data.data?.redirectUrl, error: data.error });

        if (disposed) return;
        if (res.ok && data.success && data.data?.redirectUrl) {
          log('share.page.redirect');
          router.replace(data.data.redirectUrl);
          return;
        }

        setError(data.error || `访问失败（${res.status}）`);
        setLoading(false);
      } catch (err) {
        if (disposed) return;
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        log('share.page.api.error', { isAbort, message: err instanceof Error ? err.message : String(err) });
        setError(isAbort
          ? '访问超时，请检查企业微信网络后重试'
          : '访问失败，请稍后重试');
        setLoading(false);
      }
    }

    if (token) {
      validateAndRedirect();
    } else {
      setError('分享链接无效');
      setLoading(false);
    }

    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [token, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">正在验证分享链接...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
        <div className="text-red-500 text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">访问失败</h1>
        <p className="text-gray-600 mb-6">{error}</p>
        <button
          onClick={() => router.push('/login')}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          返回登录
        </button>
      </div>
    </div>
  );
}
