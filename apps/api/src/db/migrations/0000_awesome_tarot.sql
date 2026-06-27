CREATE TABLE `code_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version_label` text NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`file_count` integer,
	`loc_count` integer,
	`size_bytes` integer,
	`parent_version_id` text,
	`uploaded_by` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`checksum` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `code_versions_project_idx` ON `code_versions` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `code_versions_checksum_unique` ON `code_versions` (`checksum`);--> statement-breakpoint
CREATE TABLE `evidence_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`field_name` text NOT NULL,
	`source_a_path` text NOT NULL,
	`source_a_value` text NOT NULL,
	`source_b_path` text NOT NULL,
	`source_b_value` text NOT NULL,
	`resolution` text DEFAULT 'UNRESOLVED' NOT NULL,
	`resolution_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_conflicts_field_idx` ON `evidence_conflicts` (`field_name`);--> statement-breakpoint
CREATE INDEX `evidence_conflicts_resolution_idx` ON `evidence_conflicts` (`resolution`);--> statement-breakpoint
CREATE TABLE `pending_risk_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`code_version_id` text NOT NULL,
	`risk_type` text NOT NULL,
	`source_skill` text NOT NULL,
	`file_path` text NOT NULL,
	`line_start` integer NOT NULL,
	`line_end` integer NOT NULL,
	`code_snippet` text NOT NULL,
	`static_hit` text,
	`trace_status` text NOT NULL,
	`missing_evidence` text NOT NULL,
	`blocking_reason` text NOT NULL,
	`backfill_plan` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`code_version_id`) REFERENCES `code_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `risk_pool_scan_trace_idx` ON `pending_risk_pool` (`scan_run_id`,`trace_status`);--> statement-breakpoint
CREATE INDEX `risk_pool_project_trace_idx` ON `pending_risk_pool` (`project_id`,`trace_status`);--> statement-breakpoint
CREATE TABLE `pipeline_quality_gates` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`gate_type` text NOT NULL,
	`file_path` text NOT NULL,
	`status` text NOT NULL,
	`details` text,
	`decision_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gate_scan_type_unique` ON `pipeline_quality_gates` (`scan_run_id`,`gate_type`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_role` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE `proxy_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`protocol` text,
	`host` text,
	`port` integer,
	`username` text,
	`password_enc` text,
	`apply_to` text DEFAULT 'all_outbound' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	`test_status` text DEFAULT 'unknown' NOT NULL,
	`test_message` text
);
--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`code_version_id` text NOT NULL,
	`skill_bundle_id` text NOT NULL,
	`status` text NOT NULL,
	`triggered_by` text NOT NULL,
	`trigger_type` text NOT NULL,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`duration_sec` integer,
	`log_path` text,
	`report_path` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`coverage_mode` text DEFAULT 'FULL' NOT NULL,
	`audit_surface_status` text DEFAULT 'NOT_RUN' NOT NULL,
	`api_coverage_status` text DEFAULT 'NOT_RUN' NOT NULL,
	`pipeline_execution` text DEFAULT 'NOT_RUN' NOT NULL,
	`gate_decision` text DEFAULT 'PENDING' NOT NULL,
	`controller_coverage_percent` integer,
	`auth_coverage_percent` integer,
	`trace_batch_max_size` integer DEFAULT 10 NOT NULL,
	`trace_batch_plan_path` text,
	`output_root` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`code_version_id`) REFERENCES `code_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_bundle_id`) REFERENCES `skill_bundle_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scan_runs_project_idx` ON `scan_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `scan_runs_status_idx` ON `scan_runs` (`status`);--> statement-breakpoint
CREATE INDEX `scan_runs_coverage_idx` ON `scan_runs` (`coverage_mode`);--> statement-breakpoint
CREATE TABLE `skill_bundle_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`git_commit` text NOT NULL,
	`snapshot_path` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `skill_bundle_active_idx` ON `skill_bundle_versions` (`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `skill_bundle_version_unique` ON `skill_bundle_versions` (`version`);--> statement-breakpoint
CREATE TABLE `skill_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`skill_name` text NOT NULL,
	`skill_type` text NOT NULL,
	`skill_path` text NOT NULL,
	`execution_status` text NOT NULL,
	`findings_status` text NOT NULL,
	`primary_outputs` text NOT NULL,
	`depends_on` text NOT NULL,
	`trace_refs` text,
	`exploitability` text,
	`notes` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_sec` integer,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_exec_scan_skill_unique` ON `skill_executions` (`scan_run_id`,`skill_name`);--> statement-breakpoint
CREATE INDEX `skill_exec_scan_status_idx` ON `skill_executions` (`scan_run_id`,`execution_status`);--> statement-breakpoint
CREATE TABLE `unmapped_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`candidate_path` text NOT NULL,
	`detected_signal` text NOT NULL,
	`controller_class` text,
	`backfill_attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`abandon_reason` text,
	`last_attempted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `unmapped_scan_status_idx` ON `unmapped_routes` (`scan_run_id`,`status`);--> statement-breakpoint
CREATE INDEX `unmapped_project_status_idx` ON `unmapped_routes` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'developer' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vuln_library_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`vuln_type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`severity_max` text NOT NULL,
	`cvss_max` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`first_seen_run_id` text NOT NULL,
	`first_seen_version_id` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_run_id` text NOT NULL,
	`last_seen_version_id` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`fixed_in_version_id` text,
	`fixed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vuln_library_project_fingerprint_unique` ON `vuln_library_entries` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `vuln_library_project_status_idx` ON `vuln_library_entries` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `vuln_library_project_type_idx` ON `vuln_library_entries` (`project_id`,`vuln_type`);--> statement-breakpoint
CREATE INDEX `vuln_library_project_severity_idx` ON `vuln_library_entries` (`project_id`,`severity_max`);--> statement-breakpoint
CREATE TABLE `vulnerabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`code_version_id` text NOT NULL,
	`library_id` text,
	`vuln_type` text NOT NULL,
	`severity` text NOT NULL,
	`cvss_score` integer,
	`fingerprint` text NOT NULL,
	`file_path` text NOT NULL,
	`line_start` integer NOT NULL,
	`line_end` integer NOT NULL,
	`code_snippet` text NOT NULL,
	`exploit_payload` text,
	`fix_suggestion` text NOT NULL,
	`evidence_refs` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` text,
	`fixed_in_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`code_version_id`) REFERENCES `code_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`library_id`) REFERENCES `vuln_library_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vulns_library_idx` ON `vulnerabilities` (`library_id`);--> statement-breakpoint
CREATE INDEX `vulns_scan_run_idx` ON `vulnerabilities` (`scan_run_id`);--> statement-breakpoint
CREATE INDEX `vulns_fingerprint_idx` ON `vulnerabilities` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `vulns_project_status_idx` ON `vulnerabilities` (`project_id`,`status`);