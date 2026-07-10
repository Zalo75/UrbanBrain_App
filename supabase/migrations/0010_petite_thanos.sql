CREATE TYPE "public"."legal_review_status" AS ENUM('pending', 'reviewed', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."normative_status_v2" ADD VALUE 'en_revision';--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD COLUMN "source_publication_date" timestamp;--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD COLUMN "version_label" text;--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD COLUMN "is_consolidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD COLUMN "consolidation_date" timestamp;--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD COLUMN "amendment_notes" text;--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD COLUMN "legal_review_status" "legal_review_status" DEFAULT 'pending' NOT NULL;