import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import App from './App';

describe('App', () => {
  it('渲染主标题(React 18 StrictMode 双渲染时元素数 ≥ 1)', () => {
    render(<App />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]?.textContent).toContain('.NET 代码安全审计平台');
  });

  it('暴露 reload 按钮', () => {
    render(<App />);
    expect(screen.getAllByTestId('reload-button').length).toBeGreaterThan(0);
  });
});
