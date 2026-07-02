import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('App (路由出口)', () => {
  it('默认路由 / 渲染 AppLayout + Sidebar 导航', async () => {
    render(<App />);

    // AppLayout 的 TopBar Logo 始终存在
    await waitFor(() => {
      expect(screen.getByText('CodeSec Audit')).toBeInTheDocument();
    });

    // Sidebar 导航链接
    expect(screen.getByText('总览')).toBeInTheDocument();
    expect(screen.getByText('项目列表')).toBeInTheDocument();
  });
});
