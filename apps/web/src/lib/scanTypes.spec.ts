import { describe, expect, it } from 'vitest';

import {
  coverageClass,
  gateClass,
  scanStatusClass,
  type ApiCoverageStatus,
  type GateDecision,
  type ScanRunStatus,
} from './scanTypes';

describe('scanTypes.ts', () => {
  describe('scanStatusClass', () => {
    it.each<[ScanRunStatus, string]>([
      ['queued', 'bg-muted text-muted-foreground'],
      ['running', 'bg-primary/20 text-primary'],
      ['succeeded', 'bg-success/15 text-success border border-success/30'],
      ['failed', 'bg-destructive/15 text-destructive border border-destructive/30'],
      ['canceled', 'bg-muted text-muted-foreground'],
    ])('status=%s → 对应 class', (s, expected) => {
      expect(scanStatusClass(s)).toBe(expected);
    });
  });

  describe('coverageClass', () => {
    it.each<[ApiCoverageStatus, string]>([
      ['NOT_RUN', 'bg-muted text-muted-foreground'],
      ['PARTIAL', 'bg-warning/15 text-warning border border-warning/30'],
      ['COMPLETE', 'bg-success/15 text-success border border-success/30'],
    ])('coverage=%s → 对应 class', (s, expected) => {
      expect(coverageClass(s)).toBe(expected);
    });
  });

  describe('gateClass', () => {
    it.each<[GateDecision, string]>([
      ['PASS', 'bg-success/15 text-success border border-success/30'],
      ['BLOCKED', 'bg-destructive/15 text-destructive border border-destructive/30'],
      ['PENDING', 'bg-muted text-muted-foreground'],
    ])('gate=%s → 对应 class', (g, expected) => {
      expect(gateClass(g)).toBe(expected);
    });
  });
});
