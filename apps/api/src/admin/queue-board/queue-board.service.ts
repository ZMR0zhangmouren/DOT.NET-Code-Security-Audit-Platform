import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

/**
 * §11 Q6 —— Bull-Board 可视化(Phase 2.5)
 *
 * 把已有的 BullMQ `scan` 队列包成 Bull-Board,通过 Express adapter 暴露给
 * `/admin/queue` 端点。Adapter 由 main.ts 通过 app.use() 挂载;本服务只负责
 * 构造 adapter 骨架 + 暴露给 main.ts。
 *
 * 设计取舍:
 *   - 不通过 @InjectQueue 拿 Queue,改用显式 attachQueue(Queue) 由 main.ts 注入:
 *     * 不需要在 QueueBoardModule 里 registerQueue(避免和 ScanModule 重复)
 *     * 不需要 import ScanModule(避免循环依赖)
 *     * 不需要 export getQueueToken()(BullModule 不允许直接 export provider token)
 *     * main.ts 已经有 ScanQueueService,顺手 getQueue() 出来即可
 *   - 用 `@bull-board/express` 而不是 `@bull-board/nestjs`:
 *     `@bull-board/nestjs` 要求 BullModule.registerQueue 必须**在 QueueBoardModule 内**,
 *     跟 ScanModule 的 `BullModule.registerQueue({ name: 'scan' })` 会冲突。
 *   - setBasePath('/admin/queue') 让 Bull-Board 自己拼的 static/api URL 都带前缀,
 *     配合 main.ts 的 app.use('/admin/queue', adapter.getRouter()) 形成最终路径。
 *   - 鉴权由 main.ts 的 QueueBoardAuthMiddleware 单独加(JWT + BasicAuth 双通道)
 */
export const QUEUE_BOARD_BASE_PATH = '/admin/queue';

@Injectable()
export class QueueBoardService implements OnModuleInit {
  private readonly logger = new Logger('QueueBoardService');

  private readonly adapter: ExpressAdapter;
  private board: ReturnType<typeof createBullBoard> | undefined;
  private readonly mountPath: string;
  private attachedQueues: string[] = [];

  constructor() {
    this.adapter = new ExpressAdapter();
    this.adapter.setBasePath(QUEUE_BOARD_BASE_PATH);
    this.mountPath = QUEUE_BOARD_BASE_PATH;
  }

  onModuleInit(): void {
    this.logger.log(
      `Bull-Board adapter constructed; mountPath=${this.mountPath}` +
        ` (attach queues via attachQueue())`,
    );
  }

  /**
   * 由 main.ts 在拿到 ScanQueueService 后调用,把 scan Queue 注入 Bull-Board。
   * 可重复调用以附加更多队列(report / vuln-cleanup 等)。
   */
  attachQueue<T>(queue: Queue<T>, name?: string): void {
    const adapter = new BullMQAdapter(queue);
    const queueName = name ?? queue.name;
    if (this.board) {
      this.board.addQueue(adapter);
    } else {
      this.board = createBullBoard({
        queues: [adapter],
        serverAdapter: this.adapter,
      });
    }
    this.attachedQueues.push(queueName);
    this.logger.log(`Attached queue "${queueName}" to Bull-Board`);
  }

  /** 给 main.ts 调:挂到 express app 上 */
  getRouter(): unknown {
    if (!this.board) {
      throw new Error('No queues attached to Bull-Board; call attachQueue() before getRouter()');
    }
    return this.adapter.getRouter();
  }

  /** 挂载路径(给 main.ts 调 + 测试断言) */
  getMountPath(): string {
    return this.mountPath;
  }

  /** 已注册的队列名(测试断言 + 调试用) */
  getAttachedQueues(): string[] {
    return [...this.attachedQueues];
  }
}
