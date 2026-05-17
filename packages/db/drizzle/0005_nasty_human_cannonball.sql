CREATE TABLE IF NOT EXISTS "signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"algorithm" text NOT NULL,
	"public_key_hex" text NOT NULL,
	"private_key_hex" text,
	"encrypted_private_key" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signing_keys" ADD CONSTRAINT "signing_keys_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signing_keys_job_algorithm_unique" ON "signing_keys" USING btree ("job_id","algorithm");