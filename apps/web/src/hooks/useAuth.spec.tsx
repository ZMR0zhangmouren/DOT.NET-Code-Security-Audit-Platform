import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 必须在所有 import 之前(Vitest 会 hoist 到顶部)
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// Mock global fetch for refresh() which uses raw fetch (POST /api/auth/refresh)
const fetchSpy = vi.spyOn(globalThis, 'fetch');

import { useAuth } from './useAuth';

import { api, setCurrentUser, setToken } from '@/lib/api';

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
}

describe('useAuth hook', () => {
  beforeEach(() => {
    setToken(null);
    setCurrentUser(null);
    vi.clearAllMocks();
    // 默认:refresh() 中的 fetch('/api/auth/refresh') 返回 401(无 cookie 则失败)
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
  });

  afterEach(() => {
    setToken(null);
    setCurrentUser(null);
  });

  it('初始 user 来自 setCurrentUser(内存)', async () => {
    setCurrentUser({
      id: 'u1',
      username: 'alice',
      email: 'a@x.com',
      displayName: 'Alice',
      role: 'admin',
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user?.username).toBe('alice');
    expect(result.current.user?.role).toBe('admin');
  });

  it('无存储 → user=null(且 refresh 失败不 crash)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    // 初始 user=null,useEffect 调 refresh() → fetch 返回 401 → user 保持 null
    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
  });

  it('login:post 返回 accessToken + user → setToken + setCurrentUser + 跳到 /', async () => {
    vi.mocked(api.post).mockResolvedValue({
      accessToken: 'jwt.new',
      user: {
        id: 'u2',
        username: 'bob',
        email: 'b@x.com',
        displayName: 'Bob',
        role: 'auditor',
      },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.login('bob', 'pw');
    });
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      usernameOrEmail: 'bob',
      password: 'pw',
    });
    expect(result.current.user?.username).toBe('bob');
  });

  it('logout → POST /auth/logout + 清 token + user + 跳到 /login', async () => {
    setToken('jwt.x');
    setCurrentUser({
      id: 'u1',
      username: 'a',
      email: 'a',
      displayName: null,
      role: 'admin',
    });
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.logout();
    });
    expect(api.post).toHaveBeenCalledWith('/auth/logout');
    expect(result.current.user).toBeNull();
  });

  it('refresh:POST /api/auth/refresh 成功 → 更新 user', async () => {
    setCurrentUser({
      id: 'u1',
      username: 'alice',
      email: 'a@x.com',
      displayName: null,
      role: 'admin',
    });
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: 'jwt.fresh',
          user: {
            id: 'u1',
            username: 'alice-refreshed',
            email: 'a@x.com',
            displayName: 'Alice',
            role: 'admin',
          },
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => {
      expect(result.current.user?.username).toBe('alice-refreshed');
    });
  });

  it('refresh:POST /api/auth/refresh 失败 → 清 user', async () => {
    setCurrentUser({
      id: 'u1',
      username: 'a',
      email: 'a',
      displayName: null,
      role: 'admin',
    });
    fetchSpy.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
  });
});
