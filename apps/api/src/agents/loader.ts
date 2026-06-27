import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * AgentLoader —— 把子仓库 `dotnet-security-audit-skill/` 的两份核心文档
 * 拼装成 OpenAI Agent 的 instructions(头部 + 中部 + 尾部)。
 *
 * 这是 §2.0 / §2.2 / §2.3 / §2.5 的核心实现:
 * - 头部:dotnet-audit-pipeline/SKILL.md(总编排方法论)
 * - 中部:agents/dotnet代码审计.agent.md(执行约束、覆盖矩阵、漏洞模板)
 * - 尾部:shared 规范索引
 *
 * 平台不重写、不翻译、不重排,只拼接。
 */
export interface LoadedAgentInstructions {
  pipeline: string;
  mainAgent: string;
  sharedRefs: string;
  combined: string;
}

const PIPELINE_PATH = 'skills/dotnet-audit-pipeline/SKILL.md';
const MAIN_AGENT_PATH = 'agents/dotnet代码审计.agent.md';
const SHARED_FILES = [
  'shared/EVIDENCE_POINT_IDS.md',
  'shared/IO_PATH_CONVENTION.md',
  'shared/DOTNET_SINK_REFERENCE.md',
  'shared/DOTNET_AUDIT_GRABBER_INDEX.md',
  'shared/DOTNET_FRAMEWORK_SKILL_TEMPLATE.md',
  'shared/DOTNET_ROUTE_OUTPUT_TEMPLATES.md',
  'shared/DOTNET_VULN_POC_TEMPLATE.md',
  'shared/DOTNET_VULN_SKILL_TEMPLATE.md',
  'shared/SEVERITY_RATING.md',
] as const;

export async function loadAgentInstructions(
  skillBundleRoot: string = process.env['SKILL_BUNDLE_REPO_PATH'] ??
    '../dotnet-security-audit-skill',
): Promise<LoadedAgentInstructions> {
  const root = resolve(process.cwd(), skillBundleRoot);
  const pipeline = await readFile(resolve(root, PIPELINE_PATH), 'utf8');
  const mainAgent = await readFile(resolve(root, MAIN_AGENT_PATH), 'utf8');

  // shared 引用:仅列路径,真正内容由 Agent 按需读取,避免 prompt 过长
  const sharedRefs = SHARED_FILES.map((p) => `- ${p}`).join('\n');

  const combined = [
    '# 顶层编排方法论(来自 dotnet-audit-pipeline)',
    pipeline,
    '',
    '# 主 Agent 执行约束(来自 dotnet代码审计.agent.md)',
    mainAgent,
    '',
    '# shared 规范索引(按需读取)',
    sharedRefs,
  ].join('\n\n');

  return { pipeline, mainAgent, sharedRefs, combined };
}

/**
 * 解析子仓库里 SKILL.md 的 frontmatter,提取 name 与 description。
 * 这里只做 MVP 级别的解析,不依赖 gray-matter 等依赖。
 */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export function parseSkillFrontmatter(md: string): SkillFrontmatter {
  const match = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!match) return {};
  const body = match[1] ?? '';
  const result: SkillFrontmatter = {};
  for (const line of body.split('\n')) {
    const m = /^(name|description):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1] as keyof SkillFrontmatter;
    const value = m[2];
    if (key === 'name' || key === 'description') {
      result[key] = value;
    }
  }
  return result;
}
