-- Nécessite l'extension btree_gist (contrib PostgreSQL) pour la contrainte d'exclusion ci-dessous.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS "consultation";
CREATE TYPE "consultation"."appointment_status" AS ENUM ('BOOKED','CANCELLED','COMPLETED','NO_SHOW');

CREATE TABLE "consultation"."schedule_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "etablissement_id" UUID NOT NULL, "practitioner_id" UUID NOT NULL,
  "weekday" INTEGER NOT NULL, "start_minute" INTEGER NOT NULL, "end_minute" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_rules_weekday_ck" CHECK ("weekday" BETWEEN 1 AND 7),
  CONSTRAINT "schedule_rules_minutes_ck" CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute")
);
CREATE INDEX "schedule_rules_practitioner_id_idx" ON "consultation"."schedule_rules"("practitioner_id");

CREATE TABLE "consultation"."appointments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "etablissement_id" UUID NOT NULL, "practitioner_id" UUID NOT NULL, "patient_id" UUID NOT NULL,
  "starts_at" TIMESTAMPTZ NOT NULL, "ends_at" TIMESTAMPTZ NOT NULL,
  "status" "consultation"."appointment_status" NOT NULL DEFAULT 'BOOKED',
  "reason" TEXT, "cancel_reason" TEXT, "cancelled_by" UUID, "cancelled_at" TIMESTAMPTZ,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointments_range_ck" CHECK ("starts_at" < "ends_at"),
  -- Deux réservations simultanées du même créneau : une seule réussit (CONS-01).
  CONSTRAINT "appointments_no_overlap" EXCLUDE USING gist ("practitioner_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'BOOKED')
);
CREATE INDEX "appointments_practitioner_id_starts_at_idx" ON "consultation"."appointments"("practitioner_id","starts_at");
CREATE INDEX "appointments_patient_id_starts_at_idx" ON "consultation"."appointments"("patient_id","starts_at");
CREATE INDEX "appointments_etablissement_id_starts_at_idx" ON "consultation"."appointments"("etablissement_id","starts_at");
