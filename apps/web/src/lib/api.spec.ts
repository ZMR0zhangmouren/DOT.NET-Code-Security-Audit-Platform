import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, getCurrentUser, getToken, logout, setCurrentUser, setToken, api } from './api';

const TOKEN_KEY = 'access_token';
const USER_KEY = 'user';

describe('lib/api.ts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('token helpers', () => {
    it('setToken → getToken 读出来', () => {
      setToken('jwt.x');
      expect(getToken()).toBe('jwt.x');
      expect(localStorage.getItem(TOKEN_KEY)).toBe('jwt.x');
    });

    it('setToken(null) → 删除 token', () => {
      setToken('jwt.x');
      setToken(null);
      expect(getToken()).toBeNull();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('logout 同时清 token + user', () => {
      setToken('jwt.x');
      setCurrentUser({
        id: 'u1',
        username: 'alice',
        email: 'a@x.com',
        displayName: 'Alice',
        role: 'admin',
      });
      logout();
      expect(getToken()).toBeNull();
      expect(getCurrentUser()).toBeNull();
    });
  });

  describe('user helpers', () => {
    it('setCurrentUser → JSON.parse 出来', () => {
      setCurrentUser({
        id: 'u1',
        username: 'alice',
        email: 'a@x.com',
        displayName: null,
        role: 'auditor',
      });
      const u = getCurrentUser();
      expect(u?.id).toBe('u1');
      expect(u?.role).toBe('auditor');
      expect(u?.displayName).toBeNull();
    });

    it('setCurrentUser(null) → 删除 user', () => {
      setCurrentUser({
        id: 'u1',
        username: 'a',
        email: 'a',
        displayName: null,
        role: 'viewer',
      });
      setCurrentUser(null);
      expect(getCurrentUser()).toBeNull();
      expect(localStorage.getItem(USER_KEY)).toBeNull();
    });

    it('getCurrentUser 空 → null', () => {
      expect(getCurrentUser()).toBeNull();
    });
  });

  describe('api.get / post / patch / delete', () => {
    it('GET → 加 Authorization Bearer 头 + 解析 JSON', async () => {
      setToken('jwt.token');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ id: 'u1' }), { status: 200 }));
      const out = await api.get<{ id: string }>('/auth/me');
      expect(out.id).toBe('u1');
      const init = fetchSpy.mock.calls[0]![1]!;
      const headers = init.headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer jwt.token');
      expect(headers.get('content-type')).toBeNull(); // GET 没 body
    });

    it('POST JSON body → 自动 set content-type', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await api.post('/foo', { x: 1 });
      const init = fetchSpy.mock.calls[0]![1]!;
      const headers = init.headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
      expect(init.body).toBe(JSON.stringify({ x: 1 }));
    });

    it('POST FormData body → 不覆盖浏览器 multipart header(2026-06-29 fix)', async () => {
      // request() 对 FormData 不设 content-type,让浏览器自动设 multipart/form-data + boundary
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      const fd = new FormData();
      fd.append('file', new Blob(['x']), 'x.zip');
      await api.post('/upload', fd);
      const init = fetchSpy.mock.calls[0]![1]!;
      expect(init.body).toBe(fd);
      const headers = init.headers as Headers;
      expect(headers.get('content-type')).toBeNull();
    });

    it('PATCH → JSON body', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await api.patch('/foo', { status: 'fixed' });
      const init = fetchSpy.mock.calls[0]![1]!;
      const headers = init.headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
      expect(init.method).toBe('PATCH');
    });

    it('DELETE → method=DELETE, 无 body', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 204 }));
      const out = await api.delete('/foo');
      expect(out).toBeUndefined();
      const init = fetchSpy.mock.calls[0]![1]!;
      expect(init.method).toBe('DELETE');
    });

    it('401 → 自动 logout + 抛 ApiError(401)', async () => {
      setToken('jwt.bad');
      setCurrentUser({
        id: 'u',
        username: 'u',
        email: 'u',
        displayName: null,
        role: 'admin',
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('unauthorized', { status: 401 }),
      );
      await expect(api.get('/foo')).rejects.toBeInstanceOf(ApiError);
      expect(getToken()).toBeNull();
      expect(getCurrentUser()).toBeNull();
    });

    it('非 401 非 200 → ApiError(status, message)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'bad request' }), { status: 400 }),
      );
      await expect(api.get('/foo')).rejects.toMatchObject({
        status: 400,
        message: 'bad request',
      });
    });

    it('非 200 但 response 无 JSON → ApiError("HTTP 500")', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('plain text', { status: 500 }));
      await expect(api.get('/foo')).rejects.toMatchObject({
        status: 500,
        message: 'HTTP 500',
      });
    });

    it('POST 不带 body → 不设置 content-type', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      await api.post('/foo');
      const init = fetchSpy.mock.calls[0]![1]!;
      expect(init.body).toBeUndefined();
      const headers = init.headers as Headers;
      expect(headers.get('content-type')).toBeNull();
    });
  });
});
