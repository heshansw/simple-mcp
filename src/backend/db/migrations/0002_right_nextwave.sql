CREATE TABLE `code_health_background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`workspace_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`score` real,
	`grade` text,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`trigger_tool` text NOT NULL,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL
);
