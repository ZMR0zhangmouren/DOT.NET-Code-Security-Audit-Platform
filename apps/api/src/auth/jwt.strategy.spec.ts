import { ExtractJwt } from 'passport-jwt';
import { describe, it, expect } from 'vitest';

import type { JwtPayload } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy (Passport)', () => {
  it('validate 透传 sub + role(req.user 将挂上这两个字段)', () => {
    const strategy = new JwtStrategy();
    const payload: JwtPayload = {
      sub: 'usr-1',
      username: 'alice',
      role: 'admin',
    };
    const user = strategy.validate(payload);
    expect(user).toEqual({ sub: 'usr-1', role: 'admin' });
  });

  it('validate 不暴露 username / exp(只挑出 sub + role)', () => {
    const strategy = new JwtStrategy();
    const payload = {
      sub: 'usr-2',
      username: 'bob',
      role: 'auditor' as const,
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    };
    const user = strategy.validate(payload);
    expect(user).toEqual({ sub: 'usr-2', role: 'auditor' });
    expect((user as Record<string, unknown>)['username']).toBeUndefined();
    expect((user as Record<string, unknown>)['exp']).toBeUndefined();
  });

  it('validate 各角色透传正确(枚举白名单 sanity)', () => {
    const strategy = new JwtStrategy();
    const roles: JwtPayload['role'][] = ['admin', 'auditor', 'developer', 'viewer'];
    for (const r of roles) {
      expect(strategy.validate({ sub: `u-${r}`, username: r, role: r })).toEqual({
        sub: `u-${r}`,
        role: r,
      });
    }
  });

  it('PassportStrategy 配置:从 Authorization Bearer 头取 token', () => {
    // 通过 new JwtStrategy() 不报错即说明 PassportStrategy 装饰器接受 options
    // 这里再单独验证 ExtractJwt.fromAuthHeaderAsBearerToken() 行为:
    const extractor = ExtractJwt.fromAuthHeaderAsBearerToken();
    expect(extractor({ headers: { authorization: 'Bearer xyz' } } as never)).toBe('xyz');
    expect(extractor({ headers: { authorization: 'bearer ABC' } } as never)).toBe('ABC');
    expect(extractor({ headers: {} } as never)).toBe(null);
  });
});
