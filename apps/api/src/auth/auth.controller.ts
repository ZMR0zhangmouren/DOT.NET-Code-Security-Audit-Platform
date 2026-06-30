import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService, type AuthedUser } from './auth.service.js'; // AuthService 需保留运行时引用(NestJS DI)
import { CurrentUser } from './current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthenticatedUser } from './jwt.strategy.js';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

interface LoginDto {
  usernameOrEmail: string;
  password: string;
}

interface ChangePasswordDto {
  oldPassword?: string;
  newPassword?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/api/auth',
    });
  }

  /**
   * §6.2 登录(公开端点)
   * 成功:200 { accessToken, user } + Set-Cookie: refresh_token (HttpOnly)
   * 失败:401 invalid credentials
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: AuthedUser }> {
    const result = await this.auth.login(body.usernameOrEmail, body.password);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  /**
   * §6.2 Refresh:用 refresh_token cookie 换新 access token(旋转 refresh token)
   * 成功:200 { accessToken, user } + Set-Cookie: new refresh_token
   * 失败:401
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: AuthedUser }> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw || typeof raw !== 'string') {
      throw new UnauthorizedException('missing refresh token');
    }
    const result = await this.auth.refresh(raw);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  /**
   * §6.2 Logout:吊销所有 refresh token + 清 cookie
   * 成功:200 { ok: true }
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    this.auth.logout(user.sub);
    this.clearRefreshCookie(res);
    return { ok: true };
  }

  /**
   * §6.2 当前用户(需登录)
   * 401:未带 / 无效 token(JwtAuthGuard 兜底)
   * 404:token 合法但 user 不存在(DB 删了但 token 没过期)
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthedUser> {
    if (!user) throw new UnauthorizedException('missing user');
    const me = await this.auth.getMe(user.sub);
    if (!me) throw new NotFoundException(`user ${user.sub} not found`);
    return me;
  }

  /**
   * §6.2 改自己密码(需登录):
   * - body: { oldPassword, newPassword }
   * - 成功:200 { ok: true }
   * - 失败:400 旧密码错 / 新密码弱,401 未登录,404 用户不存在
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    if (!user) throw new UnauthorizedException('missing user');
    if (!body.oldPassword || !body.newPassword) {
      // 委托给 service 统一抛 BadRequestException
    }
    return this.auth.changePassword(user.sub, body.oldPassword ?? '', body.newPassword ?? '');
  }
}
