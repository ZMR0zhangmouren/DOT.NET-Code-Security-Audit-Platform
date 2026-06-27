CREATE TABLE `ai_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_enc` text NOT NULL,
	`default_model` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`available_models` text NOT NULL,
	`last_test_at` integer,
	`last_test_status` text DEFAULT 'unknown' NOT NULL,
	`last_test_message` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_keys_active_idx` ON `ai_keys` (`is_active`);--> statement-breakpoint
CREATE INDEX `ai_keys_provider_idx` ON `ai_keys` (`provider`);