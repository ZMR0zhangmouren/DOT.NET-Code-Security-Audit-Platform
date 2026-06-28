import type { ExecutionContext } from '@nestjs/common';
import { describe, it, expect } from 'vitest';

import { CurrentUser } from './current-user.decorator.js';

/**
 * §6.2 CurrentUser 装饰器分支覆盖:
 * - req.user 不存在 → 返回 undefined(由 controller 处理 401/404)
 * - req.user 存在 + 无 data → 返回整个 user 对象
 * - req.user 存在 + data='sub' → 返回 user.sub
 * - req.user 存在 + data='role' → 返回 user.role
 *
 * 实现:createParamDecorator(factory) 返回 `(data, ctx) => decorator`。
 * 装饰器本体是 inner factory 调用,但测试需要直接拿 inner factory 的逻辑:
 * 通过 `CurrentUser` 注册到一个 dummy method,然后用 Reflect.getMetadata
 * 拿出工厂函数,再用假 ctx 调用即可。
 *
 * 简化路线:直接重新 export 一个等价 inner factory(测试用):
 * 既然 source 里装饰器回调就是 `(data, ctx) => { req = ctx.switchToHttp().getRequest(); ... }`,
 * 我们用 dummy target + Reflect.defineMetadata 触发注册,然后取出来。
 */

function makeCtx(req: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

/** 调用 CurrentUser 拿 inner factory 并直接执行 */
function invoke(data: string | undefined, req: unknown): unknown {
  class DummyClass {
    public method(): unknown {
      return undefined;
    }
  }
  const decorator = CurrentUser(data);
  decorator(DummyClass.prototype, 'method', 0);
  // createParamDecorator 把 metadata 存在 target.constructor(DummyClass)上,key = 'method'
  const meta = Reflect.getMetadata('__routeArguments__', DummyClass, 'method');
  if (!meta) throw new Error('no __routeArguments__ metadata registered');
  const paramtype = Object.keys(meta)[0];
  if (!paramtype) throw new Error('no paramtype registered');
  const entry = meta[paramtype] as {
    factory: (d: unknown, ctx: ExecutionContext) => unknown;
    data: unknown;
  };
  return entry.factory(entry.data, makeCtx(req));
}

describe('CurrentUser decorator (§6.2)', () => {
  it('req.user 不存在 → 返回 undefined', () => {
    const out = invoke(undefined, {});
    expect(out).toBeUndefined();
  });

  it('req.user 存在 + 无 data → 返回整个 user 对象', () => {
    const user = { sub: 'usr-1', role: 'admin' as const };
    const out = invoke(undefined, { user });
    expect(out).toEqual(user);
  });

  it("req.user 存在 + data='sub' → 返回 user.sub", () => {
    const user = { sub: 'usr-2', role: 'auditor' as const };
    const out = invoke('sub', { user });
    expect(out).toBe('usr-2');
  });

  it("req.user 存在 + data='role' → 返回 user.role", () => {
    const user = { sub: 'usr-3', role: 'developer' as const };
    const out = invoke('role', { user });
    expect(out).toBe('developer');
  });

  it('CurrentUser 装饰器导出存在', () => {
    expect(typeof CurrentUser).toBe('function');
    const decorator = CurrentUser('sub');
    expect(typeof decorator).toBe('function');
  });
});
