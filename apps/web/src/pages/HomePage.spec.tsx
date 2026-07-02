import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from './HomePage';

function mockFetch(healthOk: boolean, projectsData: unknown): void {
  if (healthOk) {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ok',
            uptimeSec: 3600,
            coverageModeDefault: 'FULL',
            nodeVersion: 'v20',
            dbTables: 17,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(projectsData), { status: 200 }));
  } else {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
  }
}

describe('HomePage (Dashboard)', () => {
  beforeEach(() => {
    localStorage.setItem('access_token', 'jwt.test');
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'u1',
        username: 'admin',
        email: 'a@x.com',
        displayName: null,
        role: 'admin',
      }),
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('渲染页面标题', async () => {
    mockFetch(true, []);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('总览')).toBeInTheDocument();
    });
  });

  it('显示统计卡片', async () => {
    mockFetch(true, []);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('项目总数')).toBeInTheDocument();
      expect(screen.getByText('系统状态')).toBeInTheDocument();
    });
  });

  it('有项目时显示项目列表', async () => {
    mockFetch(true, [
      {
        id: 'p1',
        name: 'Test Project',
        description: 'desc',
        status: 'active',
        visibility: 'private',
        ownerId: 'u1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  it('无项目显示空态', async () => {
    mockFetch(true, []);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('暂无项目').length).toBeGreaterThan(0);
    });
  });

  it('API 失败显示错误', async () => {
    mockFetch(false, []);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
  });
});
