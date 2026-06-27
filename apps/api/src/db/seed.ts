/**
 * Seed 脚本 —— 创建默认 admin 用户(MVP 起步用)
 *
 * 用法:`pnpm --filter @platform/api seed`
 *
 * 默认账号:
 *   username: admin
 *   password: admin123        (argon2id hash 落 SQLite;首次运行打印)
 *   role:     admin
 *
 * §6.2 要求首次登录后必须改密码(留 Phase 2 接).
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import * as argon2 from 'argon2';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { users } from './schema.js';

const DEFAULT_ADMIN = {
  id: 'usr-admin-default',
  username: 'admin',
  email: 'admin@localhost',
  displayName: 'Default Admin',
  role: 'admin' as const,
  password: 'admin123',
};

async function main(): Promise<void> {
  const raw = process.env['DATABASE_URL'] ?? './storage/dev.sqlite';
  const file = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  const absPath = resolve(process.cwd(), file);
  mkdirSync(dirname(absPath), { recursive: true });

  const sqlite = new Database(absPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);

  const existing = db.select().from(users).where(eq(users.username, DEFAULT_ADMIN.username)).all();
  if (existing.length > 0) {
    console.info(`[seed] user "${DEFAULT_ADMIN.username}" 已存在,跳过创建 (id=${existing[0]?.id})`);
    sqlite.close();
    return;
  }

  const passwordHash = await argon2.hash(DEFAULT_ADMIN.password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const now = Date.now();
  db.insert(users)
    .values({
      id: DEFAULT_ADMIN.id,
      username: DEFAULT_ADMIN.username,
      email: DEFAULT_ADMIN.email,
      displayName: DEFAULT_ADMIN.displayName,
      passwordHash,
      role: DEFAULT_ADMIN.role,
      isActive: true,
      createdAt: now,
    })
    .run();

  console.info('[seed] ✅ 默认 admin 用户已创建');
  console.info('  username: admin');
  console.info('  password: admin123');
  console.info('  ⚠️  §6.2 要求首次登录后改密码,留 Phase 2 接');
  sqlite.close();
}

void main().catch((e: Error) => {
  console.error('[seed] 失败:', e.message);
  process.exit(1);
});
