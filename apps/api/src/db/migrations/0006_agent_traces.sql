-- Phase 3 §1.2/2.7 AgentTrace —— 主 Agent 调 LLM 的每条 message + tool_call 持久化
-- 兑现 §1.2 目标 4 "可观测、可复现" + §10.3 "主 Agent Trace 检索 (P2)"
CREATE TABLE `agent_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`trace_index` integer NOT NULL,
	`role` text NOT NULL,
	`content` text,
	`tool_calls` text,
	`tool_call_id` text,
	`finish_reason` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`model` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_traces_scan_run_idx` ON `agent_traces` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `agent_traces_index_idx` ON `agent_traces` (`scan_run_id`, `trace_index`);