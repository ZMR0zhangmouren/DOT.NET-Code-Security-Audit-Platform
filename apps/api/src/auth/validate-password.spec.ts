import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

// §6.2 密码强度校验分支覆盖:
// mock 掉 drizzle-orm / argon2 / schema 避免 ESM 循环依赖问题,
// 这样我们就能从 auth.service.js 拿到 validatePasswordStrength 这个纯函数。
vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

vi.mock('argon2', () => {
  const obj = {
    hash: async (pw: string) => `$argon2id$stub$${pw}$`,
    verify: async (hash: string, pw: string) => hash === `$argon2id$stub$${pw}$`,
    argon2id: 2,
  };
  return { ...obj, default: obj };
});

vi.mock('../db/schema.js', () => ({
  users: {
    id: { _col: 'id' },
    username: { _col: 'username' },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ _col: col._col, _val: val }),
}));

import { validatePasswordStrength } from './auth.service.js';

/**
 * §6.2 密码强度校验分支覆盖:
 * - 长度 < 8
 * - 缺数字
 * - 缺字母
 * - 通过(合法)
 *
 * 不依赖 DB / JwtService / argon2 —— 纯函数。
 */
describe('validatePasswordStrength (§6.2)', () => {
  it('长度 < 8 → BadRequestException', () => {
    expect(() => validatePasswordStrength('Ab1')).toThrow(BadRequestException);
    expect(() => validatePasswordStrength('Ab1')).toThrow(/at least 8 characters/);
    expect(() => validatePasswordStrength('')).toThrow(BadRequestException);
    expect(() => validatePasswordStrength('1234567')).toThrow(BadRequestException);
  });

  it('长度达标但缺数字 → BadRequestException', () => {
    expect(() => validatePasswordStrength('NoDigitsXX')).toThrow(/at least one digit/);
    expect(() => validatePasswordStrength('abcdefgh')).toThrow(BadRequestException);
  });

  it('长度达标但缺字母 → BadRequestException', () => {
    expect(() => validatePasswordStrength('12345678')).toThrow(/at least one letter/);
  });

  it('合法密码通过(8+ 字母 + 数字)', () => {
    expect(() => validatePasswordStrength('1234567a')).not.toThrow();
    expect(() => validatePasswordStrength('a1234567')).not.toThrow();
    expect(() => validatePasswordStrength('Password1')).not.toThrow();
    expect(() => validatePasswordStrength('longpassword9')).not.toThrow();
  });

  it('8 字符边界:恰好 8 字符 + 字母 + 数字 → 通过', () => {
    expect(() => validatePasswordStrength('a1234567')).not.toThrow();
  });

  it('7 字符边界:7 字符但有字母+数字 → 仍因长度失败', () => {
    expect(() => validatePasswordStrength('a123456')).toThrow(/at least 8 characters/);
  });
});
