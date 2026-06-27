import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { users } from '../db/schema.js';

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
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: '15m' });
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

  async verifyToken(token: string): Promise<JwtPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return payload;
    } catch {
      return null;
    }
  }
}
