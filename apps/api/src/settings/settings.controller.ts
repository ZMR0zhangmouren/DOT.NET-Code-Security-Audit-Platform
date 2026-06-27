import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

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
  create(@Req() req: Request, @Body() body: CreateDto): AiKeyPublic {
    // 优先从 JWT 拿 userId(header 兼容方式)
    const headerUser = req.headers['x-user-id'] as string | undefined;
    const userId =
      (req as Request & { user?: { sub?: string } }).user?.sub ?? headerUser ?? 'unknown';
    return this.settings.createAiKey({
      ...body,
      availableModels: body.availableModels ?? [],
      createdBy: userId,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateDto): AiKeyPublic {
    return this.settings.updateAiKey(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.settings.deleteAiKey(id);
    return { ok: true };
  }

  /**
   * 测试连接 —— 真正调 /v1/models 验证 key + base_url 正确性
   * 返回 {ok, message, latencyMs}
   */
  @Post(':id/test')
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
}
