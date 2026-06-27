import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthService } from './auth.service.js';
import { type AuthedUser, type JwtPayload } from './auth.service.js';

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
}
