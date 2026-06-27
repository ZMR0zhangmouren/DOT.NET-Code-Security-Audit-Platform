import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { decryptSecret, encryptSecret, getMasterKey } from '../common/crypto.util.js';
import { DATABASE, type Db } from '../db/database.module.js';
import { aiKeys } from '../db/schema.js';

export interface AiKeyPublic {
  id: string;
  provider: 'openai' | 'anthropic' | 'deepseek' | 'minimax' | 'custom';
  label: string;
  baseUrl: string;
  defaultModel: string;
  isActive: boolean;
  availableModels: string[];
  lastTestAt: number | null;
  lastTestStatus: 'unknown' | 'success' | 'failed';
  lastTestMessage: string | null;
  apiKeyHint: string; // 仅显示后 4 位
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface AiKeyRow {
  id: string;
  provider: 'openai' | 'anthropic' | 'deepseek' | 'minimax' | 'custom';
  label: string;
  baseUrl: string;
  apiKeyEnc: string;
  defaultModel: string;
  isActive: boolean;
  availableModels: string[];
  lastTestAt: number | null;
  lastTestStatus: 'unknown' | 'success' | 'failed';
  lastTestMessage: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class SettingsService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  listAiKeys(): AiKeyPublic[] {
    const rows = this.db.select().from(aiKeys).all() as unknown as AiKeyRow[];
    return rows.map((r) => this.toPublic(r));
  }

  getAiKey(id: string): AiKeyPublic {
    const row = this.db.select().from(aiKeys).where(eq(aiKeys.id, id)).get() as
      | AiKeyRow
      | undefined;
    if (!row) throw new NotFoundException(`AI key ${id} not found`);
    return this.toPublic(row);
  }

  /** 解密后的明文 Key(供内部调用,不要暴露给前端) */
  getAiKeyPlaintext(id: string): string {
    const row = this.db.select().from(aiKeys).where(eq(aiKeys.id, id)).get() as
      | AiKeyRow
      | undefined;
    if (!row) throw new NotFoundException(`AI key ${id} not found`);
    return decryptSecret(row.apiKeyEnc, getMasterKey());
  }

  createAiKey(input: {
    provider: AiKeyRow['provider'];
    label: string;
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
    availableModels: string[];
    createdBy: string;
  }): AiKeyPublic {
    const id = `aik-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const enc = encryptSecret(input.apiKey, getMasterKey());
    const now = Date.now();
    this.db
      .insert(aiKeys)
      .values({
        id,
        provider: input.provider,
        label: input.label,
        baseUrl: input.baseUrl,
        apiKeyEnc: enc,
        defaultModel: input.defaultModel,
        isActive: true,
        availableModels: input.availableModels,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.getAiKey(id);
  }

  updateAiKey(
    id: string,
    patch: Partial<{
      label: string;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
      isActive: boolean;
      availableModels: string[];
    }>,
  ): AiKeyPublic {
    const existing = this.db.select().from(aiKeys).where(eq(aiKeys.id, id)).get() as
      | AiKeyRow
      | undefined;
    if (!existing) throw new NotFoundException(`AI key ${id} not found`);

    const update: Partial<AiKeyRow> & { updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (patch.label !== undefined) update.label = patch.label;
    if (patch.baseUrl !== undefined) update.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) update.apiKeyEnc = encryptSecret(patch.apiKey, getMasterKey());
    if (patch.defaultModel !== undefined) update.defaultModel = patch.defaultModel;
    if (patch.isActive !== undefined) update.isActive = patch.isActive;
    if (patch.availableModels !== undefined) update.availableModels = patch.availableModels;

    this.db.update(aiKeys).set(update).where(eq(aiKeys.id, id)).run();
    return this.getAiKey(id);
  }

  deleteAiKey(id: string): void {
    const result = this.db.delete(aiKeys).where(eq(aiKeys.id, id)).run();
    if (result.changes === 0) throw new NotFoundException(`AI key ${id} not found`);
  }

  recordTestResult(id: string, status: 'success' | 'failed', message: string): void {
    this.db
      .update(aiKeys)
      .set({
        lastTestAt: Date.now(),
        lastTestStatus: status,
        lastTestMessage: message,
        updatedAt: Date.now(),
      })
      .where(eq(aiKeys.id, id))
      .run();
  }

  private toPublic(r: AiKeyRow): AiKeyPublic {
    let plaintext: string;
    try {
      plaintext = decryptSecret(r.apiKeyEnc, getMasterKey());
    } catch {
      plaintext = '';
    }
    const hint = plaintext ? `***${plaintext.slice(-4)}` : '***';
    return {
      id: r.id,
      provider: r.provider,
      label: r.label,
      baseUrl: r.baseUrl,
      defaultModel: r.defaultModel,
      isActive: r.isActive,
      availableModels: r.availableModels,
      lastTestAt: r.lastTestAt,
      lastTestStatus: r.lastTestStatus,
      lastTestMessage: r.lastTestMessage,
      apiKeyHint: hint,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

// 延迟 import 避开 ESM cycle(crypto.util.ts 也要用)
import { randomBytes } from 'node:crypto';
