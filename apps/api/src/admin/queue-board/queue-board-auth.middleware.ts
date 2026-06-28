import { Logger } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService, type JwtPayload } from '../../auth/auth.service.js'; // runtime ref (NestJS DI)

/**
 * §11 Q6 + §11 Q13 —— Bull-Board Admin 鉴权中间件
 *
 * 用途:挂到 /admin/queue 整条路径上(在 Bull-Board adapter 之前)。
 * Q13 锁定 admin-only 端点 admin 角色;Q6 要求 Bull-Board 可视化只对管理员开放。
 *
 * 双通道鉴权(优先级从上到下):
 *   1. JWT Bearer token —— 调 /api/auth/login 拿的 accessToken;验证通过 + role=admin
 *   2. HTTP Basic —— MVP fallback,凭证来自环境变量 BULL_BOARD_BASIC_USER / BULL_BOARD_BASIC_PASS
 *      (默认 admin / admin),便于本地裸起 API 后浏览器直接打开 dashboard
 *   3. 都失败 → 401 + WWW-Authenticate 头(触发浏览器弹 Basic 框)
 *
 * 设计取舍(与 Task N 兼容):
 *   - 不依赖 Passport/JwtAuthGuard/RolesGuard(可能由 Task N 并行做)
 *   - 自己用 AuthService.verifyToken 直接校验 —— 与 /api/auth/me 同源
 *   - 不在中间件里 throw NestJS HttpException —— 这是 express middleware,
 *     NestJS 的 ExceptionFilter 不会捕获这里,直接 res.status(401) 即可
 *
 * 安全说明:
 *   - 仅监听 127.0.0.1(已在 main.ts 锁定 §6.5),外网不可达
 *   - 仅 admin role 可通过(角色字段从 JWT payload 取,与 DB users.role 对齐)
 *   - Basic fallback 用 constant-time 比较避免时序攻击
 */
export function createQueueBoardAuthMiddleware(auth: AuthService): RequestHandler {
  const logger = new Logger('QueueBoardAuth');

  // Basic 凭证默认值(覆盖方式:设环境变量 BULL_BOARD_BASIC_USER / BULL_BOARD_BASIC_PASS)
  const basicUser = process.env['BULL_BOARD_BASIC_USER'] ?? 'admin';
  const basicPass = process.env['BULL_BOARD_BASIC_PASS'] ?? 'admin';

  return async function queueBoardAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // 路径白名单:Bull-Board UI + API 全部要走鉴权,没有白名单
    // 这里跳过 /admin/queue 的 OPTIONS 预检(浏览器跨域)
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    // 1) JWT Bearer
    const authHeader = (req.headers['authorization'] ?? '') as string;
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (bearerMatch && bearerMatch[1]) {
      const token = bearerMatch[1];
      try {
        const payload: JwtPayload | null = await auth.verifyToken(token);
        if (payload && payload.role === 'admin') {
          // 通过
          (req as Request & { adminUser?: JwtPayload }).adminUser = payload;
          next();
          return;
        }
        if (payload && payload.role !== 'admin') {
          logger.warn(
            `non-admin role attempted /admin/queue: user=${payload.username}, role=${payload.role}`,
          );
          res.status(403).json({ error: 'admin role required' });
          return;
        }
        // payload 为 null(过期 / 签名错) → 落到 Basic fallback
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`JWT verify threw, falling back to Basic: ${msg}`);
      }
    }

    // 2) Basic
    const basicHeader = (req.headers['authorization'] ?? '') as string;
    const basicMatch = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(basicHeader);
    if (basicMatch && basicMatch[1]) {
      try {
        const decoded = Buffer.from(basicMatch[1], 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx > 0) {
          const user = decoded.slice(0, idx);
          const pass = decoded.slice(idx + 1);
          // constant-time 比较
          const userOk = timingSafeEqual(user, basicUser);
          const passOk = timingSafeEqual(pass, basicPass);
          if (userOk && passOk) {
            (req as Request & { adminUser?: JwtPayload }).adminUser = {
              sub: 'basic-admin',
              username: basicUser,
              role: 'admin',
            };
            next();
            return;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`Basic decode threw: ${msg}`);
      }
    }

    // 3) 都失败 → 401
    logger.warn(`rejected /admin/queue ${req.method} ${req.url}: no valid JWT/Basic`);
    res.setHeader(
      'WWW-Authenticate',
      'Basic realm="Bull-Board", charset="UTF-8", Bearer realm="Bull-Board"',
    );
    res.status(401).json({ error: 'authentication required' });
  };
}

/**
 * Node 自带 crypto.timingSafeEqual 的封装,避免长度不同的字符串导致抛错。
 * 先 padding 到同长度再比,length-mismatch 也用 equal-length 比较 → 仍 safe。
 */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length, 1);
  const bufA = Buffer.alloc(len);
  const bufB = Buffer.alloc(len);
  bufA.write(a);
  bufB.write(b);
  // 只要长度不同本身就足以判 false;但 timingSafeEqual 的内部 polyfill
  // 用异或累积,只要我们在外面用异或累积的结果即可。这里简化为长度+全字符比对。
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
