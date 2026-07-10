CREATE TYPE "public"."authority_type_v2" AS ENUM('estado', 'comunidad_autonoma', 'ayuntamiento', 'diputacion', 'confederacion_hidrografica', 'organismo_publico', 'empresa_publica', 'otro');--> statement-breakpoint
CREATE TYPE "public"."exp_normative_origin" AS ENUM('manual', 'automatic');--> statement-breakpoint
CREATE TYPE "public"."exp_normative_status" AS ENUM('pending_review', 'active', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."language_v2" AS ENUM('es', 'gl', 'pt', 'ca', 'eu', 'en');--> statement-breakpoint
CREATE TYPE "public"."normative_category_v2" AS ENUM('CTE', 'NHG', 'PXOM', 'ordenanza', 'urbanismo_general', 'accesibilidad', 'incendios');--> statement-breakpoint
CREATE TYPE "public"."normative_scope_v2" AS ENUM('estatal', 'autonomico', 'municipal', 'especial');--> statement-breakpoint
CREATE TYPE "public"."normative_status_v2" AS ENUM('vigente', 'derogada', 'en_tramitacion');--> statement-breakpoint

CREATE TABLE "expediente_normative_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expediente_id" uuid NOT NULL,
	"scope_type" "normative_scope_v2" NOT NULL,
	"category" "normative_category_v2" NOT NULL,
	"status" "exp_normative_status" DEFAULT 'pending_review' NOT NULL,
	"origin" "exp_normative_origin" DEFAULT 'automatic' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normative_chunks_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"page" integer,
	"article" text,
	"chapter" text,
	"token_count" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normative_documents_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"scope_type" "normative_scope_v2" NOT NULL,
	"category" "normative_category_v2" NOT NULL,
	"jurisdiction" text NOT NULL,
	"municipality_id" text,
	"authority" text NOT NULL,
	"authority_type" "authority_type_v2" NOT NULL,
	"official_identifier" text,
	"valid_from" timestamp,
	"valid_to" timestamp,
	"status" "normative_status_v2" DEFAULT 'vigente' NOT NULL,
	"source_url" text,
	"file_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"language" "language_v2" DEFAULT 'es' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "normative_documents_v2_file_hash_unique" UNIQUE("file_hash"),
	CONSTRAINT "normative_documents_v2_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
ALTER TABLE "expediente_normative_context" ADD CONSTRAINT "expediente_normative_context_expediente_id_expedientes_id_fk" FOREIGN KEY ("expediente_id") REFERENCES "public"."expedientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expediente_normative_context" ADD CONSTRAINT "expediente_normative_context_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normative_chunks_v2" ADD CONSTRAINT "normative_chunks_v2_document_id_normative_documents_v2_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."normative_documents_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "normative_v2_embedding_idx" ON "normative_chunks_v2" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "normative_v2_doc_idx" ON "normative_chunks_v2" USING btree ("document_id");