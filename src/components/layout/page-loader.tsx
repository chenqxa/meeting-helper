'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';

export default function PageLoader() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setLoading(false), 1500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pathname]);

  if (!loading) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] pointer-events-none">
      <div className="h-0.5 bg-blue-500 animate-pulse-line" style={{
        background: 'linear-gradient(90deg, transparent 0%, #3b82f6 30%, #60a5fa 50%, #3b82f6 70%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'loader-slide 1s ease-in-out infinite',
      }} />
      <style>{`
        @keyframes loader-slide {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
