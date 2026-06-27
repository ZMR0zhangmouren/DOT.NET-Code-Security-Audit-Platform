import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/**
 * §5.3 实时扫描推送 Gateway —— /scans 命名空间
 *
 * 客户端订阅:`socket.emit('subscribe:scan', { scanRunId })`,后端按 room 推:
 * - `scan:progress`   { scanRunId, percent, currentStage, ... }
 * - `scan:log`        { scanRunId, level, message, ts }
 * - `scan:status`     { scanRunId, status }
 * - `scan:complete`   { scanRunId, status, gateDecision, ... }
 *
 * MVP 起步:仅暴露 `/scans/demo` 测试通道;§5.3 主流程接入时把 ScanRunner
 * 接到 emitProgress / emitLog / emitComplete。
 */
@WebSocketGateway({ namespace: '/scans', cors: { origin: true, credentials: true } })
export class ScanGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('ScanGateway');

  @WebSocketServer()
  server!: Server;

  afterInit(): void {
    this.logger.log('Socket.IO gateway /scans initialized');
  }

  handleConnection(client: Socket): void {
    this.logger.log(`client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:scan')
  onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { scanRunId?: string },
  ): { ok: boolean; scanRunId?: string; error?: string } {
    const id = body?.scanRunId;
    if (!id || typeof id !== 'string') {
      return { ok: false, error: 'scanRunId required' };
    }
    void client.join(`scan:${id}`);
    this.logger.log(`client ${client.id} subscribed to scan:${id}`);
    return { ok: true, scanRunId: id };
  }

  @SubscribeMessage('demo:poke')
  onDemoPoke(@MessageBody() body: { scanRunId?: string }): { ok: boolean; delivered: number } {
    const id = body?.scanRunId ?? 'demo';
    const room = `scan:${id}`;
    this.server.to(room).emit('scan:log', {
      scanRunId: id,
      level: 'info',
      message: `[demo] ${new Date().toISOString()} pong from gateway`,
      ts: Date.now(),
    });
    // Socket.IO emit 返回 boolean,不暴露给 API 客户端
    return { ok: true, delivered: 1 };
  }
}
