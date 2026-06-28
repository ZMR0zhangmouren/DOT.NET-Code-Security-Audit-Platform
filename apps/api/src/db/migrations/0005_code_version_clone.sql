-- §5.7 真接 git clone —— 给 code_versions 加克隆时间 + 错误信息
ALTER TABLE `code_versions` ADD COLUMN `cloned_at` integer;--> statement-breakpoint
ALTER TABLE `code_versions` ADD COLUMN `clone_error_message` text;
