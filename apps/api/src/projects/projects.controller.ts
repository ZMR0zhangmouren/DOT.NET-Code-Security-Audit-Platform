import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  ProjectsService,
  type ProjectMemberPublic,
  type ProjectMemberRole,
  type ProjectPublic,
} from './projects.service.js'; // ProjectsService 需运行时引用(NestJS DI,import type 会让 ESM 擦除导致 DI 找不到)

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
 *
 * 鉴权(JwtAuthGuard 已在 controller 级开启):
 * - GET 公开读(MVP 简化,Phase 2 加 ProjectMember 可见性过滤)
 * - create / update / remove / members 操作要求登录;
 *   members 端点的 owner / lead 权限由 service.assertCanManage 二次校验
 */
@Controller('projects')
@UseGuards(JwtAuthGuard)
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
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateDto): ProjectPublic {
    const ownerId = user?.sub ?? 'unknown';
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
  // 鉴权:JwtAuthGuard(controller 级)+ service.assertCanManage(owner / lead)
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
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: GrantMemberDto,
  ): ProjectMemberPublic {
    const grantedBy = user?.sub ?? 'unknown';
    return this.projects.grantMember(id, body.username, body.projectRole, grantedBy);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateMemberDto,
  ): ProjectMemberPublic {
    const actingUserId = user?.sub ?? 'unknown';
    return this.projects.updateMemberRole(id, userId, body.projectRole, actingUserId);
  }

  @Delete(':id/members/:userId')
  revokeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): { ok: true } {
    const actingUserId = user?.sub ?? 'unknown';
    this.projects.revokeMember(id, userId, actingUserId);
    return { ok: true };
  }
}

// suppress unused (kept to align with original import surface)
void Req;
void Request;
