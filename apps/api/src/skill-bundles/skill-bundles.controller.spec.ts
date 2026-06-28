import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import type { SkillBundlesController } from './skill-bundles.controller.js';

// §11 Q7 SkillBundlesController 端点覆盖:
// list / default / get / setDefault / publish

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: SkillBundlesController;
  bundles: {
    list: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    getDefault: ReturnType<typeof vi.fn>;
    setDefault: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./skill-bundles.controller.js');
  const bundles = {
    list: vi.fn(() => [{ id: 'sb-1' }]),
    getById: vi.fn(() => ({ id: 'sb-1', isActive: true })),
    getDefault: vi.fn(() => ({ id: 'sb-default' })),
    setDefault: vi.fn(() => ({ id: 'sb-1', isDefault: true })),
    publish: vi.fn(() => ({ id: 'sb-1', isActive: true, publishedAt: 1 })),
  };
  const controller = new mod.SkillBundlesController(bundles as never);
  return { controller, bundles };
}

describe('SkillBundlesController (§11 Q7)', () => {
  it('list(active="true") → bundles.list({ activeOnly: true })', async () => {
    const { controller, bundles } = await makeController();
    expect(controller.list('true')).toEqual([{ id: 'sb-1' }]);
    expect(bundles.list).toHaveBeenCalledWith({ activeOnly: true });
  });

  it('list(active="false") → bundles.list({ activeOnly: false })', async () => {
    const { controller, bundles } = await makeController();
    controller.list('false');
    expect(bundles.list).toHaveBeenCalledWith({ activeOnly: false });
  });

  it('list 不带 active → activeOnly=false(active === "true" 才 true)', async () => {
    const { controller, bundles } = await makeController();
    controller.list();
    expect(bundles.list).toHaveBeenCalledWith({ activeOnly: false });
  });

  it('default → bundles.getDefault → 返回 {id, bundle}', async () => {
    const { controller, bundles } = await makeController();
    expect(controller.default()).toEqual({ id: 'sb-default', bundle: { id: 'sb-default' } });
    expect(bundles.getDefault).toHaveBeenCalledTimes(1);
  });

  it('default 没默认 → 返回 {id: null, bundle: null}', async () => {
    const { controller, bundles } = await makeController();
    bundles.getDefault.mockReturnValueOnce(null);
    expect(controller.default()).toEqual({ id: null, bundle: null });
  });

  it('get 命中 / 未命中', async () => {
    const { controller, bundles } = await makeController();
    expect(controller.get('sb-1')).toEqual({ id: 'sb-1', isActive: true });
    expect(bundles.getById).toHaveBeenCalledWith('sb-1');

    bundles.getById.mockReturnValueOnce(null);
    expect(() => controller.get('sb-missing')).toThrow(NotFoundException);
  });

  it('setDefault → bundles.setDefault(id)', async () => {
    const { controller, bundles } = await makeController();
    expect(controller.setDefault('sb-1')).toEqual({ id: 'sb-1', isDefault: true });
    expect(bundles.setDefault).toHaveBeenCalledWith('sb-1');
  });

  it('publish → bundles.publish(id, note)', async () => {
    const { controller, bundles } = await makeController();
    expect(controller.publish('sb-1', { note: 'v1' })).toEqual({
      id: 'sb-1',
      isActive: true,
      publishedAt: 1,
    });
    expect(bundles.publish).toHaveBeenCalledWith('sb-1', 'v1');
  });

  it('publish 不带 body → note=null', async () => {
    const { controller, bundles } = await makeController();
    controller.publish('sb-1');
    expect(bundles.publish).toHaveBeenCalledWith('sb-1', null);
  });
});
