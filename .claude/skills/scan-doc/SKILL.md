---
name: scan-doc
description: 扫 ./需求文档.md 残留的过时表述(LangGraph / Orchestrator 等),并核对 §2.8 Pipeline 编排硬约束、§2.9 落盘目录规范、§4.2.10–4.2.14 五个新实体、§5.4 报告 9 章节是否齐全。
---

# /scan-doc

定期体检 `./需求文档.md`,确保没有历史脏数据、未对齐 README 2026-06 补强的关键章节。

## 触发方式

- `/scan-doc` —— 全量扫描
- `/scan-doc --stale` —— 只查过时表述
- `/scan-doc --gates` —— 只查覆盖门禁章节完整性
- `/scan-doc --entities` —— 只查数据模型新实体
- `/scan-doc --report` —— 只查报告章节齐全度

## 检查清单

### 1. 过时表述(应替换或已删除)

| 关键词 | 应替换为 | 备注 |
|--------|---------|------|
| `LangGraph` | 删除 / `OpenAI Agents SDK` | 早期 §5.6 提到,已删除 |
| `ScanRun Orchestrator` | `ScanRun Driver` | 平台侧只负责调度,不负责编排 |
| `SkillLoader + AgentRegistry + Runner` | 删除 | 平台不重做编排,直接加载 agent.md |
| `平台自建编排` | `平台加载 agent.md 作为 instructions` | Q17 锁定 |
| `主 Agent 加载 → 由 Copilot 解析` | `平台直接读 agents/dotnet代码审计.agent.md` | §2.2 已修订 |
| `统一编排器` 仅指 agent.md | 改为指 `dotnet-audit-pipeline/SKILL.md` | §2.0 / §2.5 已锁定 |
| `只读漏洞列表(无状态流转)` | `漏洞库级状态流转进 MVP` | Q8 已锁定部分流转 |

### 2. §2.8 覆盖门禁必备子节(9 条)

```
[ ] §2.8.1 入口覆盖模式与门禁(FULL/SAMPLE)
[ ] §2.8.2 Controller Inventory 对账门禁
[ ] §2.8.3 Route Mapping 循环补图门禁
[ ] §2.8.4 trace_batch_plan 阈值
[ ] §2.8.5 API Coverage Gate
[ ] §2.8.6 双完成态联动
[ ] §2.8.7 收尾双保险流程(CHECKPOINT A/B/C + STOP)
[ ] §2.8.8 BLOCKED 语义汇总
[ ] §2.8.9 完整性约束
```

### 3. §4.2 数据模型新实体(5 条,§4.2.10–4.2.14)

```
[ ] §4.2.10 SkillExecution(execution_status 枚举 5 值)
[ ] §4.2.11 PipelineQualityGate(4 种 gate_type × 3 状态)
[ ] §4.2.12 EvidenceConflict
[ ] §4.2.13 PendingRiskPoolEntry
[ ] §4.2.14 UnmappedRoute
```

### 4. §5.4 报告必含章节(0–9)

```
[ ] §0 报告头部(双完成态)
[ ] §1 执行清单
[ ] §2 覆盖门禁摘要
[ ] §3 Skill 使用与发现矩阵
[ ] §3.1 入口覆盖矩阵
[ ] §3.2 Trace 覆盖矩阵
[ ] §3.3 Framework 覆盖矩阵
[ ] §3.4 Vulnerability 覆盖矩阵
[ ] §3.5 PoC 覆盖矩阵
[ ] §4 漏洞详情列表
[ ] §4.5 一致性核对摘要
[ ] §4.6 收尾锚点检查结果引用
[ ] §5 证据冲突与待复核项
[ ] §6 风险统计与利用链
[ ] §7 Trace 未闭合 / 待补证风险池
[ ] §8 exploit-chain 覆盖口径摘要
[ ] §9 收尾措辞块
```

### 5. §2.9 落盘目录必含子目录(9 个)

```
[ ] route_mapping/    [ ] auth_audit/    [ ] route_tracer/
[ ] vuln_audit/       [ ] vuln_poc/      [ ] framework_audit/
[ ] cross_analysis/   [ ] vuln_report/   [ ] quality/  (含 api_coverage_gate 等 5 个产物)
```

## 输出格式

```markdown
# /scan-doc 体检报告
**扫描时间**: YYYY-MM-DD HH:MM
**总章节数**: N / **过时表述数**: N / **缺失章节数**: N

## ⚠️ 过时表述(N)
- [line:N] "LangGraph 节点编排可视化" → 应删除(Q14 已锁定 @openai/agents)

## ❌ 缺失章节(N)
- §2.8.5 API Coverage Gate(必备)

## ✅ 通过的检查项
- §2.8.1–§2.8.9(9/9)
- §4.2.10–§4.2.14(5/5)
- §5.4 §0–§9(完整)
- ...
```

## 注意事项

- 不修改文档,只列问题
- §11 决策表若与上述期望不一致,**优先信任 §11**(因为决策表是真理之源);反之则提示"§11 与文档其它处冲突,先决策表修订"