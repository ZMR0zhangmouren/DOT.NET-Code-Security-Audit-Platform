import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../db/database.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';

/**
 * §4.2.7 + §6.2 AuthModule
 *
 * JWT 配置:从 process.env.JWT_SECRET 读(无则 dev fallback);过期 15m;
 * Refresh Token 与 HttpOnly Cookie 留 Phase 2 接。
 *
 * PassportModule.register({ defaultStrategy: 'jwt' }) 让其它 module
 * 通过 @UseGuards(JwtAuthGuard) / @UseGuards(RolesGuard) 走同一套鉴权,
 * 不需要在每个 module 重复 import PassportModule。
 */
@Module({
  imports: [
    DatabaseModule, // 提供 DATABASE token,AuthService 通过它拿到 Db
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-secret-change-me',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
