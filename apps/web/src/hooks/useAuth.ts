import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, getCurrentUser, setCurrentUser, setToken, logout, type CurrentUser } from '@/lib/api';

/**
 * Auth hook —— 客户端唯一真相
 * - currentUser 来自 localStorage + 启动时 GET /api/auth/me 校验
 * - login / logout 同步 localStorage + 导航
 */
export function useAuth(): {
  user: CurrentUser | null;
  loading: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
} {
  const [user, setUser] = useState<CurrentUser | null>(() => getCurrentUser());
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api.get<CurrentUser>('/auth/me');
      setCurrentUser(me);
      setUser(me);
    } catch {
      setCurrentUser(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && !loading) {
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
      navigate('/');
    },
    [navigate],
  );

  const signOut = useCallback(() => {
    logout();
    setUser(null);
    navigate('/login');
  }, [navigate]);

  return { user, loading, login, logout: signOut, refresh };
}
