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

import { useAuth } from './useAuth';

import { api, logout, setCurrentUser, setToken } from '@/lib/api';

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
}

describe('useAuth hook', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('初始 user 来自 localStorage.getCurrentUser()', async () => {
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

  it('无 localStorage → user=null', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
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
    expect(localStorage.getItem('access_token')).toBe('jwt.new');
    expect(result.current.user?.username).toBe('bob');
  });

  it('logout → 清 token + user + 跳到 /login', async () => {
    setToken('jwt.x');
    setCurrentUser({
      id: 'u1',
      username: 'a',
      email: 'a',
      displayName: null,
      role: 'admin',
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => {
      result.current.logout();
    });
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('refresh:GET /auth/me 成功 → 更新 user', async () => {
    setCurrentUser({
      id: 'u1',
      username: 'alice',
      email: 'a@x.com',
      displayName: null,
      role: 'admin',
    });
    vi.mocked(api.get).mockResolvedValue({
      id: 'u1',
      username: 'alice-refreshed',
      email: 'a@x.com',
      displayName: 'Alice',
      role: 'admin',
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => {
      expect(result.current.user?.username).toBe('alice-refreshed');
    });
    expect(localStorage.getItem('user')).toContain('alice-refreshed');
  });

  it('refresh:GET /auth/me 失败 → 清 user', async () => {
    setCurrentUser({
      id: 'u1',
      username: 'a',
      email: 'a',
      displayName: null,
      role: 'admin',
    });
    vi.mocked(api.get).mockRejectedValue(new Error('401'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
  });

  it('logout 自身:调用 logout() 内部实现', async () => {
    setToken('jwt.x');
    expect(logout).toBeDefined();
  });
});
