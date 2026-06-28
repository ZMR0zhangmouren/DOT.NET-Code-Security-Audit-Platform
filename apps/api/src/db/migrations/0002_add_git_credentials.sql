CREATE TABLE `git_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`host_pattern` text NOT NULL,
	`username` text,
	`secret_enc` text NOT NULL,
	`fingerprint` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `git_credentials_active_idx` ON `git_credentials` (`is_active`);--> statement-breakpoint
CREATE INDEX `git_credentials_scope_project_idx` ON `git_credentials` (`scope`,`project_id`);--> statement-breakpoint
CREATE INDEX `git_credentials_host_pattern_idx` ON `git_credentials` (`host_pattern`);