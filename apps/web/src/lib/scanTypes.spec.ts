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
      ['running', 'bg-blue-500 text-white'],
      ['succeeded', 'bg-green-600 text-white'],
      ['failed', 'bg-destructive text-destructive-foreground'],
      ['canceled', 'bg-muted text-muted-foreground'],
    ])('status=%s → 对应 class', (s, expected) => {
      expect(scanStatusClass(s)).toBe(expected);
    });
  });

  describe('coverageClass', () => {
    it.each<[ApiCoverageStatus, string]>([
      ['NOT_RUN', 'bg-muted text-muted-foreground'],
      ['PARTIAL', 'bg-yellow-500 text-white'],
      ['COMPLETE', 'bg-green-600 text-white'],
    ])('coverage=%s → 对应 class', (s, expected) => {
      expect(coverageClass(s)).toBe(expected);
    });
  });

  describe('gateClass', () => {
    it.each<[GateDecision, string]>([
      ['PASS', 'bg-green-600 text-white'],
      ['BLOCKED', 'bg-destructive text-destructive-foreground'],
      ['PENDING', 'bg-muted text-muted-foreground'],
    ])('gate=%s → 对应 class', (g, expected) => {
      expect(gateClass(g)).toBe(expected);
    });
  });
});
