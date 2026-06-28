import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService, type AiKeyPublic } from './settings.service.js'; // SettingsService 需运行时引用(NestJS DI)

interface CreateDto {
  provider: AiKeyPublic['provider'];
  label: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  availableModels: string[];
}

interface UpdateDto {
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  isActive?: boolean;
  availableModels?: string[];
}

/**
 * §5.7 系统配置 —— AI Key CRUD
 *
 * 鉴权:
 * - GET 任何已登录用户(只暴露后 4 位,不含明文)
 * - POST / PATCH / DELETE / test / models 仅 admin(JwtAuthGuard + RolesGuard)
 */
@Controller('settings/ai-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(): AiKeyPublic[] {
    return this.settings.listAiKeys();
  }

  @Get(':id')
  get(@Param('id') id: string): AiKeyPublic {
    return this.settings.getAiKey(id);
  }

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateDto): AiKeyPublic {
    const createdBy = user?.sub ?? 'unknown';
    return this.settings.createAiKey({
      ...body,
      availableModels: body.availableModels ?? [],
      createdBy,
    });
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: UpdateDto): AiKeyPublic {
    return this.settings.updateAiKey(id, body);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string): { ok: true } {
    this.settings.deleteAiKey(id);
    return { ok: true };
  }

  /**
   * 测试连接 —— 调 /v1/models 验证 key + base_url
   */
  @Post(':id/test')
  @Roles('admin')
  async testConnection(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const aiKey = this.settings.getAiKey(id);
      const plaintext = this.settings.getAiKeyPlaintext(id);
      const { listModelsVia } = await import('./openai-test.client.js');
      const models = await listModelsVia(plaintext, aiKey.baseUrl);
      this.settings.recordTestResult(id, 'success', `${models.length} models available`);
      return {
        ok: true,
        message: `Connected. ${models.length} models available.`,
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      const msg = (e as Error).message;
      this.settings.recordTestResult(id, 'failed', msg);
      return { ok: false, message: msg, latencyMs: Date.now() - start };
    }
  }

  /**
   * 探测可用模型 —— 调 /v1/models 返回模型 id 列表(不保存,仅临时返回)
   */
  @Post(':id/models')
  @Roles('admin')
  async listModels(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; models: string[]; message?: string }> {
    try {
      const aiKey = this.settings.getAiKey(id);
      const plaintext = this.settings.getAiKeyPlaintext(id);
      const { listModelsVia } = await import('./openai-test.client.js');
      const models = await listModelsVia(plaintext, aiKey.baseUrl);
      return { ok: true, models };
    } catch (e) {
      return { ok: false, models: [], message: (e as Error).message };
    }
  }
}
