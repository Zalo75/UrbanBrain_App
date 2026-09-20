CREATE TABLE IF NOT EXISTS "has_alignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expediente_id" uuid NOT NULL REFERENCES "expedientes"("id") ON DELETE CASCADE,
  "cadastral_reference" text NOT NULL,
  "historical_view_id" text NOT NULL,
  "historical_provenance" jsonb NOT NULL,
  "modern_view_id" text NOT NULL,
  "modern_provenance" jsonb NOT NULL,
  "bbox" jsonb NOT NULL,
  "crs" text NOT NULL,
  "transform" jsonb NOT NULL,
  "native_dimensions" jsonb NOT NULL,
  "status" text DEFAULT 'approved' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "has_alignments_expediente_created_idx" ON "has_alignments" ("expediente_id", "created_at");
