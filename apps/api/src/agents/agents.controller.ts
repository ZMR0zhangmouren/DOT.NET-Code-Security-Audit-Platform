import { Controller, Get } from '@nestjs/common';

import { loadAgentInstructions } from './loader.js';

/**
 * Agent PoC —— 暴露一组只读端点验证 @openai/agents SDK + 子仓库 agent.md 的装配能跑通。
 *
 * 端点:
 * - GET /agents/poc/load   加载子仓库 SKILL.md + agent.md,返回拼接后的 instructions 长度
 * - GET /agents/poc/health Agent SDK 是否安装
 *
 * 不调用真实 LLM(避免烧 token);只做静态装配与存在性校验。
 * 真实 Runner 接入在 Phase 1 §5.3 主流程里完成。
 */
@Controller('agents/poc')
export class AgentsPocController {
  @Get('health')
  health(): { sdkInstalled: boolean } {
    let sdkInstalled = false;
    try {
      // 动态 require 探测 SDK 是否装入(避免启动期 hard dep)

      sdkInstalled = Boolean(require.resolve('@openai/agents'));
    } catch {
      sdkInstalled = false;
    }
    return { sdkInstalled };
  }

  @Get('load')
  async load(): Promise<{
    pipelineChars: number;
    mainAgentChars: number;
    combinedChars: number;
    sharedRefsCount: number;
  }> {
    const { pipeline, mainAgent, combined, sharedRefs } = await loadAgentInstructions();
    return {
      pipelineChars: pipeline.length,
      mainAgentChars: mainAgent.length,
      combinedChars: combined.length,
      sharedRefsCount: sharedRefs.split('\n').length,
    };
  }
}
