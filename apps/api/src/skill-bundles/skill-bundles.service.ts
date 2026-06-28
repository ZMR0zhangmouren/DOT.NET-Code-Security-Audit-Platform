import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { skillBundleVersions } from '../db/schema.js';

export interface SkillBundleVersionPublic {
  id: string;
  version: string;
  gitCommit: string;
  snapshotPath: string;
  isActive: boolean;
  isDefault: boolean;
  publishedAt: number | null;
  note: string | null;
  createdAt: number;
}

/**
 * §11 Q7 双轨 C —— SkillBundleVersion 只读 + 默认标记管理
 *
 * - listAll() / listActive() / getById() —— 只读查询
 * - getDefault() —— 拿当前默认 bundle
 * - setDefault(id) —— 事务里把其他 is_default=false,目标 =true
 * - publish(id, note) —— 把一条 bundle 标 is_active=true + published_at=now
 */
@Injectable()
export class SkillBundlesService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /** 全部 bundle(is_default=true 排前面,其余按 created_at DESC) */
  listAll(): SkillBundleVersionPublic[] {
    const rows = this.db
      .select()
      .from(skillBundleVersions)
      .orderBy(
        desc(sql`CASE WHEN ${skillBundleVersions.isDefault} = 1 THEN 1 ELSE 0 END`),
        desc(skillBundleVersions.createdAt),
      )
      .all();
    return rows.map((r) => this.toPublic(r));
  }

  /** active bundle —— is_default=true 排前面 */
  listActive(): SkillBundleVersionPublic[] {
    const rows = this.db
      .select()
      .from(skillBundleVersions)
      .where(eq(skillBundleVersions.isActive, true))
      .orderBy(
        desc(sql`CASE WHEN ${skillBundleVersions.isDefault} = 1 THEN 1 ELSE 0 END`),
        desc(skillBundleVersions.createdAt),
      )
      .all();
    return rows.map((r) => this.toPublic(r));
  }

  /**
   * 兼容老接口:list({ activeOnly }) —— 内部转 listAll / listActive。
   * Controller 还在用,保留。
   */
  list(opts: { activeOnly?: boolean } = {}): SkillBundleVersionPublic[] {
    return opts.activeOnly ? this.listActive() : this.listAll();
  }

  /** 查单个 */
  getById(id: string): SkillBundleVersionPublic | null {
    const row = this.db
      .select()
      .from(skillBundleVersions)
      .where(eq(skillBundleVersions.id, id))
      .get();
    if (!row) return null;
    return this.toPublic(row);
  }

  /** 兼容老接口命名(老代码可能用 get) */
  get(id: string): SkillBundleVersionPublic | null {
    return this.getById(id);
  }

  /** 拿当前默认 bundle(is_default=true 的第一个) */
  getDefault(): SkillBundleVersionPublic | null {
    const row = this.db
      .select()
      .from(skillBundleVersions)
      .where(eq(skillBundleVersions.isDefault, true))
      .orderBy(desc(skillBundleVersions.createdAt))
      .get();
    if (!row) return null;
    return this.toPublic(row);
  }

  /**
   * §11 Q7 —— 事务里把其他 bundle 的 is_default = false,目标 is_default = true。
   * 原子操作:用 BEGIN/COMMIT 包住,失败回滚。
   */
  setDefault(id: string): SkillBundleVersionPublic {
    const existing = this.getById(id);
    if (!existing) throw new NotFoundException(`skillBundle ${id} not found`);

    this.db.transaction((tx) => {
      tx.update(skillBundleVersions).set({ isDefault: false }).run();
      tx.update(skillBundleVersions)
        .set({ isDefault: true })
        .where(eq(skillBundleVersions.id, id))
        .run();
    });

    const after = this.getById(id);
    if (!after) throw new NotFoundException(`skillBundle ${id} not found after setDefault`);
    return after;
  }

  /**
   * §11 Q7 —— publish 一条新 bundle
   *
   * - 设 is_active = true
   * - 设 published_at = now
   * - 不动 is_default(默认切换是显式 setDefault 动作,避免 publish 自动改默认)
   *
   * 返回 publish 后的 row。
   */
  publish(id: string, note: string | null = null): SkillBundleVersionPublic {
    const existing = this.getById(id);
    if (!existing) throw new NotFoundException(`skillBundle ${id} not found`);

    const now = Date.now();
    this.db
      .update(skillBundleVersions)
      .set({ isActive: true, publishedAt: now, note: note ?? existing.note })
      .where(eq(skillBundleVersions.id, id))
      .run();

    const after = this.getById(id);
    if (!after) throw new NotFoundException(`skillBundle ${id} not found after publish`);
    return after;
  }

  // ──────────────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────────────

  private toPublic(r: typeof skillBundleVersions.$inferSelect): SkillBundleVersionPublic {
    return {
      id: r.id,
      version: r.version,
      gitCommit: r.gitCommit,
      snapshotPath: r.snapshotPath,
      isActive: r.isActive,
      isDefault: r.isDefault,
      publishedAt: r.publishedAt,
      note: r.note,
      createdAt: r.createdAt,
    };
  }
}
