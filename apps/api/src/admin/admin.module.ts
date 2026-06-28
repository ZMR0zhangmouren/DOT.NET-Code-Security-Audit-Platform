import { Module } from '@nestjs/common';

import { QueueBoardModule } from './queue-board/queue-board.module.js';

/**
 * Admin 模块聚合根(§11 Q13 锁定 admin-only 端点 admin 角色)
 *
 * 现阶段包含:
 *   - QueueBoardModule —— Bull-Board 可视化(/admin/queue)
 * 后续接入:
 *   - AuditLogModule —— §6.2 审计日志查询
 *   - SettingsAdminModule —— §5.7 AI Key + Redis 配置 UI
 *
 * 注意:本模块不持有路由 —— Bull-Board 的 UI/API 走 main.ts 的 app.use()
 * 挂载。QueueBoardModule 暴露 QueueBoardService 给 main.ts 取 adapter。
 */
@Module({
  imports: [QueueBoardModule],
  exports: [QueueBoardModule],
})
export class AdminModule {}
