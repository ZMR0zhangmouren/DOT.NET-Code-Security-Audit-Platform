import { describe, it, expect, vi } from 'vitest';

import type { VulnsController } from './vulns.controller.js';

// §5.5 VulnsController 端点覆盖:
// listForProject / getLibrary / setLibraryStatus / getVuln / setVulnStatus

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: VulnsController;
  library: {
    list: ReturnType<typeof vi.fn>;
    getWithTimeline: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  };
  vuln: {
    get: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./vulns.controller.js');
  const library = {
    list: vi.fn(() => [{ id: 'lib-1' }]),
    getWithTimeline: vi.fn(() => ({ id: 'lib-1', timeline: [] })),
    setStatus: vi.fn(() => ({ id: 'lib-1', status: 'fixing', timeline: [] })),
  };
  const vuln = {
    get: vi.fn(() => ({ id: 'v-1' })),
    setStatus: vi.fn(() => ({ id: 'v-1', status: 'fixing' })),
  };
  const controller = new mod.VulnsController(library as never, vuln as never);
  return { controller, library, vuln };
}

describe('VulnsController (§5.5)', () => {
  it('listForProject → 调 library.list(projectId)', async () => {
    const { controller, library } = await makeController();
    expect(controller.listForProject('p1')).toEqual([{ id: 'lib-1' }]);
    expect(library.list).toHaveBeenCalledWith('p1');
  });

  it('getLibrary → 调 library.getWithTimeline(id)', async () => {
    const { controller, library } = await makeController();
    expect(controller.getLibrary('lib-1')).toEqual({ id: 'lib-1', timeline: [] });
    expect(library.getWithTimeline).toHaveBeenCalledWith('lib-1');
  });

  it('setLibraryStatus → 调 library.setStatus(id, status)', async () => {
    const { controller, library } = await makeController();
    const out = controller.setLibraryStatus('lib-1', { status: 'fixing' });
    expect(out).toEqual({ id: 'lib-1', status: 'fixing', timeline: [] });
    expect(library.setStatus).toHaveBeenCalledWith('lib-1', 'fixing');
  });

  it('getVuln → 调 vuln.get(id)', async () => {
    const { controller, vuln } = await makeController();
    expect(controller.getVuln('v-1')).toEqual({ id: 'v-1' });
    expect(vuln.get).toHaveBeenCalledWith('v-1');
  });

  it('setVulnStatus → 调 vuln.setStatus(id, status)', async () => {
    const { controller, vuln } = await makeController();
    const out = controller.setVulnStatus('v-1', { status: 'fixed' });
    expect(out).toEqual({ id: 'v-1', status: 'fixing' });
    expect(vuln.setStatus).toHaveBeenCalledWith('v-1', 'fixed');
  });
});
