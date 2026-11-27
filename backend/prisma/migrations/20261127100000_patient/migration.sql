CREATE SCHEMA IF NOT EXISTS "patient";
CREATE TYPE "patient"."patient_sex" AS ENUM ('M','F','OTHER','UNKNOWN');
CREATE TYPE "patient"."confidentiality" AS ENUM ('NORMAL','RESTRICTED');

CREATE TABLE "patient"."patients" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "etablissement_id" UUID NOT NULL,
  "mrn" TEXT NOT NULL,
  "last_name" TEXT NOT NULL, "first_name" TEXT NOT NULL,
  "last_name_norm" TEXT NOT NULL, "first_name_norm" TEXT NOT NULL,
  "birth_date" DATE NOT NULL,
  "sex" "patient"."patient_sex" NOT NULL DEFAULT 'UNKNOWN',
  "phone" TEXT, "email" TEXT, "address" TEXT,
  "national_id_enc" TEXT, "national_id_hash" TEXT,
  "confidentiality" "patient"."confidentiality" NOT NULL DEFAULT 'NORMAL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" UUID, "updated_by" UUID,
  CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "patients_etablissement_id_mrn_key" ON "patient"."patients"("etablissement_id","mrn");
CREATE INDEX "patients_etablissement_id_birth_date_idx" ON "patient"."patients"("etablissement_id","birth_date");
CREATE INDEX "patients_etablissement_id_last_name_norm_idx" ON "patient"."patients"("etablissement_id","last_name_norm");
CREATE INDEX "patients_etablissement_id_national_id_hash_idx" ON "patient"."patients"("etablissement_id","national_id_hash");

CREATE TABLE "patient"."mrn_counters" (
  "etablissement_id" UUID NOT NULL, "year" INTEGER NOT NULL, "last" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "mrn_counters_pkey" PRIMARY KEY ("etablissement_id","year")
);
