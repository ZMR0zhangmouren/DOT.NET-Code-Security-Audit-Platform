import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from './LoginPage';

// Mock useAuth
const mockLogin = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: mockLogin,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染登录表单', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('CodeSec Audit')).toBeInTheDocument();
    expect(screen.getByLabelText('用户名 / 邮箱')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getAllByTestId('login-submit').length).toBeGreaterThan(0);
  });

  it('默认填充凭据', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('用户名 / 邮箱')).toHaveValue('admin');
    expect(screen.getByLabelText('密码')).toHaveValue('admin123');
  });

  it('提交时调用 useAuth.login', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getAllByTestId('login-submit')[0]!);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin', 'admin123');
    });
  });

  it('登录失败显示错误', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getAllByTestId('login-submit')[0]!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    });
  });

  it('提交中按钮禁用', async () => {
    mockLogin.mockImplementationOnce(() => new Promise(() => {}));
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getAllByTestId('login-submit')[0]!);

    await waitFor(() => {
      expect(screen.getAllByTestId('login-submit')[0]!).toBeDisabled();
    });
  });
});
