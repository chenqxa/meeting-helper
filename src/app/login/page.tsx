'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';
  const ssoError = searchParams.get('error');
  const [loginid, setLoginid] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(ssoError ? 'OA 单点登录失败，请手动输入账号' : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(r => { if (r.success) window.location.replace(redirect); })
      .catch(() => {});
  }, [redirect]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginid.trim()) { setError('请输入OA登录账号'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginid: loginid.trim() }),
      });
      const r = await res.json();
      if (r.success) {
        window.location.replace(redirect);
      } else {
        setError(r.error || '登录失败，请重试');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white text-2xl mb-4 shadow-lg">
            📋
          </div>
          <h1 className="text-2xl font-bold text-gray-900">会议纪要系统</h1>
          <p className="text-gray-500 text-sm mt-1">请登录以继续</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                OA 登录账号
              </label>
              <input
                ref={inputRef}
                type="text"
                value={loginid}
                onChange={e => setLoginid(e.target.value)}
                placeholder="请输入您的 OA 账号"
                autoComplete="username"
                autoFocus
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent transition"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !loginid.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl py-3 text-sm transition-colors disabled:opacity-50"
            >
              {loading ? '验证中...' : '登 录'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          遇到问题请联系 IT 支持
        </p>
      </div>
    </div>
  );
}
