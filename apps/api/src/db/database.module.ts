import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Module, type OnModuleInit, type OnModuleDestroy, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';

export const DATABASE = Symbol('DATABASE');

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * 全局 DatabaseModule —— 启动时打开 SQLite,关闭时释放
 *
 * 配置来源:process.env.DATABASE_URL(去掉 file: 前缀,对应 SQLite 文件路径)
 * Phase 4 切 Postgres 时只需替换 BetterSQLite3Database 实现。
 */
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): Db => {
        const raw = process.env['DATABASE_URL'] ?? './storage/dev.sqlite';
        const file = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
        const absPath = resolve(process.cwd(), file);
        mkdirSync(dirname(absPath), { recursive: true });
        const sqlite = new Database(absPath);
        sqlite.pragma('journal_mode = WAL');
        sqlite.pragma('foreign_keys = ON');
        return drizzle(sqlite, { schema });
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  onModuleInit(): void {
    // 启动期 sanity:能 SELECT 1,DB 可用
    const result = this.db.all<{ ok: number }>(/* sql */ `SELECT 1 as ok`);
    if (!result[0] || result[0].ok !== 1) {
      throw new Error('DatabaseModule: SQLite sanity check failed');
    }
  }

  onModuleDestroy(): void {
    // drizzle-orm/better-sqlite3 在 close 时通过 underlying SQLite handle 释放
    // 这里无需手动调用,Node 进程退出时 better-sqlite3 会自行清理
  }
}
