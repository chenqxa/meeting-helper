'use client';

import { useState, useEffect } from 'react';

export interface CurrentUser {
  name: string;
  loginid: string;
  dept?: string;
  role?: string;
}

export function useCurrentUser(): { user: CurrentUser | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    try {
      const cached = sessionStorage.getItem('auth_me');
      if (cached) {
        const parsed = JSON.parse(cached) as CurrentUser;
        if (!cancelled) {
          setUser(parsed);
          setLoading(false);
        }
        return;
      }
    } catch { /* ignore */ }

    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.success && d.data) {
          setUser(d.data);
          try { sessionStorage.setItem('auth_me', JSON.stringify(d.data)); } catch { /* ignore */ }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return { user, loading };
}
