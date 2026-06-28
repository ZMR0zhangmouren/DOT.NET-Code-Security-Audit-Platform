import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module.js';

import { QueueBoardController } from './queue-board.controller.js';
import { QueueBoardService } from './queue-board.service.js';

/**
 * §11 Q6 + §11 Q13 —— Bull-Board Admin Module
 *
 * 职责:
 *   - 持有 QueueBoardService(由 main.ts 在 bootstrap 时调 attachQueue() 注入 BullMQ Queue)
 *   - 提供 QueueBoardController 给集成测试 / 健康检查
 *   - 暴露 AuthModule 让 QueueBoardService 和 middleware 共享 AuthService(verifyToken)
 *
 * 关键设计:
 *   - QueueBoardService 不在构造时注入 Queue,改用 main.ts 显式 attachQueue(q)
 *   - 避免 QueueBoardModule.registerQueue 与 ScanModule.registerQueue 重复
 *   - 避免 QueueBoardModule import ScanModule 引起的循环依赖风险
 *   - 共享同一个 BullMQ Queue 实例(由 ScanModule 注册,main.ts 取出后再 attach)
 */
@Module({
  imports: [AuthModule],
  controllers: [QueueBoardController],
  providers: [QueueBoardService],
  exports: [QueueBoardService],
})
export class QueueBoardModule {}
