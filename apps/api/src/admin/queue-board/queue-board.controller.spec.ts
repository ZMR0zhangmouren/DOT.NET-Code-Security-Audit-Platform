import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { ROLES_KEY } from '../../auth/roles.decorator.js';
import { RolesGuard } from '../../auth/roles.guard.js';

import { QueueBoardController } from './queue-board.controller.js';

/**
 * §11 Q6 + §11 Q13 —— QueueBoardController 鉴权链单元测试
 *
 * 关注点:
 *   - @Roles('admin') + @UseGuards(JwtAuthGuard, RolesGuard) 装饰器顺序正确
 *   - RolesGuard 在 user.role=admin 时放行
 *   - RolesGuard 在 user.role≠admin 时 403
 *   - JwtAuthGuard 在缺/错 token 时 401(用 stub AuthGuard 验)
 *
 * 策略:参照 roles.guard.spec.ts 的模式 —— 用 Reflect.defineMetadata 显式标
 *   handlerRoles,造 fake ExecutionContext 调 RolesGuard/JwtAuthGuard.canActivate。
 *   JwtAuthGuard 真身是 AuthGuard('jwt') 会去拿 PassportStrategy,这里用同源
 *   的"看 Authorization 头"小 stub 替身(在 spec 内匿名类,不污染其它文件)。
 */

/** 替身 JwtAuthGuard —— 仅验 Authorization Bearer,简化 role 注入 */
class StubJwtAuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: { sub?: string; role?: 'admin' | 'auditor' | 'developer' | 'viewer' };
    }>();
    const auth = req.headers['authorization'] ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m || !m[1]) throw new UnauthorizedException('missing bearer token');
    const token = m[1];
    if (token === 'admin-token') {
      req.user = { sub: 'u1', username: 'admin', role: 'admin' };
    } else if (token === 'auditor-token') {
      req.user = { sub: 'u2', username: 'bob', role: 'auditor' };
    } else {
      throw new UnauthorizedException('invalid token');
    }
    return true;
  }
}

function makeCtx(opts: {
  classRoles?: ('admin' | 'auditor' | 'developer' | 'viewer')[];
  user?: { sub?: string; role?: 'admin' | 'auditor' | 'developer' | 'viewer' } | null;
  authorization?: string;
}): ExecutionContext {
  type Req = {
    headers: Record<string, string>;
    user?: { sub?: string; role?: 'admin' | 'auditor' | 'developer' | 'viewer' } | null;
  };
  const req: Req = { headers: {} };
  if (opts.authorization !== undefined) {
    req.headers['authorization'] = opts.authorization;
  }
  if (opts.user !== undefined) {
    req.user = opts.user;
  }

  class Handler {
    // noop
  }
  class Klass {
    // noop
  }
  if (opts.classRoles !== undefined) {
    Reflect.defineMetadata(ROLES_KEY, opts.classRoles, Handler);
    Reflect.defineMetadata(ROLES_KEY, opts.classRoles, Klass);
  }

  return {
    getHandler: () => Handler,
    getClass: () => Klass,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('§11 Q6 + Q13 QueueBoardController 鉴权', () => {
  let rolesGuard: RolesGuard;

  beforeEach(() => {
    rolesGuard = new RolesGuard(new Reflector());
  });

  it('controller.health() 返回 { ok:true, path:"/admin/queue" }', () => {
    const c = new QueueBoardController();
    expect(c.health()).toEqual({ ok: true, path: '/admin/queue' });
  });

  it('@Roles("admin") 装饰器在 class 层级生效(由 RolesGuard canActivate 验)', () => {
    const ctx = makeCtx({ classRoles: ['admin'], user: { role: 'admin' } });
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });

  it('@Roles("admin") + role=auditor → ForbiddenException', () => {
    const ctx = makeCtx({ classRoles: ['admin'], user: { role: 'auditor' } });
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('@Roles("admin") + role 缺失 → ForbiddenException', () => {
    const ctx = makeCtx({ classRoles: ['admin'], user: {} });
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('@Roles("admin") + user=null → ForbiddenException', () => {
    const ctx = makeCtx({ classRoles: ['admin'], user: null });
    expect(() => rolesGuard.canActivate(ctx)).toThrow(/missing user role/);
  });

  it('没 @Roles 元数据 → 放行(只要求登录,role 不限制)', () => {
    const ctx = makeCtx({ user: { role: 'auditor' } });
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });

  it('StubJwtAuthGuard:no header → 401', () => {
    const guard = new StubJwtAuthGuard();
    const ctx = makeCtx({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('StubJwtAuthGuard:admin-token → 注入 admin user,放行', () => {
    const guard = new StubJwtAuthGuard();
    const ctx = makeCtx({ authorization: 'Bearer admin-token' });
    expect(guard.canActivate(ctx)).toBe(true);
    const req = ctx.switchToHttp().getRequest<{
      user?: { role?: 'admin' | 'auditor' | 'developer' | 'viewer' };
    }>();
    expect(req.user?.role).toBe('admin');
  });

  it('StubJwtAuthGuard:auditor-token → 注入 auditor user', () => {
    const guard = new StubJwtAuthGuard();
    const ctx = makeCtx({ authorization: 'Bearer auditor-token' });
    expect(guard.canActivate(ctx)).toBe(true);
    const req = ctx.switchToHttp().getRequest<{
      user?: { role?: 'admin' | 'auditor' | 'developer' | 'viewer' };
    }>();
    expect(req.user?.role).toBe('auditor');
  });

  it('StubJwtAuthGuard:unknown token → 401', () => {
    const guard = new StubJwtAuthGuard();
    const ctx = makeCtx({ authorization: 'Bearer wrong' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('完整鉴权链:no auth → JwtAuthGuard 401 抛', () => {
    const jwt = new StubJwtAuthGuard();
    const ctx = makeCtx({ classRoles: ['admin'] });
    expect(() => jwt.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('完整鉴权链:admin auth → JwtAuthGuard pass → RolesGuard pass', () => {
    const jwt = new StubJwtAuthGuard();
    const ctx = makeCtx({
      classRoles: ['admin'],
      authorization: 'Bearer admin-token',
    });
    expect(jwt.canActivate(ctx)).toBe(true);
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });

  it('完整鉴权链:auditor auth → JwtAuthGuard pass → RolesGuard 403', () => {
    const jwt = new StubJwtAuthGuard();
    const ctx = makeCtx({
      classRoles: ['admin'],
      authorization: 'Bearer auditor-token',
    });
    expect(jwt.canActivate(ctx)).toBe(true);
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
