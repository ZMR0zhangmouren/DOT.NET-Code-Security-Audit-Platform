import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  api,
  getCurrentUser,
  setCurrentUser,
  setToken,
  logout as clearAuth,
  type CurrentUser,
} from '@/lib/api';

/**
 * Auth hook —— 客户端唯一真相
 * - access token 在内存(api.ts module-level variable),非 localStorage
 * - refresh token 在 HttpOnly cookie(浏览器自动发送,JS 不可读)
 * - 启动时 POST /api/auth/refresh 恢复登录态;失败则退登
 * - login / logout 同步内存状态 + 导航
 */
export function useAuth(): {
  user: CurrentUser | null;
  loading: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [user, setUser] = useState<CurrentUser | null>(() => getCurrentUser());
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (r.ok) {
        const data = (await r.json()) as { accessToken: string; user: CurrentUser };
        setToken(data.accessToken);
        setCurrentUser(data.user);
        setUser(data.user);
      } else {
        clearAuth();
        setUser(null);
      }
    } catch {
      clearAuth();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 启动时尝试用 refresh token 恢复登录态
  useEffect(() => {
    if (!user) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (usernameOrEmail: string, password: string) => {
      const res = await api.post<{ accessToken: string; user: CurrentUser }>('/auth/login', {
        usernameOrEmail,
        password,
      });
      setToken(res.accessToken);
      setCurrentUser(res.user);
      setUser(res.user);
      // 同时存 localStorage 供 AuthGuard 初始检查
      try {
        localStorage.setItem('user', JSON.stringify(res.user));
      } catch {
        /* ignore */
      }
      navigate('/');
    },
    [navigate],
  );

  const signOut = useCallback(async () => {
    try {
      // 服务端吊销 refresh token + 清 cookie
      await api.post('/auth/logout');
    } catch {
      /* 即使请求失败也清本地状态 */
    }
    clearAuth();
    setUser(null);
    try {
      localStorage.removeItem('user');
    } catch {
      /* ignore */
    }
    navigate('/login');
  }, [navigate]);

  return { user, loading, login, logout: signOut, refresh };
}
