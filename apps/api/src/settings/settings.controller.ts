import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService, type AiKeyPublic } from './settings.service.js'; // SettingsService 需运行时引用(NestJS DI)

/**
 * §5.7 系统配置 —— AI Key CRUD
 *
 * MVP 仅 admin 可写;任何人可读(只暴露后 4 位,不含明文)
 * Phase 2:加 AdminGuard、限流、审计日志
 */
@Controller('settings/ai-keys')
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
  create(
    @Req() req: Request,
    @Body()
    body: {
      provider: AiKeyPublic['provider'];
      label: string;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
      availableModels: string[];
    },
  ): AiKeyPublic {
    const createdBy = (req.headers['x-user-id'] as string) ?? 'unknown';
    return this.settings.createAiKey({
      ...body,
      availableModels: body.availableModels ?? [],
      createdBy,
    });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      label: string;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
      isActive: boolean;
      availableModels: string[];
    }>,
  ): AiKeyPublic {
    return this.settings.updateAiKey(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.settings.deleteAiKey(id);
    return { ok: true };
  }
}
