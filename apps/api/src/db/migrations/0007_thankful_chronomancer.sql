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
CREATE INDEX `agent_traces_scan_run_idx` ON `agent_traces` (`scan_run_id`);--> statement-breakpoint
CREATE INDEX `agent_traces_index_idx` ON `agent_traces` (`scan_run_id`,`trace_index`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_hash_idx` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
ALTER TABLE `code_versions` ADD `cloned_at` integer;--> statement-breakpoint
ALTER TABLE `code_versions` ADD `clone_error_message` text;--> statement-breakpoint
ALTER TABLE `skill_bundle_versions` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `skill_bundle_versions` ADD `published_at` integer;--> statement-breakpoint
CREATE INDEX `skill_bundle_default_idx` ON `skill_bundle_versions` (`is_default`);