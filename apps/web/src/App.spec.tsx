import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import App from './App';

describe('App (路由出口)', () => {
  it('默认路由 / 渲染主页', () => {
    render(<App />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]?.textContent).toContain('总览');
  });
});
