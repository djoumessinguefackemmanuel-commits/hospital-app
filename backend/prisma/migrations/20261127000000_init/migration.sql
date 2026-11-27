-- Migration initiale HMS (écrite à la main, équivalente au schéma Prisma).
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE SCHEMA IF NOT EXISTS "parametrage";
CREATE SCHEMA IF NOT EXISTS "shared";

CREATE TYPE "auth"."user_status" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');
CREATE TYPE "parametrage"."parametre_type" AS ENUM ('STRING','INT','DECIMAL','BOOL','ENUM','LIST','MAP','JSON','DATE','DURATION','CRON','URL','SECRET');
CREATE TYPE "parametrage"."scope_type" AS ENUM ('GLOBAL','ETABLISSEMENT','SERVICE','ROLE');
CREATE TYPE "parametrage"."parametre_status" AS ENUM ('DRAFT','PENDING_APPROVAL','PUBLISHED','RETIRED');
CREATE TYPE "shared"."outbox_status" AS ENUM ('PENDING','PUBLISHED','FAILED');

CREATE TABLE "parametrage"."etablissements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" UUID, "updated_by" UUID, "deleted_at" TIMESTAMPTZ, "deleted_by" UUID,
  CONSTRAINT "etablissements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "etablissements_code_key" ON "parametrage"."etablissements"("code");

CREATE TABLE "parametrage"."parametre_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "label" JSONB NOT NULL,
  "type" "parametrage"."parametre_type" NOT NULL,
  "default_value" JSONB NOT NULL,
  "validation" JSONB NOT NULL DEFAULT '{}',
  "allowed_scopes" "parametrage"."scope_type"[],
  "edit_permission" TEXT NOT NULL,
  "critical" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" UUID, "updated_by" UUID,
  CONSTRAINT "parametre_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parametre_definitions_code_key" ON "parametrage"."parametre_definitions"("code");

CREATE TABLE "parametrage"."parametre_values" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "definition_id" UUID NOT NULL,
  "scope_type" "parametrage"."scope_type" NOT NULL,
  "scope_id" TEXT NOT NULL DEFAULT '*',
  "version" INTEGER NOT NULL,
  "value" JSONB NOT NULL,
  "status" "parametrage"."parametre_status" NOT NULL,
  "effective_from" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reason" TEXT,
  "approved_by" UUID,
  "approved_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" UUID,
  CONSTRAINT "parametre_values_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parametre_values_definition_fkey" FOREIGN KEY ("definition_id") REFERENCES "parametrage"."parametre_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "parametre_values_definition_id_scope_type_scope_id_version_key" ON "parametrage"."parametre_values"("definition_id","scope_type","scope_id","version");
CREATE INDEX "parametre_values_definition_id_scope_type_scope_id_status_idx" ON "parametrage"."parametre_values"("definition_id","scope_type","scope_id","status");

CREATE TABLE "parametrage"."parametre_changelog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "definition_id" UUID NOT NULL,
  "scope_type" "parametrage"."scope_type" NOT NULL,
  "scope_id" TEXT NOT NULL DEFAULT '*',
  "action" TEXT NOT NULL,
  "old_value" JSONB, "new_value" JSONB, "reason" TEXT,
  "actor_id" UUID, "ip" TEXT,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "parametre_changelog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parametre_changelog_definition_fkey" FOREIGN KEY ("definition_id") REFERENCES "parametrage"."parametre_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "parametre_changelog_definition_id_occurred_at_idx" ON "parametrage"."parametre_changelog"("definition_id","occurred_at");

CREATE TABLE "shared"."roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL, "label" TEXT NOT NULL,
  "system" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" UUID, "updated_by" UUID,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "roles_code_key" ON "shared"."roles"("code");

CREATE TABLE "shared"."permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL, "module" TEXT NOT NULL, "resource" TEXT NOT NULL, "action" TEXT NOT NULL, "label" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permissions_code_key" ON "shared"."permissions"("code");
CREATE INDEX "permissions_module_idx" ON "shared"."permissions"("module");

CREATE TABLE "shared"."role_permissions" (
  "role_id" UUID NOT NULL, "permission_id" UUID NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id"),
  CONSTRAINT "role_permissions_role_fkey" FOREIGN KEY ("role_id") REFERENCES "shared"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "role_permissions_permission_fkey" FOREIGN KEY ("permission_id") REFERENCES "shared"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "shared"."audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "seq" BIGSERIAL NOT NULL,
  "etablissement_id" UUID, "user_id" UUID,
  "action" TEXT NOT NULL, "resource" TEXT NOT NULL, "resource_id" TEXT, "patient_id" UUID,
  "result" TEXT NOT NULL, "ip" TEXT, "user_agent" TEXT, "correlation_id" TEXT, "details" JSONB,
  "prev_hash" TEXT, "hash" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audit_logs_seq_key" ON "shared"."audit_logs"("seq");
CREATE INDEX "audit_logs_patient_id_occurred_at_idx" ON "shared"."audit_logs"("patient_id","occurred_at");
CREATE INDEX "audit_logs_user_id_occurred_at_idx" ON "shared"."audit_logs"("user_id","occurred_at");

-- Journal en ajout seul : toute modification ou suppression est refusée, même pour le compte applicatif.
CREATE FUNCTION "shared"."audit_logs_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est en ajout seul (% interdit)', TG_OP USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER "audit_logs_no_update_delete" BEFORE UPDATE OR DELETE ON "shared"."audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "shared"."audit_logs_immutable"();
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "shared"."audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "shared"."audit_logs_immutable"();

CREATE TABLE "shared"."outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_type" TEXT NOT NULL, "etablissement_id" UUID, "correlation_id" TEXT, "actor_id" UUID,
  "payload" JSONB NOT NULL,
  "status" "shared"."outbox_status" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "published_at" TIMESTAMPTZ, "last_error" TEXT,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_events_status_available_at_idx" ON "shared"."outbox_events"("status","available_at");

CREATE TABLE "auth"."users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "etablissement_id" UUID NOT NULL,
  "email" TEXT NOT NULL, "display_name" TEXT NOT NULL, "password_hash" TEXT NOT NULL,
  "password_changed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "status" "auth"."user_status" NOT NULL DEFAULT 'ACTIVE',
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ,
  "service_id" UUID,
  "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
  "mfa_secret_enc" TEXT,
  "last_login_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" UUID, "updated_by" UUID, "deleted_at" TIMESTAMPTZ, "deleted_by" UUID,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_etablissement_fkey" FOREIGN KEY ("etablissement_id") REFERENCES "parametrage"."etablissements"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "users_email_key" ON "auth"."users"("email");
CREATE INDEX "users_etablissement_id_idx" ON "auth"."users"("etablissement_id");

CREATE TABLE "auth"."user_roles" (
  "user_id" UUID NOT NULL, "role_id" UUID NOT NULL, "granted_by" UUID,
  "granted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id"),
  CONSTRAINT "user_roles_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_roles_role_fkey" FOREIGN KEY ("role_id") REFERENCES "shared"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "auth"."refresh_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL, "family_id" UUID NOT NULL, "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL, "revoked_at" TIMESTAMPTZ, "replaced_by_id" UUID,
  "ip" TEXT, "user_agent" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refresh_tokens_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "auth"."refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_user_id_idx" ON "auth"."refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_family_id_idx" ON "auth"."refresh_tokens"("family_id");
