import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService, type AuthedUser, type JwtPayload } from './auth.service.js'; // AuthService 需保留运行时引用(NestJS DI)

interface LoginDto {
  usernameOrEmail: string;
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto): Promise<{ accessToken: string; user: AuthedUser }> {
    return this.auth.login(body.usernameOrEmail, body.password);
  }

  @Get('me')
  async me(@Req() req: Request): Promise<AuthedUser | { error: string }> {
    // MVP 阶段:从 Authorization header 解 JWT;Phase 2 接 HttpOnly Cookie
    const auth = (req.headers['authorization'] ?? '') as string;
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m || !m[1]) return { error: 'missing bearer token' };
    const payload: JwtPayload | null = await this.auth.verifyToken(m[1]);
    if (!payload) return { error: 'invalid token' };
    const user = await this.auth.me(payload.sub);
    if (!user) return { error: 'user not found' };
    return user;
  }

  /**
   * §6.2 改自己密码(首次登录后改 / 定期改):
   * - 需带 Authorization: Bearer <jwt> 头
   * - body: { oldPassword, newPassword }
   * - 成功:200 { ok: true }
   * - 失败:400 旧密码错 / 新密码弱 / 401 缺 token / 404 用户不存在
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: Request,
    @Body() body: { oldPassword?: string; newPassword?: string },
  ): Promise<{ ok: true }> {
    const auth = (req.headers['authorization'] ?? '') as string;
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m || !m[1]) throw new UnauthorizedException('missing bearer token');
    const payload: JwtPayload | null = await this.auth.verifyToken(m[1]);
    if (!payload) throw new UnauthorizedException('invalid token');
    if (!body.oldPassword || !body.newPassword) {
      throw new BadRequestException('oldPassword and newPassword are required');
    }
    return this.auth.changePassword(payload.sub, body.oldPassword, body.newPassword);
  }
}
