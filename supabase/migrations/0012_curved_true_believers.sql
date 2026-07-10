CREATE TABLE "legal_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_version_id" uuid NOT NULL,
	"target_version_id" uuid,
	"update_type" "update_type" NOT NULL,
	"official_publication" text NOT NULL,
	"official_identifier" text NOT NULL,
	"source_url" text NOT NULL,
	"source_hash" text NOT NULL,
	"publication_date" timestamp NOT NULL,
	"effective_date" timestamp,
	"applies_from" timestamp NOT NULL,
	"applies_until" timestamp,
	"affected_section" text NOT NULL,
	"previous_text" text,
	"replacement_text" text NOT NULL,
	"consolidation_order" integer NOT NULL,
	"summary" text,
	"processing_status" "legal_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "legal_updates" ADD CONSTRAINT "legal_updates_source_version_id_normative_documents_v2_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."normative_documents_v2"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD CONSTRAINT "legal_updates_target_version_id_normative_documents_v2_id_fk" FOREIGN KEY ("target_version_id") REFERENCES "public"."normative_documents_v2"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD CONSTRAINT "legal_updates_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_consolidation" ON "legal_updates" USING btree ("source_version_id","official_identifier","affected_section");