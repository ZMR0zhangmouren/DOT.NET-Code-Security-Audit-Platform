import { randomBytes } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { agentTraces } from '../db/schema.js';

/**
 * Phase 3 §1.2/2.7 — 主 Agent Trace 持久化服务
 *
 * 写入方: ScanRunnerService 在主循环每次 OpenAI response / tool call / tool response
 *        调 recordTrace;traceIndex 由调用方保证单调递增。
 * 读取方: AgentTracesController 暴露给前端 TracePage,用于审计 / 复现 / 调试。
 */

export type AgentTraceRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentTracePublic {
  id: string;
  scanRunId: string;
  traceIndex: number;
  role: AgentTraceRole;
  content: string | null;
  toolCalls: Array<Record<string, unknown>> | null;
  toolCallId: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string | null;
  createdAt: number;
}

export interface RecordTraceInput {
  scanRunId: string;
  traceIndex: number;
  role: AgentTraceRole;
  content?: string | null;
  toolCalls?: Array<Record<string, unknown>> | null;
  toolCallId?: string | null;
  finishReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  model?: string | null;
}

export interface AgentTraceSummary {
  scanRunId: string;
  total: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  model: string | null;
}

@Injectable()
export class AgentTracesService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * 写入一条 trace。
   * id 由 service 内部生成(基于当前时间戳 + 随机后缀);
   * createdAt 用 Date.now() —— 主循环里的写入频率很低,不需要更精细的排序。
   */
  recordTrace(input: RecordTraceInput): AgentTracePublic {
    const id = `at-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const now = Date.now();
    this.db
      .insert(agentTraces)
      .values({
        id,
        scanRunId: input.scanRunId,
        traceIndex: input.traceIndex,
        role: input.role,
        content: input.content ?? null,
        toolCalls: input.toolCalls ?? null,
        toolCallId: input.toolCallId ?? null,
        finishReason: input.finishReason ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        model: input.model ?? null,
        createdAt: now,
      })
      .run();
    return {
      id,
      scanRunId: input.scanRunId,
      traceIndex: input.traceIndex,
      role: input.role,
      content: input.content ?? null,
      toolCalls: input.toolCalls ?? null,
      toolCallId: input.toolCallId ?? null,
      finishReason: input.finishReason ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      model: input.model ?? null,
      createdAt: now,
    };
  }

  /** 返回一个 scan run 的全部 trace,按 traceIndex 单调升序 */
  listByScanRun(scanRunId: string): AgentTracePublic[] {
    const rows = this.db
      .select()
      .from(agentTraces)
      .where(eq(agentTraces.scanRunId, scanRunId))
      .orderBy(asc(agentTraces.traceIndex))
      .all();
    return rows.map((r) => this.toPublic(r));
  }

  /** 单条 trace 详情;不存在 → NotFoundException */
  getById(id: string): AgentTracePublic {
    const row = this.db.select().from(agentTraces).where(eq(agentTraces.id, id)).get();
    if (!row) throw new NotFoundException(`agent trace ${id} not found`);
    return this.toPublic(row);
  }

  /** 给前端 TracePage 顶部 summary 用 —— 总条数 + token 累计 + 主 model */
  summarize(scanRunId: string): AgentTraceSummary {
    const sumRow = this.db
      .select()
      .from(agentTraces)
      .where(eq(agentTraces.scanRunId, scanRunId))
      .all();
    let p = 0;
    let c = 0;
    let t = 0;
    let model: string | null = null;
    for (const r of sumRow) {
      if (typeof r.promptTokens === 'number') p += r.promptTokens;
      if (typeof r.completionTokens === 'number') c += r.completionTokens;
      if (typeof r.totalTokens === 'number') t += r.totalTokens;
      if (model === null && typeof r.model === 'string') model = r.model;
    }
    return {
      scanRunId,
      total: sumRow.length,
      totalPromptTokens: p,
      totalCompletionTokens: c,
      totalTokens: t,
      model,
    };
  }

  private toPublic(r: typeof agentTraces.$inferSelect): AgentTracePublic {
    return {
      id: r.id,
      scanRunId: r.scanRunId,
      traceIndex: r.traceIndex,
      role: r.role,
      content: r.content,
      toolCalls: r.toolCalls,
      toolCallId: r.toolCallId,
      finishReason: r.finishReason,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      model: r.model,
      createdAt: r.createdAt,
    };
  }
}
