import { randomBytes } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, like, or, type SQL } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import {
  projectMembers,
  projects,
  users,
  type Visibility,
  type ProjectStatus,
} from '../db/schema.js';

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

// §4.2.8 ProjectMember
export type ProjectMemberRole = 'lead' | 'contributor' | 'viewer';

export interface ProjectMemberPublic {
  userId: string;
  username: string;
  email: string;
  displayName: string | null;
  projectRole: ProjectMemberRole;
  grantedBy: string;
  grantedAt: number;
}

interface ProjectMemberRow {
  projectId: string;
  userId: string;
  projectRole: ProjectMemberRole;
  grantedBy: string;
  grantedAt: number;
}

interface UserPublicRow {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
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

  // ──────────────────────────────────────────────────────────────────────
  // §4.2.8 ProjectMember 管理
  //
  // MVP 权限:只有 project owner 或 project lead 才能 grant / update / revoke
  // 其他已登录用户都能 GET(只是看;权限收紧 Phase 2 接)
  // 鉴权由 controller 注入 grantedBy / actingUserId;
  // 这里不读 x-user-id,保证 service 单元测试不依赖 req
  // ──────────────────────────────────────────────────────────────────────

  listMembers(projectId: string): ProjectMemberPublic[] {
    // 确保项目存在
    this.get(projectId);

    const rows = this.db
      .select({
        userId: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        projectRole: projectMembers.projectRole,
        grantedBy: projectMembers.grantedBy,
        grantedAt: projectMembers.grantedAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.grantedAt))
      .all() as unknown as (ProjectMemberRow & UserPublicRow)[];

    return rows.map((r) => ({
      userId: r.userId,
      username: r.username,
      email: r.email,
      displayName: r.displayName,
      projectRole: r.projectRole,
      grantedBy: r.grantedBy,
      grantedAt: r.grantedAt,
    }));
  }

  grantMember(
    projectId: string,
    username: string,
    role: ProjectMemberRole,
    grantedBy: string,
  ): ProjectMemberPublic {
    this.assertCanManage(projectId, grantedBy);

    // 找目标用户
    const target = this.db.select().from(users).where(eq(users.username, username)).get() as
      | UserPublicRow
      | undefined;
    if (!target) throw new NotFoundException(`user "${username}" not found`);

    // 已存在则冲突
    const existing = this.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, target.id)))
      .get() as ProjectMemberRow | undefined;
    if (existing) {
      throw new ConflictException(`user "${username}" is already a member of project ${projectId}`);
    }

    const now = Date.now();
    this.db
      .insert(projectMembers)
      .values({
        projectId,
        userId: target.id,
        projectRole: role,
        grantedBy,
        grantedAt: now,
      })
      .run();

    return {
      userId: target.id,
      username: target.username,
      email: target.email,
      displayName: target.displayName,
      projectRole: role,
      grantedBy,
      grantedAt: now,
    };
  }

  updateMemberRole(
    projectId: string,
    userId: string,
    role: ProjectMemberRole,
    actingUserId: string,
  ): ProjectMemberPublic {
    this.assertCanManage(projectId, actingUserId);

    const existing = this.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .get() as ProjectMemberRow | undefined;
    if (!existing) {
      throw new NotFoundException(`member userId=${userId} not found in project ${projectId}`);
    }

    this.db
      .update(projectMembers)
      .set({ projectRole: role })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .run();

    // 返回最新投影
    const target = this.db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .get() as UserPublicRow | undefined;

    return {
      userId,
      username: target?.username ?? '',
      email: target?.email ?? '',
      displayName: target?.displayName ?? null,
      projectRole: role,
      grantedBy: existing.grantedBy,
      grantedAt: existing.grantedAt,
    };
  }

  revokeMember(projectId: string, userId: string, actingUserId: string): void {
    this.assertCanManage(projectId, actingUserId);

    const result = this.db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .run();
    if (result.changes === 0) {
      throw new NotFoundException(`member userId=${userId} not found in project ${projectId}`);
    }
  }

  /**
   * 权限断言:只有 project owner 或 project lead 才能 grant/update/revoke
   * MVP 简化:用 user.id 字面量比对(认证层 Phase 2 接)
   */
  private assertCanManage(projectId: string, actingUserId: string): void {
    const project = this.db.select().from(projects).where(eq(projects.id, projectId)).get() as
      | ProjectRow
      | undefined;
    if (!project) throw new NotFoundException(`project ${projectId} not found`);
    if (project.ownerId === actingUserId) return;

    const memberRow = this.db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, actingUserId),
          eq(projectMembers.projectRole, 'lead'),
        ),
      )
      .get() as ProjectMemberRow | undefined;
    if (!memberRow) {
      throw new ForbiddenException(
        `only project owner or lead can manage members; acting=${actingUserId}`,
      );
    }
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
