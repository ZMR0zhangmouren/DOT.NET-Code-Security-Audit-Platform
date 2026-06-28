import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §11 Q6 + §11 Q13 —— Bull-Board 鉴权中间件单元测试
 *
 * 关注点:
 *   - 401 when no Authorization header
 *   - 401 when Authorization is malformed
 *   - 200 when JWT valid + role=admin
 *   - 403 when JWT valid + role≠admin
 *   - 200 when Basic auth user/pass 匹配 BULL_BOARD_BASIC_USER/PASS 默认 admin/admin
 *   - 401 when Basic auth 错
 *   - WWW-Authenticate 头在 401 时设置
 *   - JWT 失败 fallback 到 Basic(401 → 200)
 */

import { createQueueBoardAuthMiddleware } from './queue-board-auth.middleware.js';

interface MockRes {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    body: undefined,
    headers: {},
    status: vi.fn(function (this: MockRes, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: MockRes, body: unknown) {
      this.body = body;
      return this;
    }),
    setHeader: vi.fn(function (this: MockRes, k: string, v: string) {
      this.headers[k] = v;
      return this;
    }),
  };
  return res;
}

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers, method: 'GET', url: '/admin/queue' } as unknown as Request;
}

describe('§11 Q6 + Q13 QueueBoardAuthMiddleware', () => {
  const fakeAuth = {
    verifyToken: vi.fn(async (token: string) => {
      if (token === 'good-admin') return { sub: 'u1', username: 'admin', role: 'admin' };
      if (token === 'good-auditor') return { sub: 'u2', username: 'bob', role: 'auditor' };
      return null; // 过期 / 签名错
    }),
  };
  const auth = fakeAuth as any;
  const middleware = createQueueBoardAuthMiddleware(auth);

  beforeEach(() => {
    fakeAuth.verifyToken.mockClear();
    delete process.env['BULL_BOARD_BASIC_USER'];
    delete process.env['BULL_BOARD_BASIC_PASS'];
  });

  it('no Authorization → 401 + WWW-Authenticate 头', async () => {
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toMatch(/Basic/);
    expect(res.body).toEqual({ error: 'authentication required' });
  });

  it('JWT admin → next() 调一次,200 路径', async () => {
    const req = makeReq({ authorization: 'Bearer good-admin' });
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0); // 没调 res.status
    expect(fakeAuth.verifyToken).toHaveBeenCalledWith('good-admin');
  });

  it('JWT non-admin role → 403 admin role required', async () => {
    const req = makeReq({ authorization: 'Bearer good-auditor' });
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'admin role required' });
  });

  it('JWT 过期(verifyToken 返回 null)→ fallback 到 Basic(也都失败)→ 401', async () => {
    const req = makeReq({ authorization: 'Bearer expired-token' });
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(fakeAuth.verifyToken).toHaveBeenCalledWith('expired-token');
  });

  it('JWT 失败 + Basic admin:admin → next()(fallback 成功)', async () => {
    const basic = Buffer.from('admin:admin', 'utf8').toString('base64');
    const req = makeReq({ authorization: `Basic ${basic}` });
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('Basic 错密码 → 401', async () => {
    const basic = Buffer.from('admin:wrong', 'utf8').toString('base64');
    const req = makeReq({ authorization: `Basic ${basic}` });
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('Basic 错用户 → 401', async () => {
    const basic = Buffer.from('hacker:admin', 'utf8').toString('base64');
    const req = makeReq({ authorization: `Basic ${basic}` });
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('BULL_BOARD_BASIC_USER / BULL_BOARD_BASIC_PASS 覆盖默认 admin/admin', async () => {
    process.env['BULL_BOARD_BASIC_USER'] = 'ops';
    process.env['BULL_BOARD_BASIC_PASS'] = 's3cret';
    const mw = createQueueBoardAuthMiddleware(auth);

    // 用旧 admin:admin 应该失败
    const reqBad = makeReq({
      authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
    });
    const resBad = makeRes();
    await mw(reqBad, resBad as unknown as Response, vi.fn() as NextFunction);
    expect(resBad.statusCode).toBe(401);

    // 用新 ops:s3cret 成功
    const reqGood = makeReq({
      authorization: `Basic ${Buffer.from('ops:s3cret').toString('base64')}`,
    });
    const resGood = makeRes();
    const nextGood = vi.fn();
    await mw(reqGood, resGood as unknown as Response, nextGood as NextFunction);
    expect(nextGood).toHaveBeenCalledTimes(1);
    expect(resGood.statusCode).toBe(0);
  });

  it('OPTIONS 请求 → 不做鉴权直接 next()', async () => {
    const req = { headers: {}, method: 'OPTIONS', url: '/admin/queue' } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('Basic 缺冒号分隔 → 401', async () => {
    const bad = Buffer.from('nocolonhere', 'utf8').toString('base64');
    const req = makeReq({ authorization: `Basic ${bad}` });
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
