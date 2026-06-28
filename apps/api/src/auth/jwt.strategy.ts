import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { JwtPayload } from './auth.service.js';

/**
 * §6.2 真实 JWT 解码 + Passport 集成
 *
 * - 提取方式:Authorization: Bearer <token>(MVP 不接 HttpOnly Cookie)
 * - 校验签名 + 过期
 * - validate(payload) 返回 { sub, role } —— NestJS 把它挂到 req.user
 *   - role 是从 payload 解出的,后续 @Roles() + RolesGuard 用 req.user.role 做白名单
 *
 * secret 优先级:process.env.JWT_SECRET > 'dev-secret-change-me'
 *  (与 AuthModule.JwtModule.register 保持一致,避免 sign 与 verify 用不同 secret)
 */
export interface AuthenticatedUser {
  sub: string;
  role: JwtPayload['role'];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env['JWT_SECRET'] ?? 'dev-secret-change-me',
    });
  }

  /**
   * PassportStrategy 验证签名 + 过期后,把 payload 透传给 validate。
   * 返回值作为 req.user(由 NestJS passport 自动注入)。
   * 这里只挑出策略需要的两个字段:sub(用户 id) + role(角色)。
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    return { sub: payload.sub, role: payload.role };
  }
}
