import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { decryptSecret, encryptSecret, getMasterKey } from '../common/crypto.util.js';
import { DATABASE, type Db } from '../db/database.module.js';
import { proxyConfigs } from '../db/schema.js';

export interface ProxyConfigPublic {
  id: string;
  protocol: 'http' | 'https' | 'socks5' | null; // null = 直连(对应 §11 Q13 SOCKS5)
  host: string | null;
  port: number | null;
  username: string | null;
  /** 末 4 位占位符(如有密码)或 null(无密码) */
  passwordHint: string | null;
  applyTo: 'all' | 'http_only' | 'all_outbound';
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: number;
  testStatus: 'unknown' | 'success' | 'failed';
  testMessage: string | null;
}

interface ProxyConfigRow {
  id: string;
  protocol: 'http' | 'https' | 'socks5' | null;
  host: string | null;
  port: number | null;
  username: string | null;
  passwordEnc: string | null;
  applyTo: 'all' | 'http_only' | 'all_outbound';
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: number;
  testStatus: 'unknown' | 'success' | 'failed';
  testMessage: string | null;
}

/**
 * §5.7 Proxy Config —— 单条全局代理配置。
 *
 * §4.2.9 schema 注释:ProxyConfig 是单例(最多一行);此 service 提供
 * getCurrent() + upsert() 语义。
 *
 * 加密模式:password_enc 与 ai_keys/git_credentials 一致用 AES-256-GCM。
 */
@Injectable()
export class ProxyConfigService {
  private static readonly SINGLETON_ID = 'singleton';

  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /** 读取当前生效的代理配置;若无则返回 null(直连) */
  getCurrent(): ProxyConfigPublic | null {
    const row = this.db.select().from(proxyConfigs).get() as ProxyConfigRow | undefined;
    return row ? this.toPublic(row) : null;
  }

  /** upsert 语义:有则更新,无则创建(总是单条) */
  upsert(input: {
    protocol: 'http' | 'https' | 'socks5' | null;
    host: string | null;
    port: number | null;
    username?: string | null;
    password?: string | null;
    applyTo: 'all' | 'http_only' | 'all_outbound';
    isActive: boolean;
    updatedBy: string;
  }): ProxyConfigPublic {
    if (input.protocol === null) {
      // 直连模式 —— host/port/username/password 必须为 null,applyTo 仍可配
      if (input.host || input.port || input.username || input.password) {
        throw new BadRequestException(
          'Direct mode (protocol=null) requires host/port/username/password to be null',
        );
      }
    } else {
      if (!input.host || !input.port) {
        throw new BadRequestException('host and port are required when protocol is set');
      }
      if (input.port < 1 || input.port > 65535) {
        throw new BadRequestException('port must be between 1 and 65535');
      }
    }

    const existing = this.db.select().from(proxyConfigs).get() as ProxyConfigRow | undefined;
    const now = Date.now();

    if (!existing) {
      const id = ProxyConfigService.SINGLETON_ID;
      const passwordEnc = input.password ? encryptSecret(input.password, getMasterKey()) : null;
      this.db
        .insert(proxyConfigs)
        .values({
          id,
          protocol: input.protocol,
          host: input.host,
          port: input.port,
          username: input.username ?? null,
          passwordEnc,
          applyTo: input.applyTo,
          isActive: input.isActive,
          updatedBy: input.updatedBy,
          updatedAt: now,
          testStatus: 'unknown',
          testMessage: null,
        })
        .run();
    } else {
      const update: Partial<ProxyConfigRow> & { updatedAt: number } = {
        updatedAt: now,
        updatedBy: input.updatedBy,
      };
      update.protocol = input.protocol;
      update.host = input.host;
      update.port = input.port;
      update.username = input.username ?? null;
      // 仅当传入了非空 password 才重加密(空字符串保留旧值)
      if (input.password !== undefined && input.password !== null && input.password !== '') {
        update.passwordEnc = encryptSecret(input.password, getMasterKey());
      }
      update.applyTo = input.applyTo;
      update.isActive = input.isActive;
      // 配置变更后把 testStatus 重置为 unknown,避免与旧探测结果混淆
      update.testStatus = 'unknown';
      update.testMessage = null;

      this.db.update(proxyConfigs).set(update).where(eq(proxyConfigs.id, existing.id)).run();
    }

    return this.getCurrent()!;
  }

  /**
   * 测试连通性 —— MVP 实现:
   * - protocol=null → 标记 success("direct mode")
   * - 其它:用 Node 内置 net 尝试 TCP 连接到 host:port,5 秒超时
   *   - 成功 → success("connected in Xms")
   *   - 失败 → failed(error message)
   *
   * 真实 HTTP CONNECT 验证留 Phase 2(需要可变 base URL + 取消 token)
   */
  async testConnection(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    const row = this.db.select().from(proxyConfigs).get() as ProxyConfigRow | undefined;
    if (!row) {
      this.recordTestResult('failed', 'no proxy configured');
      return { ok: false, message: 'no proxy configured', latencyMs: Date.now() - start };
    }
    if (row.protocol === null) {
      this.recordTestResult('success', 'direct mode (no proxy)');
      return { ok: true, message: 'direct mode (no proxy)', latencyMs: 0 };
    }
    if (!row.host || !row.port) {
      this.recordTestResult('failed', 'host/port missing');
      return { ok: false, message: 'host/port missing', latencyMs: 0 };
    }

    const net = await import('node:net');
    const ok = await new Promise<boolean>((resolve) => {
      const sock = new net.Socket();
      let settled = false;
      const finish = (v: boolean): void => {
        if (settled) return;
        settled = true;
        sock.destroy();
        resolve(v);
      };
      sock.setTimeout(5000);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      sock.connect(row.port!, row.host!);
    });

    const latencyMs = Date.now() - start;
    if (ok) {
      const msg = `connected to ${row.host}:${row.port} in ${latencyMs}ms`;
      this.recordTestResult('success', msg);
      return { ok: true, message: msg, latencyMs };
    }
    const msg = `failed to connect to ${row.host}:${row.port} within 5s`;
    this.recordTestResult('failed', msg);
    return { ok: false, message: msg, latencyMs };
  }

  /** 用临时配置测连通性(不保存 DB),前端填完表即可测试 */
  async testWithConfig(cfg: {
    protocol: 'http' | 'https' | 'socks5' | null;
    host: string;
    port: number;
    username?: string;
    password?: string;
  }): Promise<boolean> {
    if (!cfg.protocol || !cfg.host || !cfg.port) return false;
    const net = await import('node:net');
    return new Promise<boolean>((resolve) => {
      const sock = new net.Socket();
      let settled = false;
      const finish = (v: boolean): void => {
        if (settled) return;
        settled = true;
        sock.destroy();
        resolve(v);
      };
      sock.setTimeout(5000);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      sock.connect(cfg.port, cfg.host);
    });
  }

  recordTestResult(status: 'success' | 'failed', message: string): void {
    const row = this.db.select().from(proxyConfigs).get() as ProxyConfigRow | undefined;
    if (!row) return;
    this.db
      .update(proxyConfigs)
      .set({
        testStatus: status,
        testMessage: message,
        updatedAt: Date.now(),
      })
      .where(eq(proxyConfigs.id, row.id))
      .run();
  }

  private toPublic(r: ProxyConfigRow): ProxyConfigPublic {
    let passwordHint: string | null = null;
    if (r.passwordEnc) {
      try {
        const pt = decryptSecret(r.passwordEnc, getMasterKey());
        passwordHint = pt ? `***${pt.slice(-4)}` : '***';
      } catch {
        passwordHint = '***';
      }
    }
    return {
      id: r.id,
      protocol: r.protocol,
      host: r.host,
      port: r.port,
      username: r.username,
      passwordHint,
      applyTo: r.applyTo,
      isActive: r.isActive,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
      testStatus: r.testStatus,
      testMessage: r.testMessage,
    };
  }
}
