import { describe, it, expect, vi } from 'vitest';

import type { ScanGateway } from './scan.gateway.js';

// §5.3 ScanGateway 单测:
// subscribe:scan → 加入 room + 返回 ok / missing
// demo:poke → emit 到 room

interface FakeClient {
  id: string;
  join: ReturnType<typeof vi.fn>;
}

interface FakeServer {
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
}

async function makeGateway(): Promise<{
  gw: ScanGateway;
  server: FakeServer;
  emitSpy: ReturnType<typeof vi.fn>;
}> {
  const mod = await import('./scan.gateway.js');
  const gw = new mod.ScanGateway();
  const emitSpy = vi.fn();
  const server: FakeServer = {
    to: (_room: string) => ({
      emit: (event, payload) => {
        emitSpy(event, payload);
      },
    }),
  };
  // 注入 server 字段(用类型断言绕过 strict 检查)
  (gw as unknown as { server: FakeServer }).server = server;
  return { gw, server, emitSpy };
}

describe('ScanGateway', () => {
  it('subscribe:scan 缺 scanRunId → 返回 ok=false + error', async () => {
    const { gw } = await makeGateway();
    const client: FakeClient = { id: 'c1', join: vi.fn() };
    const out = gw.onSubscribe(client as never, {} as never);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/scanRunId required/);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('subscribe:scan 带合法 scanRunId → client.join + ok', async () => {
    const { gw } = await makeGateway();
    const client: FakeClient = { id: 'c1', join: vi.fn() };
    const out = gw.onSubscribe(client as never, { scanRunId: 'scan-1' } as never);
    expect(out.ok).toBe(true);
    expect(out.scanRunId).toBe('scan-1');
    expect(client.join).toHaveBeenCalledWith('scan:scan-1');
  });

  it('subscribe:scan scanRunId 非 string → 拒绝', async () => {
    const { gw } = await makeGateway();
    const client: FakeClient = { id: 'c1', join: vi.fn() };
    const out = gw.onSubscribe(client as never, { scanRunId: 123 } as never);
    expect(out.ok).toBe(false);
  });

  it('demo:poke 默认 scanRunId=demo → emit 到 scan:demo', async () => {
    const { gw, emitSpy } = await makeGateway();
    const out = gw.onDemoPoke({} as never);
    expect(out.ok).toBe(true);
    expect(out.delivered).toBe(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [event, payload] = emitSpy.mock.calls[0]!;
    expect(event).toBe('scan:log');
    expect((payload as { scanRunId: string }).scanRunId).toBe('demo');
    expect((payload as { message: string }).message).toContain('pong');
  });

  it('demo:poke 自定义 scanRunId → emit 到 scan:{id}', async () => {
    const { gw, emitSpy } = await makeGateway();
    gw.onDemoPoke({ scanRunId: 'scan-x' } as never);
    const [event, payload] = emitSpy.mock.calls[0]!;
    expect(event).toBe('scan:log');
    expect((payload as { scanRunId: string }).scanRunId).toBe('scan-x');
  });

  it('afterInit / handleConnection / handleDisconnect → 不抛', async () => {
    const { gw } = await makeGateway();
    expect(() => gw.afterInit()).not.toThrow();
    expect(() => gw.handleConnection({} as never)).not.toThrow();
    expect(() => gw.handleDisconnect({} as never)).not.toThrow();
  });

  void vi;
});
