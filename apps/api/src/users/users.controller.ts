import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService, type UserPublic, type UserRole } from './users.service.js'; // UsersService 需运行时引用(NestJS DI)

interface CreateDto {
  username: string;
  email: string;
  password: string;
  displayName?: string;
  role: UserRole;
}

interface UpdateDto {
  email?: string;
  displayName?: string;
  role?: UserRole;
  isActive?: boolean;
}

/**
 * §4.2.7 + §5.7 用户管理 —— admin only(JwtAuthGuard + RolesGuard('admin'))
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): UserPublic[] {
    return this.users.list();
  }

  @Get(':id')
  get(@Param('id') id: string): UserPublic {
    return this.users.get(id);
  }

  @Post()
  async create(@Body() body: CreateDto): Promise<UserPublic> {
    return this.users.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateDto): UserPublic {
    return this.users.update(id, body);
  }

  @Patch(':id/password')
  async resetPassword(
    @Param('id') id: string,
    @Body() body: { password: string },
  ): Promise<{ ok: true }> {
    await this.users.updatePassword(id, body.password);
    return { ok: true };
  }
}
