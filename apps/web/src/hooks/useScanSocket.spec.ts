import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// useScanSocket 走 socket.io-client,我们 mock 它,只验证 hook 状态机。
// 注意:vi.mock 在模块顶层 hoist;模块级 handlers / fakeSocket 在所有测试间共享。

const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

const fakeSocket = {
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    handlers[event] = handlers[event] ?? [];
    handlers[event]!.push(cb);
  }),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket),
}));

import { useScanSocket } from './useScanSocket';

function fire(event: string, ...args: unknown[]): void {
  (handlers[event] ?? []).forEach((cb) => cb(...args));
}

beforeEach(() => {
  // 每个测试清空 handlers + 重置 mock 调用记录
  for (const k of Object.keys(handlers)) delete handlers[k];
  fakeSocket.on.mockClear();
  fakeSocket.emit.mockClear();
  fakeSocket.disconnect.mockClear();
});

afterEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe('useScanSocket hook', () => {
  it('scanRunId=null → status=idle, 不创建 socket', () => {
    const { result } = renderHook(() => useScanSocket(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.logs).toEqual([]);
    expect(result.current.lastProgress).toBeNull();
  });

  it('scanRunId 非空 → 初始 status=connecting,connect 后变 connected', () => {
    const { result } = renderHook(() => useScanSocket('scan-1'));
    expect(result.current.status).toBe('connecting');
    act(() => {
      fire('connect');
    });
    expect(result.current.status).toBe('connected');
    // connect 后 socket 应 emit subscribe:scan
    expect(fakeSocket.emit).toHaveBeenCalledWith('subscribe:scan', { scanRunId: 'scan-1' });
  });

  it('receive scan:log → logs 累加', () => {
    const { result } = renderHook(() => useScanSocket('scan-2'));
    act(() => {
      fire('scan:log', { scanRunId: 'scan-2', level: 'info', message: 'log 1', ts: 1 });
    });
    expect(result.current.logs.at(-1)?.message).toBe('log 1');
  });

  it('receive scan:progress → lastProgress 更新', () => {
    const { result } = renderHook(() => useScanSocket('scan-3'));
    act(() => {
      fire('scan:progress', { scanRunId: 'scan-3', percent: 50, currentStage: 'route_mapping' });
    });
    expect(result.current.lastProgress?.percent).toBe(50);
    expect(result.current.lastProgress?.currentStage).toBe('route_mapping');
  });

  it('receive disconnect → status=disconnected', () => {
    const { result } = renderHook(() => useScanSocket('scan-4'));
    act(() => {
      fire('disconnect', 'io server disconnect');
    });
    expect(result.current.status).toBe('disconnected');
  });

  it('receive connect_error → status=error', () => {
    const { result } = renderHook(() => useScanSocket('scan-5'));
    act(() => {
      fire('connect_error', new Error('ECONNREFUSED'));
    });
    expect(result.current.status).toBe('error');
  });

  it('poke → emit demo:poke with scanRunId', () => {
    const { result } = renderHook(() => useScanSocket('scan-6'));
    result.current.poke();
    expect(fakeSocket.emit).toHaveBeenCalledWith('demo:poke', { scanRunId: 'scan-6' });
  });

  it('logs 上限 100 条', () => {
    const { result } = renderHook(() => useScanSocket('scan-7'));
    act(() => {
      for (let i = 0; i < 105; i++) {
        fire('scan:log', { scanRunId: 'scan-7', level: 'info', message: `log ${i}`, ts: i });
      }
    });
    expect(result.current.logs.length).toBeLessThanOrEqual(100);
  });

  it('unmount → socket.disconnect 被调', () => {
    const { unmount } = renderHook(() => useScanSocket('scan-8'));
    unmount();
    expect(fakeSocket.disconnect).toHaveBeenCalled();
  });
});
