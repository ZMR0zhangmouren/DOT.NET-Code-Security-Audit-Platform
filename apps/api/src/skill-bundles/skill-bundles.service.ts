import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { skillBundleVersions } from '../db/schema.js';

export interface SkillBundleVersionPublic {
  id: string;
  version: string;
  gitCommit: string;
  snapshotPath: string;
  isActive: boolean;
  note: string | null;
  createdAt: number;
}

@Injectable()
export class SkillBundlesService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  list(opts: { activeOnly?: boolean } = {}): SkillBundleVersionPublic[] {
    const where = opts.activeOnly ? eq(skillBundleVersions.isActive, true) : undefined;
    const rows = this.db
      .select()
      .from(skillBundleVersions)
      .where(where as never)
      .orderBy(desc(skillBundleVersions.createdAt))
      .all();
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      gitCommit: r.gitCommit,
      snapshotPath: r.snapshotPath,
      isActive: r.isActive,
      note: r.note,
      createdAt: r.createdAt,
    }));
  }

  get(id: string): SkillBundleVersionPublic | null {
    const row = this.db
      .select()
      .from(skillBundleVersions)
      .where(eq(skillBundleVersions.id, id))
      .get();
    if (!row) return null;
    return {
      id: row.id,
      version: row.version,
      gitCommit: row.gitCommit,
      snapshotPath: row.snapshotPath,
      isActive: row.isActive,
      note: row.note,
      createdAt: row.createdAt,
    };
  }
}
