import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';

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
 * 鉴权:GET 任何已登录用户(不返回 secret);
 *      POST / PATCH / DELETE 仅 admin(JwtAuthGuard + RolesGuard('admin'))
 */
@Controller('admin/git-credentials')
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @Roles('admin')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateDto): GitCredentialPublic {
    const createdBy = user?.sub ?? 'unknown';
    return this.git.create({ ...body, createdBy });
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: UpdateDto): GitCredentialPublic {
    return this.git.update(id, body);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string): { ok: true } {
    this.git.revoke(id);
    return { ok: true };
  }
}
