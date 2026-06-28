import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * §5.3 覆盖统计的纯文件读取工具集(无 drizzle / DB 依赖,便于单测)。
 *
 * 状态阈值:percent(0-100) >= 95 → COMPLETE;>= 50 → PARTIAL;< 50 或 total=0 → NOT_RUN
 */

export interface CoverageStat {
  totalRoutes: number;
  coveredRoutes: string[];
  uncoveredRoutes: string[];
  controllerCoveragePercent: number | null;
  authCoveragePercent: number | null;
  apiCoverageStatus: 'NOT_RUN' | 'PARTIAL' | 'COMPLETE';
}

export interface VulnLookup {
  (scanRunId: string): Array<{ filePath: string; vulnType: string }>;
}

/** 把字符串标准化为统一入口标识 */
export function normRoute(s: string): string {
  return s
    .trim()
    .replace(/\\/g, '/')
    .replace(/\?.*$/, '')
    .replace(/^[/]+/, '')
    .replace(/[/]+$/, '')
    .toLowerCase();
}

/** 从一个产物 JSON 抽取"入口标识"列表 —— 兼容多种字段名 */
export function extractRoutesFromJson(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // HTTP 方法 + 通用 token:这些 token 经常作为 string 出现在 handlers/urlPattern 等字段,
  // 但显然不是入口标识,在规范化前过滤
  const HTTP_METHOD_BLACKLIST = new Set([
    'get',
    'post',
    'put',
    'delete',
    'patch',
    'head',
    'options',
    'trace',
    'connect',
    'true',
    'false',
    'null',
    'undefined',
    'controller',
    'handler',
  ]);
  function push(x: unknown): void {
    if (typeof x !== 'string') return;
    const n = normRoute(x);
    if (!n || seen.has(n)) return;
    // 过滤常见的非入口字符串:HTTP 方法、布尔值、通用 token
    if (HTTP_METHOD_BLACKLIST.has(n)) return;
    seen.add(n);
    out.push(n);
  }
  function walk(node: unknown, depth: number): void {
    if (depth > 6) return;
    if (typeof node === 'string') {
      // walk 入口遇到字符串时也尝试作为入口标识收集
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v, depth + 1);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    for (const key of [
      'route',
      'path',
      'endpoint',
      'controller',
      'controllerClass',
      'class',
      'file',
      'filePath',
      'handler',
      'handlers',
      'url',
      'urls',
    ]) {
      const v = o[key];
      if (typeof v === 'string') push(v);
      else if (Array.isArray(v)) for (const x of v) push(x);
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  }
  walk(raw, 0);
  return out;
}

/** 读一个目录里所有 .json 文件,聚合成"入口列表"。目录不存在返回 []。 */
export function readRoutesFromDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const all: string[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const p = join(dir, name);
    try {
      const buf = readFileSync(p, 'utf8');
      const parsed: unknown = JSON.parse(buf);
      all.push(...extractRoutesFromJson(parsed));
    } catch {
      // 损坏的 JSON 跳过
    }
  }
  return all;
}

/**
 * §5.3 覆盖统计聚合 —— 复用 §2.9 产物落盘约定 + vulnerabilities 反推。
 * 纯函数版本,不依赖 drizzle —— 用于单测;scan-runner.service.ts 内部另有
 * 适配 drizzle 的 computeApiCoverage() 调用相同算法。
 */
export function computeApiCoverage(
  lookup: VulnLookup,
  scanRunId: string,
  outputRoot: string,
): CoverageStat {
  const routeDir = join(outputRoot, 'route_mapping');
  const fwDir = join(outputRoot, 'framework_audit');

  const routeSet = new Set<string>();
  for (const r of readRoutesFromDir(routeDir)) routeSet.add(r);

  const coveredFromFw = new Set<string>();
  for (const r of readRoutesFromDir(fwDir)) coveredFromFw.add(r);

  const vulnRows = lookup(scanRunId);
  const coveredFromVuln = new Set<string>();
  let authRouteCount = 0;
  for (const v of vulnRows) {
    const n = normRoute(v.filePath);
    if (n) coveredFromVuln.add(n);
  }
  for (const r of routeSet) {
    if (/auth|login|token|cookie|session|jwt|oauth/i.test(r)) authRouteCount++;
  }

  const covered = new Set<string>([...coveredFromFw, ...coveredFromVuln]);
  const coveredRoutes: string[] = [];
  for (const r of routeSet) if (covered.has(r)) coveredRoutes.push(r);
  // vuln 反推的文件路径片段(不是完整路由)做"包含"匹配:route 包含 filePath 片段即视为覆盖
  // (兼容 Controllers/AuthController.cs 落到 /api/auth/login 的情形)
  const vulnFragments = Array.from(coveredFromVuln);
  for (const r of routeSet) {
    if (covered.has(r)) continue;
    if (vulnFragments.some((f) => r.includes(f) || f.includes(r))) {
      coveredRoutes.push(r);
    }
  }
  for (const r of coveredFromFw)
    if (!routeSet.has(r) && !coveredRoutes.includes(r)) coveredRoutes.push(r);
  for (const r of vulnFragments)
    if (!routeSet.has(r) && !coveredRoutes.includes(r)) coveredRoutes.push(r);

  const totalRoutes = routeSet.size;
  const coveredCount = coveredRoutes.length;

  let percent: number | null = null;
  if (totalRoutes > 0) {
    percent = Math.round((coveredCount / totalRoutes) * 100 * 100); // ×100 存
  }

  let authPercent: number | null = null;
  if (authRouteCount > 0) {
    const vulnFrags = Array.from(coveredFromVuln);
    let authCovered = 0;
    for (const r of routeSet) {
      if (!/auth|login|token|cookie|session|jwt|oauth/i.test(r)) continue;
      if (coveredFromFw.has(r)) {
        authCovered++;
        continue;
      }
      if (vulnFrags.some((f) => r.includes(f) || f.includes(r))) authCovered++;
    }
    const ap = Math.min(100, (authCovered / authRouteCount) * 100);
    authPercent = Math.round(ap * 100);
  }

  const apiCoverageStatus: CoverageStat['apiCoverageStatus'] =
    totalRoutes === 0
      ? 'NOT_RUN'
      : percent === null
        ? 'NOT_RUN'
        : percent / 100 >= 95
          ? 'COMPLETE'
          : percent / 100 >= 50
            ? 'PARTIAL'
            : 'NOT_RUN';

  const uncovered: string[] = [];
  for (const r of routeSet) if (!covered.has(r)) uncovered.push(r);

  return {
    totalRoutes,
    coveredRoutes,
    uncoveredRoutes: uncovered,
    controllerCoveragePercent: percent,
    authCoveragePercent: authPercent,
    apiCoverageStatus,
  };
}
