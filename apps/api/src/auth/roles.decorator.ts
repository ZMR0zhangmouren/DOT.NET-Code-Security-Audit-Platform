import { SetMetadata } from '@nestjs/common';

import type { JwtPayload } from './auth.service.js';

export const ROLES_KEY = 'roles';

/**
 * §6.2 角色白名单装饰器 —— 配合 RolesGuard 用
 *
 * 用法:
 *   @Roles('admin')                  // 只 admin
 *   @Roles('admin', 'auditor')       // admin 或 auditor
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *
 * 配合 §5.7 系统配置(AI Key / Git Credentials / Proxy)等 admin-only 端点。
 */
export const Roles = (...roles: JwtPayload['role'][]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
