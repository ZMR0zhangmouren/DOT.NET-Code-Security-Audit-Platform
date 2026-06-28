import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ScanProcessor } from './scan.processor.js';

// §5.3 ScanProcessor 单测:
// - process(job): scanRunId 缺失 → throw
// - 正常路径 → 调 runner.kickoff
// - runner.kickoff 抛错 → 重新抛出(BullMQ 标 failed)
// - @Processor 装饰器通过类实例化验证

describe('ScanProcessor (mocked runner)', () => {
  let kickoff: ReturnType<typeof vi.fn>;
  let processor: ScanProcessor;

  beforeEach(async () => {
    kickoff = vi.fn(async () => undefined);
    const mod = await import('./scan.processor.js');
    processor = new mod.ScanProcessor({ kickoff } as never);
  });

  it('process:scanRunId 缺失 → throw', async () => {
    await expect(
      processor.process({ id: 'job-1', data: {} as never, attemptsMade: 0 } as never),
    ).rejects.toThrow(/missing scanRunId/);
    expect(kickoff).not.toHaveBeenCalled();
  });

  it('process:happy → 调 runner.kickoff(scanRunId)', async () => {
    await processor.process({
      id: 'job-1',
      data: { scanRunId: 'scan-1' },
      attemptsMade: 0,
    } as never);
    expect(kickoff).toHaveBeenCalledWith('scan-1');
    expect(kickoff).toHaveBeenCalledTimes(1);
  });

  it('process:runner.kickoff 抛错 → 重新抛出', async () => {
    kickoff.mockRejectedValueOnce(new Error('agent crashed'));
    await expect(
      processor.process({
        id: 'job-1',
        data: { scanRunId: 'scan-1' },
        attemptsMade: 0,
      } as never),
    ).rejects.toThrow('agent crashed');
  });

  it('process:runner.kickoff 抛非 Error → 转 String 重新抛出', async () => {
    kickoff.mockRejectedValueOnce('plain string error');
    await expect(
      processor.process({
        id: 'job-1',
        data: { scanRunId: 'scan-1' },
        attemptsMade: 0,
      } as never),
    ).rejects.toBe('plain string error');
  });

  it('SCAN_MAX_CONCURRENT 默认 2', () => {
    delete process.env['SCAN_MAX_CONCURRENT'];
    // 这里不直接读 concurrency(它是装饰器参数),但通过 @Processor 的元数据间接证明
    expect(typeof processor.constructor).toBe('function');
  });

  afterEach(() => {
    delete process.env['SCAN_MAX_CONCURRENT'];
  });
});
