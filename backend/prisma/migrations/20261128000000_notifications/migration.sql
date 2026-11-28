CREATE SCHEMA IF NOT EXISTS "notifications";
CREATE TYPE "notifications"."notification_channel" AS ENUM ('EMAIL','SMS');
CREATE TYPE "notifications"."notification_status" AS ENUM ('PENDING','SENT','FAILED','CANCELLED','SKIPPED');

CREATE TABLE "notifications"."notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "etablissement_id" UUID NOT NULL, "patient_id" UUID NOT NULL,
  "channel" "notifications"."notification_channel" NOT NULL,
  "template" TEXT NOT NULL,
  "subject_type" TEXT NOT NULL, "subject_id" UUID NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "dedupe_key" TEXT NOT NULL,
  "status" "notifications"."notification_status" NOT NULL DEFAULT 'PENDING',
  "scheduled_for" TIMESTAMPTZ NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT, "sent_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"."notifications"("dedupe_key");
CREATE INDEX "notifications_status_scheduled_for_idx" ON "notifications"."notifications"("status","scheduled_for");
CREATE INDEX "notifications_subject_idx" ON "notifications"."notifications"("subject_type","subject_id");
CREATE INDEX "notifications_etablissement_id_patient_id_idx" ON "notifications"."notifications"("etablissement_id","patient_id");
