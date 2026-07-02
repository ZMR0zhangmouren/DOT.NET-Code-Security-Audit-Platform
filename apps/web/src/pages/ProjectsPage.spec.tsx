import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectsPage from './ProjectsPage';

const mockProjects = [
  {
    id: 'proj-1',
    name: 'MyProject',
    description: 'A test project',
    status: 'active' as const,
    visibility: 'private' as const,
    ownerId: 'u1',
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
  },
  {
    id: 'proj-2',
    name: 'Archived',
    description: null,
    status: 'archived' as const,
    visibility: 'public' as const,
    ownerId: 'u1',
    createdAt: Date.now() - 172800000,
    updatedAt: Date.now(),
  },
];

describe('ProjectsPage', () => {
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

  it('渲染页面标题和新建按钮', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockProjects), { status: 200 }),
    );
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('项目列表')).toBeInTheDocument();
      expect(screen.getAllByText('新建项目').length).toBeGreaterThan(0);
    });
  });

  it('加载后显示项目卡片', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockProjects), { status: 200 }),
    );
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('MyProject').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);
    });
  });

  it('无项目显示空态', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('暂无项目').length).toBeGreaterThan(0);
    });
  });

  it('搜索框可输入', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockProjects), { status: 200 }),
    );
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('MyProject').length).toBeGreaterThan(0);
    });

    const input = screen.getAllByPlaceholderText('搜索项目...')[0]!;
    await userEvent.type(input, 'test');
    expect(input).toHaveValue('test');
  });

  it('新建 Dialog 可打开', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockProjects), { status: 200 }),
    );
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('MyProject').length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getAllByText('新建项目')[0]!);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('API 错误显示', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
  });
});
