import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

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
 * §4.2.7 + §5.7 用户管理 —— MVP 仅 admin 可调
 * Phase 2 接 AdminGuard;目前先按 controller 层信任 x-user-id(预留 admin 校验位)
 */
@Controller('users')
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
