import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { describe, it, expect } from 'vitest';

import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * §6.2 JwtAuthGuard 错误路径覆盖:
 * - @nestjs/passport 内部 AuthGuard 的 handleRequest(err, user, info, ctx):
 *     - err 存在 → throw err
 *     - user 不存在(err undefined)→ throw new UnauthorizedException()
 *     - 都有 → return user
 * 这里直接调 handleRequest 覆盖 3 个分支。
 */

function makeCtx(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard (§6.2 error paths)', () => {
  const guard = new JwtAuthGuard();
  const ctx = makeCtx();

  it('err=undefined + user=undefined → 401 UnauthorizedException(默认消息 "Unauthorized")', () => {
    let thrown: unknown;
    try {
      guard.handleRequest(undefined, undefined, undefined, ctx);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as Error).message).toBe('Unauthorized');
  });

  it('err=Error(非 UnauthorizedException)→ 把 err 原样抛出', () => {
    const customErr = new Error('jwt malformed');
    let thrown: unknown;
    try {
      guard.handleRequest(customErr, undefined, undefined, ctx);
    } catch (e) {
      thrown = e;
    }
    // @nestjs/passport 不会包 UnauthorizedException,直接把 err 抛出
    expect(thrown).toBe(customErr);
  });

  it('user=object + 无 err → 透传 user(成功路径)', () => {
    const u = { sub: 'usr-1', role: 'admin' as const };
    const out = guard.handleRequest(undefined, u, undefined, ctx);
    expect(out).toBe(u);
  });

  it('err=undefined + user=undefined + info=Error → 仍 401(info 不影响 throw 决策)', () => {
    const info = new Error('No auth token');
    let thrown: unknown;
    try {
      guard.handleRequest(undefined, undefined, info, ctx);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    // 因为 err 不存在,@nestjs/passport 用默认 UnauthorizedException,
    // info.message 不会被透传(只有 err 会被原样 throw)
    expect((thrown as Error).message).toBe('Unauthorized');
  });

  it('JwtAuthGuard 实例化存在(类型/继承检查)', () => {
    expect(guard).toBeInstanceOf(JwtAuthGuard);
    expect(typeof guard.canActivate).toBe('function');
    expect(typeof guard.handleRequest).toBe('function');
  });
});
