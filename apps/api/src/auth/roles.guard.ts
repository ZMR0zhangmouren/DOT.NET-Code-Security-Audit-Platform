import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { JwtPayload } from './auth.service.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * 角色白名单门禁:
 * - 读 @Roles(...) 元数据(没设就放行)
 * - 从 req.user.role 比对(由 JwtStrategy.validate 注入)
 * - 不在白名单 → 403 Forbidden
 *
 * 注意:JwtAuthGuard 必须先于 RolesGuard 执行(在 @UseGuards 里写在前面),
 * 否则 req.user 不存在,本 Guard 会直接 403。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<JwtPayload['role'][] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) {
      // 没设 @Roles(...) → 不限制角色(但仍需登录,这点由 JwtAuthGuard 保证)
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const user = (req as Request & { user?: { sub?: string; role?: JwtPayload['role'] } }).user;
    if (!user || !user.role) {
      // 没登录或 payload 没 role 字段 → 拒
      // (理论上 JwtAuthGuard 已挡 401,这里再 403 兜底)
      throw new ForbiddenException('missing user role');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `role "${user.role}" is not allowed; required one of [${required.join(', ')}]`,
      );
    }
    return true;
  }
}
