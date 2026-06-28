import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GitCredentialsService, type GitCredentialPublic } from './git-credentials.service.js'; // GitCredentialsService 需运行时引用(NestJS DI)

interface CreateDto {
  scope: 'system' | 'project';
  projectId?: string | null;
  label: string;
  kind: 'ssh_key' | 'https_token';
  hostPattern: string;
  username?: string | null;
  secret: string;
  isActive?: boolean;
}

interface UpdateDto {
  label?: string;
  hostPattern?: string;
  username?: string | null;
  secret?: string; // 空字符串表示不改
  isActive?: boolean;
}

/**
 * §5.7 Git Credentials 管理端点。
 *
 * MVP 沿用 aiKeys 的权限策略:任何人可读(不返回 secret),仅 admin 可写。
 * Phase 2 接 AdminGuard 拦截非 admin 写入。
 */
@Controller('admin/git-credentials')
export class GitCredentialsController {
  constructor(private readonly git: GitCredentialsService) {}

  @Get()
  list(
    @Query('scope') scope?: 'system' | 'project',
    @Query('projectId') projectId?: string,
  ): GitCredentialPublic[] {
    return this.git.list(scope, projectId);
  }

  @Get(':id')
  get(@Param('id') id: string): GitCredentialPublic {
    return this.git.get(id);
  }

  @Post()
  create(@Req() req: Request, @Body() body: CreateDto): GitCredentialPublic {
    const headerUser = req.headers['x-user-id'] as string | undefined;
    const userId =
      (req as Request & { user?: { sub?: string } }).user?.sub ?? headerUser ?? 'unknown';
    return this.git.create({ ...body, createdBy: userId });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateDto): GitCredentialPublic {
    return this.git.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.git.revoke(id);
    return { ok: true };
  }
}
