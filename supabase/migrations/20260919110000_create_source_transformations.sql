CREATE TABLE IF NOT EXISTS "source_transformations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expediente_id" uuid NOT NULL REFERENCES "expedientes"("id") ON DELETE CASCADE,
  "source_ref" text NOT NULL,
  "source_hash" text NOT NULL,
  "derivation_type" text NOT NULL,
  "source_language" text DEFAULT 'auto' NOT NULL,
  "target_language" text,
  "translation_source" text,
  "input_derivation_id" uuid REFERENCES "source_transformations"("id") ON DELETE SET NULL,
  "input_derivation_hash" text,
  "derived_text" text NOT NULL,
  "model" text NOT NULL,
  "provider" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "source_transformations_lookup_idx" ON "source_transformations" (
  "expediente_id",
  "source_ref",
  "source_hash",
  "derivation_type",
  "target_language"
);

CREATE INDEX IF NOT EXISTS "source_transformations_ref_hash_idx" ON "source_transformations" (
  "source_ref",
  "source_hash"
);

ALTER TABLE "source_transformations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "source_transformations_authenticated_access" ON "source_transformations"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM expedientes e
      WHERE e.id = source_transformations.expediente_id
      AND (
        e.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.org_id = e.org_id
          AND om.profile_id = auth.uid()
        )
      )
    )
  );
