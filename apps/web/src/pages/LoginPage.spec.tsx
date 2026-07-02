import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from './LoginPage';

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderLogin(): ReturnType<typeof render> {
    return render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
  }

  it('渲染登录表单', () => {
    renderLogin();
    expect(screen.getByText('CodeSec Audit')).toBeInTheDocument();
    expect(screen.getByLabelText('用户名 / 邮箱')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getAllByTestId('login-submit').length).toBeGreaterThan(0);
  });

  it('默认填充凭据', () => {
    renderLogin();
    expect(screen.getByLabelText('用户名 / 邮箱')).toHaveValue('admin');
    expect(screen.getByLabelText('密码')).toHaveValue('admin123');
  });

  it('提交成功存储 token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: 'jwt.test',
          user: { id: 'u1', username: 'admin', email: 'a@x.com', displayName: null, role: 'admin' },
        }),
        { status: 200 },
      ),
    );

    renderLogin();
    await userEvent.click(screen.getAllByTestId('login-submit')[0]!);

    await waitFor(() => {
      expect(localStorage.getItem('access_token')).toBe('jwt.test');
    });
  });

  it('提交失败显示错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 }),
    );

    renderLogin();
    await userEvent.click(screen.getAllByTestId('login-submit')[0]!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    });
  });

  it('加载中按钮禁用', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(() => {}));

    renderLogin();
    await userEvent.click(screen.getAllByTestId('login-submit')[0]!);

    await waitFor(() => {
      const btns = screen.getAllByTestId('login-submit');
      expect(btns[0]).toBeDisabled();
    });
  });
});
