import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * §6.2 鉴权门禁:
 * - 未带 Bearer token / token 无效 / 已过期 → 401
 * - 通过后 PassportStrategy.validate 的返回值挂到 req.user({ sub, role })
 *
 * 用法:@UseGuards(JwtAuthGuard) 放在 controller / 路由方法上
 *   - controller 级 = 整个 controller 都要登录
 *   - method 级    = 配合 @Public() 装饰器(本阶段 MVP 不做,所有端点都要登录)
 *
 * 公开端点(/api/health)直接不加这个 Guard 即可。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
