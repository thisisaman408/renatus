CREATE TABLE IF NOT EXISTS "generated_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"patch_id" uuid,
	"file_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"framework" text NOT NULL,
	"strategy" text NOT NULL,
	"file_path" text NOT NULL,
	"test_contents" text NOT NULL,
	"passes" boolean,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_tests" ADD CONSTRAINT "generated_tests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_tests" ADD CONSTRAINT "generated_tests_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_tests" ADD CONSTRAINT "generated_tests_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_tests" ADD CONSTRAINT "generated_tests_snapshot_id_repo_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repo_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_tests_job_idx" ON "generated_tests" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_tests_snapshot_framework_idx" ON "generated_tests" USING btree ("snapshot_id","framework");