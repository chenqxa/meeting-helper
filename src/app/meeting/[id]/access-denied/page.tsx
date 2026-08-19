'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MeetingAccessDenied() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.push('/meetings');
    }, 3000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
        <div className="text-yellow-500 text-5xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">无权访问</h1>
        <p className="text-gray-600 mb-6">
          您不是此会议的参会人员或主持人，无法查看会议内容。
        </p>
        <p className="text-sm text-gray-500">
          3秒后自动跳转到会议列表...
        </p>
        <button
          onClick={() => router.push('/meetings')}
          className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          立即返回
        </button>
      </div>
    </div>
  );
}
