import { describe, it, expect, vi } from 'vitest';

// §5.4 ReportController 单测:
// - report() → setHeaders + send markdown
// - reportJson() → setHeaders + send JSON
// - reportArchive() → setHeaders + sendFile

interface FakeRes {
  headers: Record<string, string>;
  sent?: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  sendFile: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  headersSent: boolean;
}

function makeRes(): FakeRes {
  const statusChain = { json: vi.fn() };
  return {
    headers: {},
    status: vi.fn(() => statusChain),
    json: vi.fn(),
    send: vi.fn(),
    sendFile: vi.fn(),
    setHeader: vi.fn((_k: string, _v: string) => {
      // 实际写入以便断言
    }),
    headersSent: false,
  } as FakeRes;
}

describe('ReportController (§5.4)', () => {
  it('report() → setHeaders + send markdown', async () => {
    const mod = await import('./report.controller.js');
    const reports = { toMarkdown: vi.fn(() => '# MD content') };
    const c = new mod.ReportController(reports as never);
    const res = makeRes();
    c.report('s1', res as never);
    expect(reports.toMarkdown).toHaveBeenCalledWith('s1');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/markdown; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="s1-report.md"',
    );
    expect(res.send).toHaveBeenCalledWith('# MD content');
  });

  it('reportJson() → setHeaders + send JSON.stringify', async () => {
    const mod = await import('./report.controller.js');
    const reports = { toJson: vi.fn(() => ({ a: 1, b: 2 })) };
    const c = new mod.ReportController(reports as never);
    const res = makeRes();
    c.reportJson('s2', res as never);
    expect(reports.toJson).toHaveBeenCalledWith('s2');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="s2-report.json"',
    );
    expect(res.send).toHaveBeenCalledWith(JSON.stringify({ a: 1, b: 2 }, null, 2));
  });

  it('reportArchive() → setHeaders + sendFile', async () => {
    const mod = await import('./report.controller.js');
    const reports = { buildArchive: vi.fn(() => ({ zipPath: '/tmp/s3.zip', bytes: 4096 })) };
    const c = new mod.ReportController(reports as never);
    const res = makeRes();
    c.reportArchive('s3', res as never);
    expect(reports.buildArchive).toHaveBeenCalledWith('s3');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '4096');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="s3-archive.zip"',
    );
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/s3.zip', expect.any(Function));
  });

  it('reportArchive() sendFile 回调 err → status 500 + json 错误', async () => {
    const mod = await import('./report.controller.js');
    const reports = { buildArchive: vi.fn(() => ({ zipPath: '/tmp/s4.zip', bytes: 1 })) };
    const c = new mod.ReportController(reports as never);
    const res = makeRes();
    // 让 sendFile 立即调回调
    res.sendFile = vi.fn((_p: unknown, cb: (err: Error) => void) => {
      cb(new Error('send failed'));
    }) as never;
    c.reportArchive('s4', res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    const chainedJson = (res.status as ReturnType<typeof vi.fn>).mock.results[0]?.value?.json;
    expect(chainedJson).toHaveBeenCalledWith({ error: 'failed to send archive' });
  });

  it('reportArchive() sendFile 回调 err 但 headersSent → 不写 status', async () => {
    const mod = await import('./report.controller.js');
    const reports = { buildArchive: vi.fn(() => ({ zipPath: '/tmp/s5.zip', bytes: 1 })) };
    const c = new mod.ReportController(reports as never);
    const res = makeRes();
    res.headersSent = true;
    res.sendFile = vi.fn((_p: unknown, cb: (err: Error) => void) => {
      cb(new Error('send failed'));
    }) as never;
    c.reportArchive('s5', res as never);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
