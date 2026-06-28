import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from './jwt.strategy.js';

/**
 * §6.2 鉴权配套:从 req 取 JwtStrategy 注入的用户信息。
 *
 * 用法:
 *   async me(@CurrentUser() user: AuthenticatedUser) { ... }
 *   async changePassword(@CurrentUser('sub') userId: string) { ... }
 *
 * JwtAuthGuard 必须先于 controller 方法执行,否则 req.user 不存在,
 * 返回 undefined(由 controller 自己处理 401 / 404 兜底)。
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext): unknown => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
