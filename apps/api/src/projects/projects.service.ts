import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, like, or, type SQL } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { projects, type Visibility, type ProjectStatus } from '../db/schema.js';

export interface ProjectPublic {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: Visibility;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: Visibility;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  list(opts: { q?: string; status?: ProjectStatus } = {}): ProjectPublic[] {
    const filters: SQL[] = [];
    if (opts.status) {
      filters.push(eq(projects.status, opts.status));
    }
    if (opts.q && opts.q.trim()) {
      const like_ = `%${opts.q.trim()}%`;
      filters.push(or(like(projects.name, like_), like(projects.description, like_)) as SQL);
    }
    // drizzle 0.45 的 where 不接受 undefined;有过滤就 and,没有就用 eq(1,1) 占位
    const where = (filters.length > 0 ? and(...filters) : eq(projects.id, projects.id)) as SQL;
    const rows = this.db
      .select()
      .from(projects)
      .where(where)
      .orderBy(desc(projects.createdAt))
      .all() as unknown as ProjectRow[];
    return rows.map((r) => this.toPublic(r));
  }

  get(id: string): ProjectPublic {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get() as
      | ProjectRow
      | undefined;
    if (!row) throw new NotFoundException(`project ${id} not found`);
    return this.toPublic(row);
  }

  create(input: {
    name: string;
    description?: string;
    ownerId: string;
    visibility?: Visibility;
  }): ProjectPublic {
    const id = `prj-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const now = Date.now();
    this.db
      .insert(projects)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        ownerId: input.ownerId,
        visibility: input.visibility ?? 'private',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.get(id);
  }

  update(
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      visibility: Visibility;
      status: ProjectStatus;
    }>,
  ): ProjectPublic {
    const existing = this.db.select().from(projects).where(eq(projects.id, id)).get() as
      | ProjectRow
      | undefined;
    if (!existing) throw new NotFoundException(`project ${id} not found`);

    const update: Partial<ProjectRow> & { updatedAt: number } = { updatedAt: Date.now() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.visibility !== undefined) update.visibility = patch.visibility;
    if (patch.status !== undefined) update.status = patch.status;

    this.db.update(projects).set(update).where(eq(projects.id, id)).run();
    return this.get(id);
  }

  remove(id: string): void {
    const result = this.db.delete(projects).where(eq(projects.id, id)).run();
    if (result.changes === 0) throw new NotFoundException(`project ${id} not found`);
  }

  private toPublic(r: ProjectRow): ProjectPublic {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      ownerId: r.ownerId,
      visibility: r.visibility,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

import { randomBytes } from 'node:crypto';
