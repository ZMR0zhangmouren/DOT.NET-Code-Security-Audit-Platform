import { createHash, randomBytes } from 'node:crypto';

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
import { and, eq, isNull } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { refreshTokens, users } from '../db/schema.js';

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

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthedUser;
}

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_MS = 7 * 24 * 3600 * 1000; // 7 days
const ACCESS_TOKEN_MS = 15 * 60 * 1000; // 15 min

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * §4.2.7 User + §6.2 认证:
 * - 密码哈希:argon2id(cost ≥ 12)
 * - access token:JWT 15min,返回 body(前端内存持有)
 * - refresh token:随机字符串 7d,HttpOnly cookie,旋转/吊销
 * - 客户端收到 401 时静默调 /api/auth/refresh 换新 access token
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

  /** 签发 access token(JWT,短期) */
  private async issueAccessToken(user: {
    id: string;
    username: string;
    role: string;
  }): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role as JwtPayload['role'],
    };
    return this.jwt.signAsync(payload, { expiresIn: `${ACCESS_TOKEN_MS / 1000}s` });
  }

  /** 生成 refresh token(随机 hex),SHA-256 哈希后落 DB,返回原始 token */
  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const hash = sha256hex(raw);
    const now = Date.now();
    this.db
      .insert(refreshTokens)
      .values({
        id: `rt-${now.toString(36)}-${randomBytes(4).toString('hex')}`,
        userId,
        tokenHash: hash,
        expiresAt: now + REFRESH_TOKEN_MS,
        createdAt: now,
      })
      .run();
    return raw;
  }

  async login(usernameOrEmail: string, password: string): Promise<LoginResult> {
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

    const accessToken = await this.issueAccessToken(found);
    const refreshToken = await this.issueRefreshToken(found.id);
    return {
      accessToken,
      refreshToken,
      user: {
        id: found.id,
        username: found.username,
        email: found.email,
        displayName: found.displayName,
        role: found.role,
      },
    };
  }

  /**
   * §6.2 Refresh:用 refresh token 换新的 access token + 新 refresh token(旋转)
   *
   * 流程:
   * 1. SHA-256 哈希 raw token
   * 2. 查 DB 找未过期、未吊销的匹配行
   * 3. 吊销旧 token(写 revokedAt)
   * 4. 签发新 access + refresh token
   */
  async refresh(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: AuthedUser }> {
    const hash = sha256hex(rawRefreshToken);
    const now = Date.now();
    const row = this.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)))
      .get() as
      | { id: string; userId: string; tokenHash: string; expiresAt: number; revokedAt: null }
      | undefined;

    if (!row || row.expiresAt < now) {
      throw new UnauthorizedException('invalid or expired refresh token');
    }

    // 吊销旧 token
    this.db.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, row.id)).run();

    // 查 user
    const user = this.db.select().from(users).where(eq(users.id, row.userId)).get() as
      | {
          id: string;
          username: string;
          email: string;
          displayName: string | null;
          role: string;
          isActive: boolean | null;
        }
      | undefined;
    if (!user || !user.isActive) {
      throw new UnauthorizedException('user inactive or deleted');
    }

    const accessToken = await this.issueAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        role: user.role as AuthedUser['role'],
      },
    };
  }

  /**
   * §6.2 Logout:吊销所有活跃 refresh token(可选全量 or 单条)
   * 这里做全量吊销——用户登出时清掉该用户所有未吊销 token
   */
  logout(userId: string): void {
    const now = Date.now();
    this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .run();
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
