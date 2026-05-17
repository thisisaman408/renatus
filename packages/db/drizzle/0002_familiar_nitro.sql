CREATE TABLE IF NOT EXISTS "breaking_change_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"agent_kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"ecosystem" text,
	"from_version" text,
	"to_version" text,
	"rule_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "breaking_change_maps_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "breaking_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"path" text NOT NULL,
	"language" text NOT NULL,
	"sha" text NOT NULL,
	"size_bytes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"from_file_id" uuid NOT NULL,
	"to_file_id" uuid NOT NULL,
	"imported_symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_type_only" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"before" text NOT NULL,
	"after" text NOT NULL,
	"applied_rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"rationale" text,
	"retries" integer DEFAULT 0 NOT NULL,
	"llm_transcript_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repo_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"repo_url" text NOT NULL,
	"ref" text NOT NULL,
	"commit_sha" text NOT NULL,
	"local_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_exported" boolean DEFAULT false NOT NULL,
	"line" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "agent_kind" text DEFAULT 'migrate' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "breaking_changes" ADD CONSTRAINT "breaking_changes_map_id_breaking_change_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."breaking_change_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_snapshot_id_repo_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repo_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imports" ADD CONSTRAINT "imports_snapshot_id_repo_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repo_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imports" ADD CONSTRAINT "imports_from_file_id_files_id_fk" FOREIGN KEY ("from_file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imports" ADD CONSTRAINT "imports_to_file_id_files_id_fk" FOREIGN KEY ("to_file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patches" ADD CONSTRAINT "patches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patches" ADD CONSTRAINT "patches_snapshot_id_repo_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repo_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patches" ADD CONSTRAINT "patches_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repo_snapshots" ADD CONSTRAINT "repo_snapshots_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "symbols" ADD CONSTRAINT "symbols_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "breaking_changes_map_idx" ON "breaking_changes" USING btree ("map_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "files_snapshot_path_unique" ON "files" USING btree ("snapshot_id","path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_sha_idx" ON "files" USING btree ("sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "imports_to_from_idx" ON "imports" USING btree ("to_file_id","from_file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patches_job_idx" ON "patches" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patches_snapshot_status_idx" ON "patches" USING btree ("snapshot_id","status");