CREATE TABLE `code_health_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`file_path` text,
	`before_score` real,
	`after_score` real,
	`issues_found` integer DEFAULT 0 NOT NULL,
	`issues_resolved` integer DEFAULT 0 NOT NULL,
	`iterations` integer DEFAULT 0 NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `code_health_file_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`file_path` text NOT NULL,
	`relative_path` text NOT NULL,
	`language` text NOT NULL,
	`score` real NOT NULL,
	`grade` text NOT NULL,
	`loc` integer DEFAULT 0 NOT NULL,
	`sloc_logical` integer DEFAULT 0 NOT NULL,
	`function_count` integer DEFAULT 0 NOT NULL,
	`avg_cyclomatic` real DEFAULT 0 NOT NULL,
	`max_cyclomatic` real DEFAULT 0 NOT NULL,
	`avg_cognitive` real DEFAULT 0 NOT NULL,
	`max_cognitive` real DEFAULT 0 NOT NULL,
	`maintainability_index` real DEFAULT 0 NOT NULL,
	`duplication_lines` integer DEFAULT 0 NOT NULL,
	`type_coverage_pct` real,
	`any_count` integer DEFAULT 0 NOT NULL,
	`nesting_depth_max` integer DEFAULT 0 NOT NULL,
	`issues_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `code_health_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `code_health_function_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`file_metric_id` text NOT NULL,
	`function_name` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`loc` integer DEFAULT 0 NOT NULL,
	`parameter_count` integer DEFAULT 0 NOT NULL,
	`cyclomatic` integer DEFAULT 0 NOT NULL,
	`cognitive` integer DEFAULT 0 NOT NULL,
	`halstead_effort` real DEFAULT 0 NOT NULL,
	`halstead_difficulty` real DEFAULT 0 NOT NULL,
	`halstead_volume` real DEFAULT 0 NOT NULL,
	`nesting_depth` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`file_metric_id`) REFERENCES `code_health_file_metrics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `code_health_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`directory_path` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`files_changed` text DEFAULT '[]' NOT NULL,
	`initial_scores_json` text DEFAULT '{}' NOT NULL,
	`final_scores_json` text DEFAULT '{}' NOT NULL,
	`total_iterations` integer DEFAULT 0 NOT NULL,
	`target_score` real DEFAULT 10 NOT NULL,
	`achieved_target` integer DEFAULT 0 NOT NULL,
	`max_iterations` integer DEFAULT 5 NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `code_health_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`directory_path` text NOT NULL,
	`workspace_id` text,
	`label` text,
	`overall_score` real NOT NULL,
	`grade` text NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`total_loc` integer DEFAULT 0 NOT NULL,
	`total_functions` integer DEFAULT 0 NOT NULL,
	`avg_cyclomatic` real DEFAULT 0 NOT NULL,
	`avg_cognitive` real DEFAULT 0 NOT NULL,
	`duplication_pct` real DEFAULT 0 NOT NULL,
	`type_coverage_pct` real,
	`config_json` text DEFAULT '{}' NOT NULL,
	`git_ref` text,
	`created_at` text NOT NULL
);
