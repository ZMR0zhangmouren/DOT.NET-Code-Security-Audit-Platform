/**
 * §5.3 API 覆盖统计 —— 单元测试(coverage.util.ts 纯函数版本)
 *
 * 覆盖场景:
 *   - route_mapping + framework_audit 完全覆盖 → COMPLETE (100%)
 *   - route_mapping 部分覆盖 → PARTIAL
 *   - route_mapping 全未覆盖 → NOT_RUN (0%)
 *   - 无 route_mapping 产物但 vulnerabilities 有命中 → NOT_RUN (null)
 *   - auth 入口被 vuln 命中 → authCoveragePercent > 0
 *   - normRoute 标准化大小写/前后斜杠/查询串
 *   - 空 output_root 不抛错,全 null / NOT_RUN
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  computeApiCoverage,
  extractRoutesFromJson,
  normRoute,
  readRoutesFromDir,
  type VulnLookup,
} from './coverage.util.js';

describe('§5.3 normRoute', () => {
  it('标准化大小写/前后斜杠/查询串', () => {
    expect(normRoute('/API/Users/')).toBe('api/users');
    expect(normRoute('/api/users?x=1')).toBe('api/users');
    expect(normRoute('api/users')).toBe('api/users');
    expect(normRoute('\\API\\users\\')).toBe('api/users');
  });
});

describe('§5.3 extractRoutesFromJson', () => {
  it('从嵌套 route/path/endpoint/handlers 抽取', () => {
    const r = extractRoutesFromJson({
      routes: ['/a', '/b'],
      meta: {
        endpoint: '/c',
        controller: 'XController',
        handlers: ['GET', 'POST'],
      },
    });
    expect(r).toContain('a');
    expect(r).toContain('b');
    expect(r).toContain('c');
    expect(r).toContain('xcontroller');
  });

  it('空对象返回 []', () => {
    expect(extractRoutesFromJson({})).toEqual([]);
    expect(extractRoutesFromJson(null)).toEqual([]);
    // 顶层是字符串也作为单个入口标识返回(便于兼容非常规产物)
    expect(extractRoutesFromJson('not an object')).toEqual(['not an object']);
  });

  it('去重', () => {
    const r = extractRoutesFromJson({ routes: ['/a', '/a', '/A'] });
    expect(r).toEqual(['a']);
  });
});

describe('§5.3 readRoutesFromDir', () => {
  it('不存在的目录返回 []', () => {
    expect(readRoutesFromDir('/nonexistent-dir-12345')).toEqual([]);
  });

  it('读目录下所有 .json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rrd-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ route: '/x' }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ routes: ['/y', '/z'] }));
    writeFileSync(join(dir, 'c.txt'), 'ignored');
    const r = readRoutesFromDir(dir);
    expect(r.sort()).toEqual(['x', 'y', 'z']);
  });

  it('损坏的 JSON 跳过,不抛错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rrd-'));
    writeFileSync(join(dir, 'a.json'), '{bad json');
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ route: '/ok' }));
    const r = readRoutesFromDir(dir);
    expect(r).toEqual(['ok']);
  });
});

describe('§5.3 computeApiCoverage', () => {
  it('route_mapping + framework_audit 完全覆盖 → COMPLETE 100%', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    mkdirSync(join(dir, 'route_mapping'));
    mkdirSync(join(dir, 'framework_audit'));
    writeFileSync(
      join(dir, 'route_mapping', 'routes.json'),
      JSON.stringify({ routes: ['/api/users', '/api/orders', '/api/auth/login'] }),
    );
    writeFileSync(
      join(dir, 'framework_audit', 'framework-users.json'),
      JSON.stringify({ route: '/api/users', handlers: ['GET', 'POST'] }),
    );
    writeFileSync(
      join(dir, 'framework_audit', 'framework-orders.json'),
      JSON.stringify({ route: '/api/orders', handlers: ['GET'] }),
    );
    writeFileSync(
      join(dir, 'framework_audit', 'framework-auth.json'),
      JSON.stringify({ route: '/api/auth/login', handlers: ['POST'] }),
    );
    const lookup: VulnLookup = () => [];
    const r = computeApiCoverage(lookup, 'scan-x', dir);
    expect(r.totalRoutes).toBe(3);
    expect(r.apiCoverageStatus).toBe('COMPLETE');
    expect(r.controllerCoveragePercent).toBe(10000);
    expect(r.authCoveragePercent).toBe(10000);
  });

  it('route_mapping 部分覆盖 → PARTIAL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    mkdirSync(join(dir, 'route_mapping'));
    mkdirSync(join(dir, 'framework_audit'));
    writeFileSync(
      join(dir, 'route_mapping', 'routes.json'),
      JSON.stringify({ routes: ['/a', '/b', '/c', '/d'] }),
    );
    writeFileSync(join(dir, 'framework_audit', 'f1.json'), JSON.stringify({ route: '/a' }));
    writeFileSync(join(dir, 'framework_audit', 'f2.json'), JSON.stringify({ route: '/b' }));
    const r = computeApiCoverage(() => [], 'scan-x', dir);
    expect(r.totalRoutes).toBe(4);
    expect(r.apiCoverageStatus).toBe('PARTIAL');
    expect(r.controllerCoveragePercent).toBe(5000);
  });

  it('route_mapping 全未覆盖 → NOT_RUN 0%', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    mkdirSync(join(dir, 'route_mapping'));
    writeFileSync(
      join(dir, 'route_mapping', 'routes.json'),
      JSON.stringify({ routes: ['/x', '/y'] }),
    );
    const r = computeApiCoverage(() => [], 'scan-x', dir);
    expect(r.apiCoverageStatus).toBe('NOT_RUN');
    expect(r.controllerCoveragePercent).toBe(0);
  });

  it('无 route_mapping 产物但 vulnerabilities 有命中 → NOT_RUN (分母为 0, percent=null)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    mkdirSync(join(dir, 'quality'));
    const r = computeApiCoverage(
      () => [{ filePath: 'Controllers/AuthController.cs', vulnType: 'broken-auth' }],
      'scan-x',
      dir,
    );
    expect(r.totalRoutes).toBe(0);
    expect(r.apiCoverageStatus).toBe('NOT_RUN');
    expect(r.controllerCoveragePercent).toBeNull();
  });

  it('auth 入口被 vuln 命中 → authCoveragePercent > 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    mkdirSync(join(dir, 'route_mapping'));
    writeFileSync(
      join(dir, 'route_mapping', 'routes.json'),
      JSON.stringify({ routes: ['/api/auth/login', '/api/users', '/api/auth/refresh'] }),
    );
    const r = computeApiCoverage(
      () => [{ filePath: 'Auth/Login', vulnType: 'broken-auth' }],
      'scan-x',
      dir,
    );
    // auth 入口 = 2;auth vuln = 1 → 50% → 5000
    expect(r.authCoveragePercent).toBe(5000);
  });

  it('normRoute 标准化:大小写/前后斜杠/查询串都被归一', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    mkdirSync(join(dir, 'route_mapping'));
    writeFileSync(
      join(dir, 'route_mapping', 'routes.json'),
      JSON.stringify({ routes: ['/API/Users/', '/api/users?x=1', 'api/users'] }),
    );
    const r = computeApiCoverage(() => [], 'scan-x', dir);
    expect(r.totalRoutes).toBe(1);
  });

  it('空 output_root → 不抛错,全 null / NOT_RUN', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    const r = computeApiCoverage(() => [], 'scan-x', dir);
    expect(r.totalRoutes).toBe(0);
    expect(r.apiCoverageStatus).toBe('NOT_RUN');
    expect(r.controllerCoveragePercent).toBeNull();
    expect(r.authCoveragePercent).toBeNull();
  });
});
