import { describe, it, expect, vi } from 'vitest';

// §2.0 / §2.5 AgentLoader 单测:
// parseSkillFrontmatter 是纯函数,loadAgentInstructions 用 mock fs readFile

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    const norm = String(path).replace(/\\/g, '/');
    if (norm.endsWith('dotnet-audit-pipeline/SKILL.md')) {
      return '# PIPELINE CONTENT';
    }
    if (norm.endsWith('dotnet代码审计.agent.md')) {
      return '# MAIN AGENT CONTENT';
    }
    throw new Error(`unexpected path: ${path}`);
  }),
}));

describe('parseSkillFrontmatter (pure)', () => {
  it('无 frontmatter → {}', async () => {
    const { parseSkillFrontmatter } = await import('./loader.js');
    expect(parseSkillFrontmatter('# Title\nBody')).toEqual({});
  });

  it('只有 name → { name }', async () => {
    const { parseSkillFrontmatter } = await import('./loader.js');
    expect(parseSkillFrontmatter('---\nname: auth-audit\n---\nbody')).toEqual({
      name: 'auth-audit',
    });
  });

  it('只有 description → { description }', async () => {
    const { parseSkillFrontmatter } = await import('./loader.js');
    expect(parseSkillFrontmatter('---\ndescription: My desc\n---\nbody')).toEqual({
      description: 'My desc',
    });
  });

  it('name + description 都存在', async () => {
    const { parseSkillFrontmatter } = await import('./loader.js');
    const md = '---\nname: vuln-scanner\ndescription: Scan for vulns\n---\n# body';
    expect(parseSkillFrontmatter(md)).toEqual({
      name: 'vuln-scanner',
      description: 'Scan for vulns',
    });
  });

  it('frontmatter 里有未知 key → 忽略', async () => {
    const { parseSkillFrontmatter } = await import('./loader.js');
    const md = '---\nname: x\nfoo: bar\n---\nbody';
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'x' });
  });

  it('frontmatter 跨多行 → 整体作为 body,只解析每行 key:value', async () => {
    const { parseSkillFrontmatter } = await import('./loader.js');
    const md = '---\nname: multi\ndescription: line1\n  line2\n---\nbody';
    // 第二行 description 没匹配(因为不是 line1 结尾)
    expect(parseSkillFrontmatter(md).name).toBe('multi');
  });
});

describe('loadAgentInstructions (mocked fs)', () => {
  it('happy path → pipeline + mainAgent + sharedRefs + combined', async () => {
    const { loadAgentInstructions } = await import('./loader.js');
    const out = await loadAgentInstructions('/tmp/fake-bundle');
    expect(out.pipeline).toBe('# PIPELINE CONTENT');
    expect(out.mainAgent).toBe('# MAIN AGENT CONTENT');
    expect(out.sharedRefs).toContain('shared/EVIDENCE_POINT_IDS.md');
    expect(out.sharedRefs).toContain('shared/SEVERITY_RATING.md');
    expect(out.combined).toContain('# 顶层编排方法论');
    expect(out.combined).toContain('# PIPELINE CONTENT');
    expect(out.combined).toContain('# MAIN AGENT CONTENT');
    expect(out.combined).toContain('# shared 规范索引');
    // sharedRefs 含 9 行
    expect(out.sharedRefs.split('\n')).toHaveLength(9);
  });
});
