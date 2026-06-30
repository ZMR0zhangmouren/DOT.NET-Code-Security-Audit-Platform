/**
 * 轻量 API client —— access token 放内存(非 localStorage),refresh token 由 HttpOnly cookie 自动传输
 *
 * 流程:
 * - login → 服务端返回 { accessToken, user } + Set-Cookie: refresh_token (HttpOnly)
 * - 后续请求自动带 Authorization: Bearer <accessToken>
 * - 401 → 静默调 /api/auth/refresh → 换新 accessToken → 重试原请求 1 次
 * - logout → POST /api/auth/logout → 服务端吊销 refresh token + 清 cookie
 */
let memoryToken: string | null = null;

let refreshPromise: Promise<boolean> | null = null;

export function getToken(): string | null {
  return memoryToken;
}

export function setToken(t: string | null): void {
  memoryToken = t;
}

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'auditor' | 'developer' | 'viewer';
}

let currentUser: CurrentUser | null = null;

export function getCurrentUser(): CurrentUser | null {
  return currentUser;
}

export function setCurrentUser(u: CurrentUser | null): void {
  currentUser = u;
}

export function logout(): void {
  setToken(null);
  setCurrentUser(null);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 静默刷新 access token
 * 并发安全:多个 401 并发时只发一次 refresh 请求
 */
async function silentRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include', // 让浏览器发送 HttpOnly cookie
      });
      if (!r.ok) return false;
      const data = (await r.json()) as { accessToken: string; user: CurrentUser };
      setToken(data.accessToken);
      setCurrentUser(data.user);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  // FormData 让浏览器自动设 multipart/form-data + boundary,不要覆盖
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const token = getToken();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  const r = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
  if (r.status === 401) {
    // 静默刷新后重试一次
    const ok = await silentRefresh();
    if (ok) {
      const headers2 = new Headers(init.headers ?? {});
      if (init.body && !(init.body instanceof FormData) && !headers2.has('content-type')) {
        headers2.set('content-type', 'application/json');
      }
      const token2 = getToken();
      if (token2) headers2.set('authorization', `Bearer ${token2}`);
      const r2 = await fetch(`/api${path}`, { ...init, headers: headers2, credentials: 'include' });
      if (r2.status === 401) {
        logout();
        throw new ApiError(401, 'session expired');
      }
      if (!r2.ok) {
        let msg = `HTTP ${r2.status}`;
        try {
          const j = (await r2.json()) as { message?: string };
          if (j.message) msg = j.message;
        } catch {
          /* ignore */
        }
        throw new ApiError(r2.status, msg);
      }
      if (r2.status === 204) return undefined as T;
      try {
        return (await r2.json()) as T;
      } catch {
        return (await r2.text()) as unknown as T;
      }
    }
    logout();
    throw new ApiError(401, 'session expired');
  }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = (await r.json()) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      try {
        const t = await r.text();
        if (t) msg += ` — ${t.slice(0, 200)}`;
      } catch {
        /* ignore */
      }
    }
    throw new ApiError(r.status, msg);
  }
  if (r.status === 204) return undefined as T;
  try {
    return (await r.json()) as T;
  } catch {
    return (await r.text()) as unknown as T;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => {
    const init: RequestInit = { method: 'POST' };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    return request<T>(path, init);
  },
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
