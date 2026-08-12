CREATE TYPE "public"."shadow_status" AS ENUM('valid', 'validation_failed', 'render_failed', 'llm_failed');--> statement-breakpoint
CREATE TABLE "factual_shadow_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expediente_id" uuid,
	"municipality_ine" text,
	"query" text NOT NULL,
	"shadow_model" text NOT NULL,
	"shadow_status" "shadow_status" NOT NULL,
	"latency_ms" integer NOT NULL,
	"validation_errors" jsonb,
	"structured_output" jsonb,
	"rendered_answer" text,
	"pipeline_version" text
);
--> statement-breakpoint
ALTER TABLE "factual_shadow_evaluations" ADD CONSTRAINT "factual_shadow_evaluations_expediente_id_expedientes_id_fk" FOREIGN KEY ("expediente_id") REFERENCES "public"."expedientes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "factual_shadow_eval_created_at_idx" ON "factual_shadow_evaluations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "factual_shadow_eval_exp_id_idx" ON "factual_shadow_evaluations" USING btree ("expediente_id");
--> statement-breakpoint
ALTER TABLE "public"."factual_shadow_evaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."factual_shadow_evaluations" FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "public"."factual_shadow_evaluations" FROM public, anon, authenticated;
REVOKE ALL PRIVILEGES ON TYPE "public"."shadow_status" FROM public, anon, authenticated;
GRANT SELECT, INSERT ON TABLE "public"."factual_shadow_evaluations" TO service_role;
GRANT USAGE ON TYPE "public"."shadow_status" TO service_role;