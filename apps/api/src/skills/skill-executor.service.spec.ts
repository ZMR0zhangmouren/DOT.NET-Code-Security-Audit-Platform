/**
 * Phase 3 #I —— SkillExecutorService 单元测试
 *
 * 覆盖:
 *   - parseControllerActions:识别 [Route] + [HttpGet/Post/...] + [FromXxx] binding
 *   - parseMinimalApiRoutes:识别 MapGet/MapPost
 *   - runRouteMapperSkill:fixture 一个 OrderController.cs,生成 routes.json,断言 3 个 endpoint
 *   - runFrameworkAuditSkill:fixture .csproj,生成 framework_audit/aspnetcore_xxx.md,断言 framework version
 *   - runVulnScannerSkill:fixture PackageReference,生成 vuln_audit/nuget_xxx.md
 *   - runExploitChainSkill:无 vuln → 写"未发现"声明;有 vuln → 写链路
 *
 * 集成测:scan 跑完,outputRoot 真有 5 个目录(route_mapping / framework_audit /
 *         vuln_audit / exploit_chain),每个有 real 文件
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseControllerActions, parseMinimalApiRoutes } from './skill-executor.service.js';

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {} as never,
}));

vi.mock('../db/schema.js', () => {
  const makeTable = (tableName: string): Record<string, unknown> => {
    const t: Record<string, unknown> = { __table: tableName };
    return new Proxy(t, {
      get: (target, prop: string) => {
        if (prop === '__table') return target['__table'];
        return { __table: target['__table'], __col: prop };
      },
    });
  };
  return {
    scanRuns: makeTable('scan_runs'),
    codeVersions: makeTable('code_versions'),
    skillBundleVersions: makeTable('skill_bundle_versions'),
    vulnerabilities: makeTable('vulnerabilities'),
    skillExecutions: makeTable('skill_executions'),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __table: string; __col: string }, val: unknown) => ({
    __eq: { table: col.__table, col: col.__col, val },
  }),
  and: (...conds: unknown[]) => ({ __and: conds }),
}));

vi.mock('../storage/storage.service.js', () => ({
  StorageService: class {
    codeVersionDir(_cvId: string): string {
      return (globalThis as { __cvDir?: string }).__cvDir ?? '';
    }
    scanRunOutputRoot(scanRunId: string): string {
      const r = (globalThis as { __outputRoot?: string }).__outputRoot ?? '';
      return join(r, scanRunId);
    }
  },
}));

function makeStorageMock() {
  return {
    codeVersionDir: (_cvId: string): string => (globalThis as { __cvDir?: string }).__cvDir ?? '',
    scanRunOutputRoot: (scanRunId: string): string => {
      const r = (globalThis as { __outputRoot?: string }).__outputRoot ?? '';
      return join(r, scanRunId);
    },
  };
}

interface FakeDb {
  rows: Record<string, Record<string, unknown>[]>;
  select: () => {
    from: (t: unknown) => {
      where: (cond: unknown) => {
        get: () => Record<string, unknown> | undefined;
        all: () => Record<string, unknown>[];
      };
    };
  };
  insert: (t: unknown) => {
    values: (v: Record<string, unknown>) => {
      onConflictDoNothing: () => { run: () => void };
    };
  };
  update: (t: unknown) => {
    set: (v: Record<string, unknown>) => {
      where: (cond: unknown) => { run: () => void };
    };
  };
}

interface CondEq {
  __eq: { table: string; col: string; val: unknown };
}

function matchesCond(
  row: Record<string, unknown>,
  cond: CondEq | { __and?: unknown[] } | unknown,
): boolean {
  if (!cond || typeof cond !== 'object') return true;
  if ('__eq' in (cond as object)) {
    const c = (cond as CondEq).__eq;
    return row[c.col] === c.val;
  }
  return true;
}

function getTableName(t: unknown): string {
  if (t && typeof t === 'object') {
    const v = (t as Record<string, unknown>)['__table'];
    if (typeof v === 'string') return v;
  }
  return 'unknown';
}

function createFakeDb(seed?: {
  run?: Record<string, unknown>;
  cv?: Record<string, unknown>;
  bundle?: Record<string, unknown>;
  vulns?: Record<string, unknown>[];
}): FakeDb {
  const rows: Record<string, Record<string, unknown>[]> = {
    scan_runs: seed?.run ? [seed.run] : [],
    code_versions: seed?.cv ? [seed.cv] : [],
    skill_bundle_versions: seed?.bundle ? [seed.bundle] : [],
    vulnerabilities: seed?.vulns ?? [],
  };
  return {
    rows,
    select: () => ({
      from: (t: unknown) => {
        const tableName = getTableName(t);
        if (!rows[tableName]) rows[tableName] = [];
        return {
          where: (cond: unknown) => ({
            get: () => rows[tableName]!.find((r) => matchesCond(r, cond)),
            all: () => rows[tableName]!.filter((r) => matchesCond(r, cond)),
          }),
        };
      },
    }),
    insert: (_t: unknown) => ({
      values: (_v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({ run: () => undefined }),
      }),
    }),
    update: (_t: unknown) => ({
      set: (_v: Record<string, unknown>) => ({
        where: (_cond: unknown) => ({ run: () => undefined }),
      }),
    }),
  };
}

let tmpRoot: string | undefined;
let cvDir: string | undefined;
let outputRoot: string | undefined;
let scanRunId: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-exec-'));
  cvDir = join(tmpRoot, 'cv');
  outputRoot = join(tmpRoot, 'scan');
  scanRunId = 'scan-test-001';
  mkdirSync(cvDir, { recursive: true });
  mkdirSync(join(outputRoot, scanRunId), { recursive: true });
  (globalThis as { __cvDir?: string }).__cvDir = cvDir;
  (globalThis as { __outputRoot?: string }).__outputRoot = outputRoot;
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

/* ============================ parseControllerActions ============================ */

describe('Phase 3 #I parseControllerActions', () => {
  it('识别 [Route] + [HttpGet] 单 endpoint', () => {
    const src = `
[ApiController]
[Route("api/[controller]")]
public class OrderController : ControllerBase
{
    [HttpGet("{id}")]
    public ActionResult<OrderDto> GetById(int id) { return null; }
}
`;
    const routes = parseControllerActions(src, 'Controllers/OrderController.cs');
    expect(routes.length).toBe(1);
    expect(routes[0]?.http_method).toBe('GET');
    expect(routes[0]?.controller).toBe('OrderController');
    expect(routes[0]?.action).toBe('GetById');
    expect(routes[0]?.path).toBe('/api/[controller]/{id}');
    expect(routes[0]?.binding_sources).toEqual([]);
  });

  it('识别 [HttpPost] + [FromBody]', () => {
    const src = `
[ApiController]
[Route("api/users")]
public class UserController : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateUserDto dto) { return Ok(); }
}
`;
    const routes = parseControllerActions(src, 'UserController.cs');
    expect(routes.length).toBe(1);
    expect(routes[0]?.http_method).toBe('POST');
    expect(routes[0]?.binding_sources).toContain('FromBody');
  });

  it('多个 action,带 [FromQuery] / [FromRoute]', () => {
    const src = `
[ApiController]
[Route("api/orders")]
public class OrderController : ControllerBase
{
    [HttpGet]
    public IActionResult List([FromQuery] int page, [FromQuery] int size) { return Ok(); }
    [HttpGet("{id}")]
    public IActionResult Get(int id) { return Ok(); }
    [HttpDelete("{id}")]
    public IActionResult Delete(int id) { return NoContent(); }
}
`;
    const routes = parseControllerActions(src, 'OC.cs');
    expect(routes.length).toBe(3);
    const list = routes.find((r) => r.action === 'List');
    expect(list?.binding_sources).toContain('FromQuery');
    const get = routes.find((r) => r.action === 'Get');
    expect(get?.http_method).toBe('GET');
    const del = routes.find((r) => r.action === 'Delete');
    expect(del?.http_method).toBe('DELETE');
  });
});

/* ============================ parseMinimalApiRoutes ============================ */

describe('Phase 3 #I parseMinimalApiRoutes', () => {
  it('识别 MapGet / MapPost', () => {
    const src = `
var app = WebApplication.CreateBuilder(args).Build();
app.MapGet("/health", () => "ok");
app.MapPost("/api/login", (LoginDto dto) => Results.Ok());
app.MapDelete("/api/users/{id}", (int id) => Results.NoContent());
`;
    const routes = parseMinimalApiRoutes(src, 'Program.cs');
    expect(routes.length).toBe(3);
    expect(routes.map((r) => r.http_method).sort()).toEqual(['DELETE', 'GET', 'POST']);
  });
});

/* ============================ runRouteMapperSkill ============================ */

describe('Phase 3 #I runRouteMapperSkill', () => {
  it('fixture 一个 OrderController.cs,生成 routes.json,断言 3 个 endpoint', async () => {
    if (!cvDir || !outputRoot) throw new Error('fixture not ready');
    writeFileSync(
      join(cvDir, 'OrderController.cs'),
      `
[ApiController]
[Route("api/orders")]
public class OrderController : ControllerBase
{
    [HttpGet] public IActionResult List() => Ok();
    [HttpGet("{id}")] public IActionResult Get(int id) => Ok();
    [HttpPost] public IActionResult Create([FromBody] object dto) => Ok();
}
`,
    );

    const { SkillExecutorService } = await import('./skill-executor.service.js');
    const db = createFakeDb({
      run: { id: scanRunId, codeVersionId: 'cv-1', skillBundleId: 'sb-1', coverageMode: 'FULL' },
      cv: { id: 'cv-1' },
      bundle: { id: 'sb-1', gitCommit: 'abcdef1234' },
    });
    const svc = new SkillExecutorService(db as unknown as never, makeStorageMock() as never);
    const result = await svc.runRouteMapperSkill(scanRunId);

    expect(result.skillName).toBe('dotnet-route-mapper');
    expect(result.recordCount).toBe(3);
    expect(result.outputFiles.length).toBe(2);

    // 验 routes_{ts}.json
    const jsonPath = join(outputRoot, scanRunId, result.outputFiles[0] ?? '');
    expect(existsSync(jsonPath)).toBe(true);
    const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
      routes: Array<{ http_method: string; controller: string; action: string; route_id: string }>;
      skill_name: string;
      git_commit: string;
    };
    expect(json.skill_name).toBe('dotnet-route-mapper');
    expect(json.git_commit).toBe('abcdef1234');
    expect(json.routes.length).toBe(3);
    expect(json.routes[0]?.route_id).toBe('1');
    expect(json.routes.map((r) => r.http_method).sort()).toEqual(['GET', 'GET', 'POST']);

    // 验 routes_{ts}.md
    const mdPath = join(outputRoot, scanRunId, result.outputFiles[1] ?? '');
    expect(existsSync(mdPath)).toBe(true);
    const md = readFileSync(mdPath, 'utf8');
    expect(md).toContain('# Routes');
    expect(md).toContain('OrderController');
  });
});

/* ============================ runFrameworkAuditSkill ============================ */

describe('Phase 3 #I runFrameworkAuditSkill', () => {
  it('fixture .csproj,生成 framework_audit/aspnetcore_xxx.md,断言 framework version', async () => {
    if (!cvDir || !outputRoot) throw new Error('fixture not ready');
    writeFileSync(
      join(cvDir, 'Demo.csproj'),
      `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`,
    );

    const { SkillExecutorService } = await import('./skill-executor.service.js');
    const db = createFakeDb({
      run: { id: scanRunId, codeVersionId: 'cv-1', skillBundleId: 'sb-1', coverageMode: 'SAMPLE' },
      cv: { id: 'cv-1' },
      bundle: { id: 'sb-1', gitCommit: 'fff0001234' },
    });
    const svc = new SkillExecutorService(db as unknown as never, makeStorageMock() as never);
    const result = await svc.runFrameworkAuditSkill(scanRunId, 'aspnetcore');

    expect(result.skillName).toBe('dotnet-aspnetcore-audit');
    expect(result.recordCount).toBe(1);
    expect(result.outputFiles.length).toBe(1);

    const mdPath = join(outputRoot, scanRunId, result.outputFiles[0] ?? '');
    expect(existsSync(mdPath)).toBe(true);
    const md = readFileSync(mdPath, 'utf8');
    expect(md).toContain('net8.0');
    expect(md).toContain('中间件顺序');
    expect(md).toContain('端点暴露面');
    expect(md).toContain('Demo.csproj');
  });
});

/* ============================ runVulnScannerSkill ============================ */

describe('Phase 3 #I runVulnScannerSkill', () => {
  it('fixture PackageReference,生成 vuln_audit/nuget_xxx.md', async () => {
    if (!cvDir || !outputRoot) throw new Error('fixture not ready');
    writeFileSync(
      join(cvDir, 'Demo.csproj'),
      `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />
    <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="8.0.0" />
  </ItemGroup>
</Project>`,
    );

    const { SkillExecutorService } = await import('./skill-executor.service.js');
    const db = createFakeDb({
      run: { id: scanRunId, codeVersionId: 'cv-1', skillBundleId: 'sb-1', coverageMode: 'FULL' },
      cv: { id: 'cv-1' },
      bundle: { id: 'sb-1', gitCommit: 'ccc1111234' },
    });
    const svc = new SkillExecutorService(db as unknown as never, makeStorageMock() as never);
    const result = await svc.runVulnScannerSkill(scanRunId);

    expect(result.skillName).toBe('dotnet-vuln-scanner');
    expect(result.recordCount).toBe(2);

    const mdPath = join(outputRoot, scanRunId, result.outputFiles[0] ?? '');
    expect(existsSync(mdPath)).toBe(true);
    const md = readFileSync(mdPath, 'utf8');
    expect(md).toContain('Newtonsoft.Json');
    expect(md).toContain('13.0.1');
    expect(md).toContain('JwtBearer');
  });
});

/* ============================ runExploitChainSkill ============================ */

describe('Phase 3 #I runExploitChainSkill', () => {
  it('无 vuln → 写"未发现"声明', async () => {
    if (!outputRoot) throw new Error('fixture not ready');
    const { SkillExecutorService } = await import('./skill-executor.service.js');
    const db = createFakeDb({
      run: { id: scanRunId, codeVersionId: 'cv-1', skillBundleId: 'sb-1', coverageMode: 'FULL' },
      cv: { id: 'cv-1' },
      bundle: { id: 'sb-1', gitCommit: 'ddd2222234' },
      vulns: [],
    });
    const svc = new SkillExecutorService(db as unknown as never, makeStorageMock() as never);
    const result = await svc.runExploitChainSkill(scanRunId);

    expect(result.recordCount).toBe(0);
    const mdPath = join(outputRoot, scanRunId, result.outputFiles[0] ?? '');
    const md = readFileSync(mdPath, 'utf8');
    expect(md).toContain('未发现可拼接利用链');
  });

  it('有 vuln → 写链路总览表 + 单链路详情', async () => {
    if (!outputRoot) throw new Error('fixture not ready');
    const { SkillExecutorService } = await import('./skill-executor.service.js');
    const db = createFakeDb({
      run: { id: scanRunId, codeVersionId: 'cv-1', skillBundleId: 'sb-1', coverageMode: 'FULL' },
      cv: { id: 'cv-1' },
      bundle: { id: 'sb-1', gitCommit: 'eee3333234' },
      vulns: [
        {
          id: 'vul-1',
          scanRunId,
          filePath: 'A.cs',
          vulnType: 'sql-injection',
          fixSuggestion: 'use parameter',
        },
        {
          id: 'vul-2',
          scanRunId,
          filePath: 'B.cs',
          vulnType: 'xss',
          fixSuggestion: 'encode output',
        },
      ],
    });
    const svc = new SkillExecutorService(db as unknown as never, makeStorageMock() as never);
    const result = await svc.runExploitChainSkill(scanRunId);

    expect(result.recordCount).toBe(2);
    const mdPath = join(outputRoot, scanRunId, result.outputFiles[0] ?? '');
    const md = readFileSync(mdPath, 'utf8');
    expect(md).toContain('CHAIN-1');
    expect(md).toContain('CHAIN-2');
    expect(md).toContain('vul-1');
  });
});

/* ============================ 集成测试 ============================ */

describe('Phase 3 #I 集成:scan 跑完 4 个 skill 都产文件', () => {
  it('outputRoot 真有 4 个目录,每个有 real 文件', async () => {
    if (!cvDir || !outputRoot) throw new Error('fixture not ready');
    // 1 controller + 1 csproj + 1 packages
    writeFileSync(
      join(cvDir, 'OrderController.cs'),
      `[ApiController]
[Route("api/orders")]
public class OrderController : ControllerBase
{
    [HttpGet] public IActionResult List() => Ok();
    [HttpPost] public IActionResult Create([FromBody] object dto) => Ok();
}
`,
    );
    writeFileSync(
      join(cvDir, 'Demo.csproj'),
      `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />
  </ItemGroup>
</Project>`,
    );

    const { SkillExecutorService } = await import('./skill-executor.service.js');
    const db = createFakeDb({
      run: { id: scanRunId, codeVersionId: 'cv-1', skillBundleId: 'sb-1', coverageMode: 'FULL' },
      cv: { id: 'cv-1' },
      bundle: { id: 'sb-1', gitCommit: 'aaa9999' },
    });
    const svc = new SkillExecutorService(db as unknown as never, makeStorageMock() as never);

    // 跑 4 个 skill
    await svc.runRouteMapperSkill(scanRunId);
    await svc.runFrameworkAuditSkill(scanRunId, 'aspnetcore');
    await svc.runVulnScannerSkill(scanRunId);
    await svc.runExploitChainSkill(scanRunId);

    // 验证 4 个目录
    const scanRoot = join(outputRoot, scanRunId);
    const expectedDirs = ['route_mapping', 'framework_audit', 'vuln_audit', 'exploit_chain'];
    for (const d of expectedDirs) {
      const p = join(scanRoot, d);
      expect(existsSync(p), `expected dir ${d} to exist`).toBe(true);
      const files = readdirSync(p);
      expect(files.length, `dir ${d} should have files`).toBeGreaterThan(0);
    }
  });
});
