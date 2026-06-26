import { describe, it, expect } from 'vitest';

import {
  SEVERITY,
  COVERAGE_MODE,
  EXECUTION_STATUS,
  GATE_TYPE,
  TRACE_STATUS,
  type Severity,
} from './index.js';

describe('@platform/shared enums', () => {
  it('SEVERITY 是 4 值且与决策表 §4.2.5 对齐', () => {
    expect(SEVERITY).toEqual(['C', 'H', 'M', 'L']);
  });

  it('COVERAGE_MODE 默认是 FULL(对应 README §2.8.1)', () => {
    expect(COVERAGE_MODE[0]).toBe('FULL');
  });

  it('EXECUTION_STATUS 是 5 值枚举', () => {
    expect(EXECUTION_STATUS).toHaveLength(5);
    expect(EXECUTION_STATUS).toContain('NOT_APPLICABLE');
  });

  it('GATE_TYPE 是 4 种门禁', () => {
    expect(GATE_TYPE).toEqual([
      'API_COVERAGE_GATE',
      'COVERAGE_CONSISTENCY_CHECK',
      'QUICK_VALIDATION',
      'FINAL_ANCHOR_CHECKLIST',
    ]);
  });

  it('TRACE_STATUS 含 NOT_TRACED(待补证风险池独立章节)', () => {
    expect(TRACE_STATUS).toContain('NOT_TRACED');
  });

  it('Severity 类型与 SEVERITY 一致', () => {
    const sample: Severity = 'C';
    expect(sample).toBe('C');
  });
});
