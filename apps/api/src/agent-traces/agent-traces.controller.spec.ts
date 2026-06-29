import { describe, it, expect, vi } from 'vitest';

import type { AgentTracesController } from './agent-traces.controller.js';

// Phase 3 §1.2/2.7 AgentTracesController 端点覆盖:
// - GET /scan-runs/:id/trace          → listByScanRun
// - GET /scan-runs/:id/trace/summary  → summarize
// - GET /agent-traces/:id             → getById
//
// JwtAuthGuard 已在 controller 级启用(测试只验证 wiring,不验 401)

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: AgentTracesController;
  svc: {
    listByScanRun: ReturnType<typeof vi.fn>;
    summarize: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./agent-traces.controller.js');
  const svc = {
    listByScanRun: vi.fn(() => [
      { id: 'at-1', scanRunId: 'scan-1', traceIndex: 1, role: 'system' },
      { id: 'at-2', scanRunId: 'scan-1', traceIndex: 2, role: 'user' },
    ]),
    summarize: vi.fn(() => ({
      scanRunId: 'scan-1',
      total: 2,
      totalPromptTokens: 100,
      totalCompletionTokens: 50,
      totalTokens: 150,
      model: 'gpt-4o',
    })),
    getById: vi.fn((id: string) => ({ id, scanRunId: 'scan-1', traceIndex: 1, role: 'system' })),
  };
  const controller = new mod.AgentTracesController(svc as never);
  return { controller, svc };
}

describe('AgentTracesController (§1.2/2.7)', () => {
  it('GET /scan-runs/:id/trace → svc.listByScanRun(scanRunId)', async () => {
    const { controller, svc } = await makeController();
    const out = controller.listByScanRun('scan-1');
    expect(out).toHaveLength(2);
    expect(svc.listByScanRun).toHaveBeenCalledWith('scan-1');
  });

  it('GET /scan-runs/:id/trace/summary → svc.summarize(scanRunId)', async () => {
    const { controller, svc } = await makeController();
    const out = controller.summarize('scan-1');
    expect(out).toEqual({
      scanRunId: 'scan-1',
      total: 2,
      totalPromptTokens: 100,
      totalCompletionTokens: 50,
      totalTokens: 150,
      model: 'gpt-4o',
    });
    expect(svc.summarize).toHaveBeenCalledWith('scan-1');
  });

  it('GET /agent-traces/:id → svc.getById(id)', async () => {
    const { controller, svc } = await makeController();
    const out = controller.getById('at-1');
    expect(out).toMatchObject({ id: 'at-1' });
    expect(svc.getById).toHaveBeenCalledWith('at-1');
  });
});
