#!/bin/sh
# =============================================================
#  API container entrypoint
#  - 确保 storage 目录存在(SQLite 落盘 + ScanRun 产物 + 上传)
#  - 应用 Drizzle SQL 迁移(简单 .sql 拆分执行,不依赖 drizzle-kit)
#  - 若 admin 用户不存在,跑一次 seed 创建默认账号
#  - exec node 把 PID 1 交给 nest,信号(sigterm)能正常转发
# =============================================================
set -eu

# 默认路径(DATABASE_URL 未设时)
DEFAULT_DB_PATH="./storage/dev.sqlite"
RAW_DB_URL="${DATABASE_URL:-$DEFAULT_DB_PATH}"
DB_FILE="${RAW_DB_URL#file:}"

# 1) storage 目录
mkdir -p "$(dirname "$DB_FILE")"
mkdir -p "./storage/scan-runs" "./storage/code-versions" "./storage/reports"

# 2) 应用迁移(只对新库执行;已有库通过 __migrations 表跳过)
MIGRATIONS_DIR="./dist/db/migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
  node -e "
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const path = require('path');
    const dbFile = process.argv[1];
    const migDir = process.argv[2];
    const db = new Database(dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(\`CREATE TABLE IF NOT EXISTS __migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );\`);
    const applied = new Set(db.prepare('SELECT id FROM __migrations').all().map(r => r.id));
    const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
    let count = 0;
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
      // drizzle-kit 的 sql 里有 --> statement-breakpoint 标记,要拆成多个语句
      const stmts = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
      const tx = db.transaction(() => {
        for (const s of stmts) db.exec(s);
        db.prepare('INSERT INTO __migrations (id, applied_at) VALUES (?, ?)').run(f, Date.now());
      });
      tx();
      count++;
      console.log('[migrate] applied ' + f);
    }
    if (count === 0) console.log('[migrate] up-to-date (' + applied.size + ' already applied)');
    else console.log('[migrate] done, ' + count + ' new migration(s) applied');
    db.close();
  " "$DB_FILE" "$MIGRATIONS_DIR"
else
  echo "[migrate] WARNING: migrations dir not found at $MIGRATIONS_DIR, skipping"
fi

# 3) 种子默认 admin(已有则跳过,seed 自身幂等)
# seed 脚本是 tsx 跑 ts 的,容器里没 tsx;改用 node 直接 require dist/db/seed.js
SEED_JS="./dist/db/seed.js"
if [ -f "$SEED_JS" ]; then
  # 通过子进程跑 seed,允许失败但要日志;seed.js 应该已经 idempotent
  # 由于 seed.js 是 ESM-compiled (TS 编译后) —— 直接 require
  node "$SEED_JS" || echo "[seed] WARNING: seed failed (continuing)"
else
  echo "[seed] WARNING: $SEED_JS not found, skipping seed"
fi

# 4) 把 CMD 启动
echo "[api] starting: $@"
exec "$@"
