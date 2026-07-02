import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from './App';

describe('App (路由出口)', () => {
  beforeEach(() => {
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'u1',
        username: 'admin',
        role: 'admin',
        email: 'a@x.com',
        displayName: null,
      }),
    );
    localStorage.setItem('access_token', 'test-token');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('已登录时渲染主应用（Sidebar + TopBar）', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('CodeSec Audit')).toBeInTheDocument();
    });

    expect(screen.getByText('总览')).toBeInTheDocument();
    expect(screen.getByText('项目列表')).toBeInTheDocument();
  });

  it('未登录时 AuthGuard 拦截并重定向', async () => {
    localStorage.clear();
    render(<App />);

    // AuthGuard 检测到无凭据 → Navigate to=/login
    await waitFor(() => {
      const inputs = screen.getAllByLabelText('用户名 / 邮箱');
      expect(inputs.length).toBeGreaterThan(0);
    });
  });
});
