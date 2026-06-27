import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ProjectsService, type ProjectPublic } from './projects.service.js'; // ProjectsService 需运行时引用(NestJS DI)

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
}
