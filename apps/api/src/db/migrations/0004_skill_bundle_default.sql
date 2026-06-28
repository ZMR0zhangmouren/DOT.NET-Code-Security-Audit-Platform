-- §11 Q7 双轨 C —— SkillBundleVersion 加 is_default / published_at 字段
-- is_default:标记默认 bundle(MVP 起步把 'sbv-mvp-001' 标为默认)
-- published_at:publish 动作时间戳,可空
ALTER TABLE `skill_bundle_versions` ADD COLUMN `is_default` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `skill_bundle_versions` ADD COLUMN `published_at` integer;
--> statement-breakpoint
CREATE INDEX `skill_bundle_default_idx` ON `skill_bundle_versions` (`is_default`);
--> statement-breakpoint
-- 把 MVP 默认 bundle 标为默认
UPDATE `skill_bundle_versions` SET `is_default` = true WHERE `id` = 'sbv-mvp-001';
