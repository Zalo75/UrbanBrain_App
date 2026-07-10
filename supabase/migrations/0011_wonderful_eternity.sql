CREATE TYPE "public"."update_type" AS ENUM('modification', 'derogation', 'correction', 'addition');--> statement-breakpoint
CREATE TABLE "normative_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"category" "normative_category_v2" NOT NULL,
	"authority" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "normative_families_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD COLUMN "normative_family_id" uuid;--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD COLUMN "current_version" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "normative_documents_v2" ADD CONSTRAINT "normative_documents_v2_normative_family_id_normative_families_id_fk" FOREIGN KEY ("normative_family_id") REFERENCES "public"."normative_families"("id") ON DELETE no action ON UPDATE no action;