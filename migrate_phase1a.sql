DO $$ BEGIN
 CREATE TYPE "public"."planning_status" AS ENUM('vigente', 'en_tramitacion', 'derogado');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "public"."afeccion_status" AS ENUM('detected', 'confirmed', 'rejected', 'manual', 'pending_review');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "municipal_planning" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "province_id" text NOT NULL,
    "municipality_id" text NOT NULL,
    "name" text NOT NULL,
    "status" "public"."planning_status" DEFAULT 'vigente' NOT NULL,
    "approval_date" timestamp,
    "source_system" text,
    "source_url" text,
    "source_document_id" text,
    "external_id" text,
    "valid_from" timestamp,
    "valid_to" timestamp,
    "notes" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "planning_zones" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "planning_id" uuid NOT NULL,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "land_class" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "afeccion_types" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "category" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "source_wfs" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "expediente_afecciones" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "expediente_id" uuid NOT NULL,
    "afeccion_type_id" uuid NOT NULL,
    "status" "public"."afeccion_status" DEFAULT 'detected' NOT NULL,
    "manually_added" boolean DEFAULT false NOT NULL,
    "source" text,
    "source_url" text,
    "detection_method" text,
    "raw_feature_id" text,
    "confidence" real,
    "detected_at" timestamp DEFAULT now() NOT NULL,
    "reviewed_at" timestamp,
    "reviewed_by" uuid,
    "notes" text
);

CREATE TABLE IF NOT EXISTS "context_detections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "expediente_id" uuid NOT NULL,
    "summary" jsonb NOT NULL,
    "raw_response" jsonb,
    "geometry_stored" boolean DEFAULT false NOT NULL,
    "source_apis" jsonb NOT NULL,
    "detected_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "planning_zones" ADD CONSTRAINT "planning_zones_planning_id_municipal_planning_id_fk" FOREIGN KEY ("planning_id") REFERENCES "public"."municipal_planning"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "expediente_afecciones" ADD CONSTRAINT "expediente_afecciones_expediente_id_expedientes_id_fk" FOREIGN KEY ("expediente_id") REFERENCES "public"."expedientes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "expediente_afecciones" ADD CONSTRAINT "expediente_afecciones_afeccion_type_id_afeccion_types_id_fk" FOREIGN KEY ("afeccion_type_id") REFERENCES "public"."afeccion_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "expediente_afecciones" ADD CONSTRAINT "expediente_afecciones_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "context_detections" ADD CONSTRAINT "context_detections_expediente_id_expedientes_id_fk" FOREIGN KEY ("expediente_id") REFERENCES "public"."expedientes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
