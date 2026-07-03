CREATE TYPE "public"."normative_scope" AS ENUM('estatal', 'autonomico', 'provincial', 'municipal', 'sectorial');--> statement-breakpoint
CREATE TYPE "public"."normative_source" AS ENUM('SIOTUGA', 'CTE', 'NHG', 'sectorial', 'manual');--> statement-breakpoint
CREATE TABLE "normativa_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normativa_document_id" uuid NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"embedding" vector(3072),
	"chunk_index" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normativa_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text,
	"title" text NOT NULL,
	"original_path" text,
	"scope_type" "normative_scope" NOT NULL,
	"ccaa" text,
	"province" text,
	"municipality_id" text,
	"municipality_name" text,
	"document_type" text,
	"source_system" "normative_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "normativa_documents_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "normativa_chunks" ADD CONSTRAINT "normativa_chunks_normativa_document_id_normativa_documents_id_fk" FOREIGN KEY ("normativa_document_id") REFERENCES "public"."normativa_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "normativa_embedding_idx" ON "normativa_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "normativa_scope_idx" ON "normativa_documents" USING btree ("scope_type");--> statement-breakpoint
CREATE INDEX "normativa_muni_idx" ON "normativa_documents" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "normativa_ccaa_idx" ON "normativa_documents" USING btree ("ccaa");--> statement-breakpoint
CREATE INDEX "normativa_source_system_idx" ON "normativa_documents" USING btree ("source_system");