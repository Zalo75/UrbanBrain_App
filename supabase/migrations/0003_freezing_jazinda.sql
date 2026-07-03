CREATE TYPE "public"."action_type" AS ENUM('consulta_urbanistica', 'vivienda_unifamiliar', 'reforma', 'segregacion', 'cambio_de_uso', 'nave', 'legalizacion', 'demolicion', 'parcelacion', 'informe_urbanistico', 'otro');--> statement-breakpoint
CREATE TYPE "public"."land_class" AS ENUM('desconocido', 'urbano_consolidado', 'urbano_no_consolidado', 'urbanizable', 'rustico_no_urbanizable', 'nucleo_rural');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('cadastral_reference', 'address', 'coordinates', 'planning_area', 'manual');--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "urban_planning_zone" text;--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "land_class" "land_class";--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "action_type" "action_type";--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "location_source" "location_source";--> statement-breakpoint
ALTER TABLE "expedientes" ADD COLUMN "notes" text;