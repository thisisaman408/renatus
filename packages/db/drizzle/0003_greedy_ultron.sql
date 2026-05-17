CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"agent_kind" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" uuid,
	"entity_type" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_job_id_idx" ON "audit_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_agent_kind_idx" ON "audit_events" USING btree ("agent_kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_event_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_job_timestamp_idx" ON "audit_events" USING btree ("job_id","timestamp");