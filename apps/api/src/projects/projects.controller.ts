import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  ProjectsService,
  type ProjectMemberPublic,
  type ProjectMemberRole,
  type ProjectPublic,
} from './projects.service.js'; // ProjectsService 需运行时引用(NestJS DI)

interface CreateDto {
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
}

interface UpdateDto {
  name?: string;
  description?: string;
  visibility?: 'public' | 'private';
  status?: 'active' | 'archived';
}

interface GrantMemberDto {
  username: string;
  projectRole: ProjectMemberRole;
}

interface UpdateMemberDto {
  projectRole: ProjectMemberRole;
}

/**
 * §5.1 项目管理 —— CRUD
 * MVP 任何已登录用户都能建项目(简化);Phase 2 接入 ProjectMember 做角色权限。
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Query('q') q?: string, @Query('status') status?: 'active' | 'archived'): ProjectPublic[] {
    return this.projects.list({ q, status });
  }

  @Get(':id')
  get(@Param('id') id: string): ProjectPublic {
    return this.projects.get(id);
  }

  @Post()
  create(@Req() req: Request, @Body() body: CreateDto): ProjectPublic {
    const ownerId = (req.headers['x-user-id'] as string) ?? 'unknown';
    return this.projects.create({
      name: body.name,
      description: body.description,
      ownerId,
      visibility: body.visibility,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateDto): ProjectPublic {
    return this.projects.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.projects.remove(id);
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────────────────
  // §4.2.8 ProjectMember 管理 —— 4 个端点
  //
  // 鉴权:从 x-user-id 头取 acting user(与 projects.create 一致);
  // GET 不做权限校验(任何已登录用户能看,Phase 2 收紧);
  // grant / update / revoke 由 service 内部 assertCanManage 检查 owner 或 lead
  // ──────────────────────────────────────────────────────────────────────

  @Get(':id/members')
  listMembers(@Param('id') id: string): ProjectMemberPublic[] {
    return this.projects.listMembers(id);
  }

  @Post(':id/members')
  grantMember(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: GrantMemberDto,
  ): ProjectMemberPublic {
    const grantedBy = (req.headers['x-user-id'] as string | undefined) ?? 'unknown';
    return this.projects.grantMember(id, body.username, body.projectRole, grantedBy);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: Request,
    @Body() body: UpdateMemberDto,
  ): ProjectMemberPublic {
    const actingUserId = (req.headers['x-user-id'] as string | undefined) ?? 'unknown';
    return this.projects.updateMemberRole(id, userId, body.projectRole, actingUserId);
  }

  @Delete(':id/members/:userId')
  revokeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: Request,
  ): { ok: true } {
    const actingUserId = (req.headers['x-user-id'] as string | undefined) ?? 'unknown';
    this.projects.revokeMember(id, userId, actingUserId);
    return { ok: true };
  }
}
