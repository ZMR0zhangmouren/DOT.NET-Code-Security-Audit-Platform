import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import type { Express } from 'express';

import { createQueueBoardAuthMiddleware } from './admin/queue-board/queue-board-auth.middleware.js';
import { QueueBoardService } from './admin/queue-board/queue-board.service.js';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js'; // runtime ref (NestJS DI 反射)
import { ScanQueueService } from './scan/scan-queue.service.js'; // runtime ref (NestJS DI)

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  // Body-parser 上限:json/urlencoded 上限 50MB,raw 上限 100MB
  // 满足 §5.2 Q4 的要求 (zip ≤ 500MB, git ≤ 1GB;请求体 ≤ 100MB)
  // 不设置默认 100KB — 会触发 413 Payload Too Large(即使走了 multer)
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.use(cookieParser());
  expressApp.use(json({ limit: '50mb' }));
  expressApp.use(urlencoded({ limit: '50mb', extended: true }));

  // CORS(开发期允许 web dev server;Phase 1 锁定默认 5180)
  const corsOrigins = (process.env['CORS_ORIGINS'] ?? 'http://localhost:5180')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });

  // 全局 ValidationPipe(Phase 2 接入 class-validator 时启用)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 全局路由前缀 /api,前端 vite proxy 与 README 一致
  // 例:/health → /api/health、/auth/login → /api/auth/login
  app.setGlobalPrefix('api');

  // §11 Q6 + Q13 —— Bull-Board Admin UI(/admin/queue,无 /api 前缀)
  // expressApp 已在上面 body-parser 初始化中拿到,这里复用。
  const queueBoard = app.get(QueueBoardService);
  const authService = app.get(AuthService);
  const scanQueueService = app.get(ScanQueueService);
  // 把 ScanModule 已注册的 scan Queue 实例直接 attach 给 Bull-Board
  // (ScanQueueService.getQueue() 返回 @InjectQueue('scan') 注入的 Queue 引用)
  const scanQueue = scanQueueService.getQueue();
  if (scanQueue) {
    queueBoard.attachQueue(scanQueue, 'scan');
  } else {
    logger.warn('ScanQueueService does not expose its Queue — Bull-Board will start empty');
  }
  expressApp.use(
    queueBoard.getMountPath(),
    createQueueBoardAuthMiddleware(authService),
    queueBoard.getRouter() as never,
  );
  logger.log(
    `Bull-Board mounted at ${queueBoard.getMountPath()} (auth: JWT admin OR Basic ${process.env['BULL_BOARD_BASIC_USER'] ?? 'admin'}:***, queues: [${queueBoard.getAttachedQueues().join(', ')}])`,
  );

  // 默认监听 127.0.0.1:3030(§6.5 部署锁定"仅监听 127.0.0.1,不暴露公网")
  const port = Number(process.env['PORT'] ?? 3030);
  const host = process.env['HOST'] ?? '127.0.0.1';
  await app.listen(port, host);
  logger.log(`API listening on http://${host}:${port} (prefix=/api)`);
}

void bootstrap();
