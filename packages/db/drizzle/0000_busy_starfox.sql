CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"repo_url" text NOT NULL,
	"source_version" text NOT NULL,
	"target_version" text NOT NULL,
	"ecosystem" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bob_task_id" text NOT NULL,
	"transport" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "mcp_sessions_bob_task_id_unique" UNIQUE("bob_task_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"input_hash" text NOT NULL,
	"response_hash" text,
	"duration_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input" jsonb,
	"output" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "web_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"session_cookie" text NOT NULL,
	"provider" text DEFAULT 'auto' NOT NULL,
	"client_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_session_id_mcp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mcp_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_session_id_mcp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mcp_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "web_jobs" ADD CONSTRAINT "web_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
