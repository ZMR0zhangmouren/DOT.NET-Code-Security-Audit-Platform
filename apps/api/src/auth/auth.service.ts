import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtService } from '@nestjs/jwt'; // 运行时需保留(NestJS DI 反射元数据)
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { users } from '../db/schema.js';

/**
 * §6.2 密码强度规则(MVP):
 * - 至少 8 字符
 * - 至少 1 个数字
 * - 至少 1 个字母
 * Phase 2 可加大小写 / 特殊字符等更严规则。
 */
export function validatePasswordStrength(pw: string): void {
  if (pw.length < 8) {
    throw new BadRequestException('password must be at least 8 characters');
  }
  if (!/[0-9]/.test(pw)) {
    throw new BadRequestException('password must contain at least one digit');
  }
  if (!/[A-Za-z]/.test(pw)) {
    throw new BadRequestException('password must contain at least one letter');
  }
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: 'admin' | 'auditor' | 'developer' | 'viewer';
}

export interface AuthedUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'auditor' | 'developer' | 'viewer';
}

/**
 * §4.2.7 User + §6.2 认证:
 * - 密码哈希:argon2id(cost ≥ 12)
 * - 会话:JWT(Access 15min + Refresh 7d)
 * - 传输:HttpOnly + SameSite=Strict Cookie(Phase 1 简化为返回 JWT 让前端自行处理)
 *
 * §6.2 还要求 refresh token 旋转与吊销;MVP 阶段先做最小可用版。
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  /** 用 argon2id 哈希密码 */
  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async login(
    usernameOrEmail: string,
    password: string,
  ): Promise<{
    accessToken: string;
    user: AuthedUser;
  }> {
    const rows = this.db.select().from(users).where(eq(users.username, usernameOrEmail)).all();
    const found = rows[0] ?? null;
    if (!found || !found.isActive) {
      throw new UnauthorizedException('invalid credentials');
    }
    const ok = await argon2.verify(found.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('invalid credentials');
    }
    // 更新 last_login_at
    this.db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, found.id)).run();

    const payload: JwtPayload = {
      sub: found.id,
      username: found.username,
      role: found.role,
    };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: '8h' });
    return {
      accessToken,
      user: {
        id: found.id,
        username: found.username,
        email: found.email,
        displayName: found.displayName,
        role: found.role,
      },
    };
  }

  async me(userId: string): Promise<AuthedUser | null> {
    const rows = this.db.select().from(users).where(eq(users.id, userId)).all();
    const found = rows[0] ?? null;
    if (!found) return null;
    return {
      id: found.id,
      username: found.username,
      email: found.email,
      displayName: found.displayName,
      role: found.role,
    };
  }

  /**
   * §6.2 鉴权配套:从 DB 取 user 完整公开信息(供 /auth/me 用)。
   * 与 me() 行为一致;改名为 getMe 让 controller 调用更显式。
   */
  async getMe(userId: string): Promise<AuthedUser | null> {
    return this.me(userId);
  }

  async verifyToken(token: string): Promise<JwtPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * §6.2 改密码(登录用户改自己):
   * 1. 校验旧密码(走 argon2.verify)
   * 2. 校验新密码强度
   * 3. 新旧密码相同 → 拒绝
   * 4. argon2id 重新 hash 并落盘
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    if (!oldPassword || !newPassword) {
      throw new BadRequestException('oldPassword and newPassword are required');
    }
    if (oldPassword === newPassword) {
      throw new BadRequestException('new password must differ from old password');
    }
    const row = this.db.select().from(users).where(eq(users.id, userId)).get() as
      | { id: string; passwordHash: string; isActive: boolean | null }
      | undefined;
    if (!row) {
      throw new NotFoundException(`user ${userId} not found`);
    }
    if (row.isActive === false) {
      throw new UnauthorizedException('user is inactive');
    }
    const ok = await argon2.verify(row.passwordHash, oldPassword);
    if (!ok) {
      throw new BadRequestException('old password is incorrect');
    }
    validatePasswordStrength(newPassword);
    const passwordHash = await AuthService.hashPassword(newPassword);
    const result = this.db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
    if (result.changes === 0) {
      throw new NotFoundException(`user ${userId} not found`);
    }
    return { ok: true };
  }
}
