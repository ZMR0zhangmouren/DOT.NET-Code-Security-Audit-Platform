import { describe, it, expect, vi } from 'vitest';

import type { CodeVersionsController } from './code-versions.controller.js';

// §5.2 CodeVersionsController 端点覆盖:
// list / get(无 upload,因为 multer + FileInterceptor 需要 mock fs)

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: CodeVersionsController;
  cv: {
    listByProject: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    uploadZip: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./code-versions.controller.js');
  const cv = {
    listByProject: vi.fn(() => [{ id: 'cv-1' }]),
    get: vi.fn(() => ({ id: 'cv-1' })),
    uploadZip: vi.fn(async () => ({ id: 'cv-new' })),
  };
  const controller = new mod.CodeVersionsController(cv as never);
  return { controller, cv };
}

describe('CodeVersionsController (§5.2)', () => {
  it('list → 调 cv.listByProject(projectId)', async () => {
    const { controller, cv } = await makeController();
    expect(controller.list('p1')).toEqual([{ id: 'cv-1' }]);
    expect(cv.listByProject).toHaveBeenCalledWith('p1');
  });

  it('get → 调 cv.get(id)', async () => {
    const { controller, cv } = await makeController();
    expect(controller.get('cv-1')).toEqual({ id: 'cv-1' });
    expect(cv.get).toHaveBeenCalledWith('cv-1');
  });
});
