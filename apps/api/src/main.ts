import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

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

  // 默认监听 127.0.0.1:3030(§6.5 部署锁定"仅监听 127.0.0.1,不暴露公网")
  const port = Number(process.env['PORT'] ?? 3030);
  const host = process.env['HOST'] ?? '127.0.0.1';
  await app.listen(port, host);
  logger.log(`API listening on http://${host}:${port}`);
}

void bootstrap();
