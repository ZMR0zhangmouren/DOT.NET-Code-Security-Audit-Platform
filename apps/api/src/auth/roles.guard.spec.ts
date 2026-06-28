import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, it, expect } from 'vitest';

import type { AuthenticatedUser } from './jwt.strategy.js';
import { ROLES_KEY } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

// helper:造一个 fake ExecutionContext,给定 req 上的 user + 路由方法元数据
function makeCtx(opts: {
  handlerRoles?: AuthenticatedUser['role'][];
  classRoles?: AuthenticatedUser['role'][];
  user?: { sub?: string; role?: AuthenticatedUser['role'] } | null;
}): ExecutionContext {
  const req = { user: opts.user ?? null };
  const handler = function namedFn(): void {
    /* noop */
  };
  // 标记 handler 上的反射元数据(用 Reflect.defineMetadata 模拟 @Roles)
  if (opts.handlerRoles !== undefined) {
    Reflect.defineMetadata(ROLES_KEY, opts.handlerRoles, handler);
  }
  if (opts.classRoles !== undefined) {
    class FakeClass {
      // 任意 method
    }
    Reflect.defineMetadata(ROLES_KEY, opts.classRoles, FakeClass);
  }
  return {
    getHandler: () => handler,
    getClass: () =>
      opts.classRoles !== undefined
        ? ((): unknown => {
            class FakeClass {
              // 任意 method
            }
            return FakeClass;
          })()
        : ((): unknown => class EmptyClass {})(),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('没有 @Roles(...) → 放行(任何登录用户都行)', () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = makeCtx({ user: { sub: 'u1', role: 'auditor' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("@Roles('admin') + req.user.role === 'admin' → 放行", () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = makeCtx({
      handlerRoles: ['admin'],
      user: { sub: 'u1', role: 'admin' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("@Roles('admin') + req.user.role === 'auditor' → ForbiddenException", () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = makeCtx({
      handlerRoles: ['admin'],
      user: { sub: 'u1', role: 'auditor' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("@Roles('admin','auditor') + role=developer → 403", () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = makeCtx({
      handlerRoles: ['admin', 'auditor'],
      user: { sub: 'u1', role: 'developer' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(/role "developer" is not allowed/);
  });

  it("@Roles('admin','auditor') + role=auditor → 放行", () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = makeCtx({
      handlerRoles: ['admin', 'auditor'],
      user: { sub: 'u1', role: 'auditor' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("@Roles('admin') + 没有 req.user → ForbiddenException", () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = makeCtx({ handlerRoles: ['admin'], user: null });
    expect(() => guard.canActivate(ctx)).toThrow(/missing user role/);
  });

  it("@Roles('admin') + req.user 没 role → 403(理论上 JwtAuthGuard 已先 401 兜底)", () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = makeCtx({ handlerRoles: ['admin'], user: { sub: 'u1' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
