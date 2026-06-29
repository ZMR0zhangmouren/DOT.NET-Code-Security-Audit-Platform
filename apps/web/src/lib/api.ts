/**
 * 轻量 API client —— 自动从 localStorage 读 JWT,加到 Authorization header
 * 401 时自动清登录态
 */
const TOKEN_KEY = 'access_token';
const USER_KEY = 'user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'auditor' | 'developer' | 'viewer';
}

export function getCurrentUser(): CurrentUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as CurrentUser) : null;
}

export function setCurrentUser(u: CurrentUser | null): void {
  if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
  else localStorage.removeItem(USER_KEY);
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

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const token = getToken();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  const r = await fetch(`/api${path}`, { ...init, headers });
  if (r.status === 401) {
    logout();
    throw new ApiError(401, 'unauthorized');
  }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    // Try JSON first (most API errors are JSON), fallback to text
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
  // Try JSON first, fallback to text (for markdown/text downloads)
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
      // 让浏览器自动设置 multipart/form-data + boundary
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
