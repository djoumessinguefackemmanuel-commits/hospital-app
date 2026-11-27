CREATE TYPE "patient"."merge_status" AS ENUM ('PENDING','COMPLETED','REJECTED');
ALTER TABLE "patient"."patients" ADD COLUMN "merged_into_id" UUID;
CREATE TABLE "patient"."patient_merges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "etablissement_id" UUID NOT NULL,
  "source_id" UUID NOT NULL, "target_id" UUID NOT NULL,
  "status" "patient"."merge_status" NOT NULL,
  "reason" TEXT NOT NULL,
  "requested_by" UUID NOT NULL, "decided_by" UUID, "decision_note" TEXT, "decided_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "patient_merges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_merges_distinct" CHECK ("source_id" <> "target_id")
);
CREATE INDEX "patient_merges_etablissement_id_status_idx" ON "patient"."patient_merges"("etablissement_id","status");
CREATE INDEX "patient_merges_source_id_idx" ON "patient"."patient_merges"("source_id");
CREATE INDEX "patient_merges_target_id_idx" ON "patient"."patient_merges"("target_id");
