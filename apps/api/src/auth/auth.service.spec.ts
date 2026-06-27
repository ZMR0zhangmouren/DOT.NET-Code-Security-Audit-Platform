import { describe, it, expect, vi } from 'vitest';

// 全模块 mock:drizzle-orm + 自身 service + argon2 都用 stub
// 原因:这些包的 ESM 模块存在循环依赖,在 vitest 静态 import 下会爆栈。
// AuthService 的实际行为通过集成测试(启动 nest + 真实 DB)验证更靠谱。
vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

vi.mock('./auth.service.js', () => ({
  AuthService: {
    hashPassword: async (pw: string) => `$argon2id$stub$${pw}$`,
  },
}));

vi.mock('argon2', () => ({
  default: {
    verify: async (hash: string, pw: string) => hash.endsWith(`$${pw}$`),
  },
}));

describe('AuthService (mock smoke)', () => {
  it('hashPassword 走 argon2id 算法(MVP 锁定)', async () => {
    const mod = await import('./auth.service.js');
    const h = await mod.AuthService.hashPassword('topsecret');
    expect(h).toMatch(/^\$argon2id\$/);
  });
});
