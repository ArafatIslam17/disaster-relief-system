-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('FIELD_VOLUNTEER', 'GROUP_COORDINATOR', 'OPERATION_ADMINISTRATOR', 'SYSTEM_ADMINISTRATOR', 'OBSERVER');

-- CreateEnum
CREATE TYPE "OrganisationStatus" AS ENUM ('Pending', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PendingApproval', 'Active', 'Locked', 'Deactivated');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('Active', 'Revoked');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('Active', 'Closed');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('Pending', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "HouseholdChangeSource" AS ENUM ('FIELD_EDIT', 'CONFLICT_RESOLUTION');

-- CreateEnum
CREATE TYPE "DistributionStatus" AS ENUM ('Active', 'Voided');

-- CreateEnum
CREATE TYPE "SyncEntityType" AS ENUM ('HOUSEHOLD', 'DISTRIBUTION');

-- CreateEnum
CREATE TYPE "SyncAction" AS ENUM ('CREATE', 'UPDATE', 'VOID');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('Open', 'Resolved');

-- CreateEnum
CREATE TYPE "DuplicateLabel" AS ENUM ('Likely', 'Possible');

-- CreateEnum
CREATE TYPE "DuplicatePairStatus" AS ENUM ('PendingReview', 'Linked', 'NotDuplicate');

-- CreateEnum
CREATE TYPE "DistributionFlagStatus" AS ENUM ('PendingReview', 'Justified', 'Repeat');

-- CreateTable
CREATE TABLE "organisation" (
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "org_type" TEXT NOT NULL,
    "status" "OrganisationStatus" NOT NULL DEFAULT 'Pending',
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_pkey" PRIMARY KEY ("organisation_id")
);

-- CreateTable
CREATE TABLE "user" (
    "user_id" UUID NOT NULL,
    "organisation_id" UUID,
    "full_name" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PendingApproval',
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "device" (
    "device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_label" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'Active',
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sync_at" TIMESTAMPTZ(3),

    CONSTRAINT "device_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "operation" (
    "operation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "disaster_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "OperationStatus" NOT NULL DEFAULT 'Active',
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "operation_pkey" PRIMARY KEY ("operation_id")
);

-- CreateTable
CREATE TABLE "operation_membership" (
    "operation_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'Pending',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "operation_membership_pkey" PRIMARY KEY ("operation_id","organisation_id")
);

-- CreateTable
CREATE TABLE "area" (
    "area_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "upazila" TEXT NOT NULL,
    "union_name" TEXT NOT NULL,
    "ward" TEXT NOT NULL,

    CONSTRAINT "area_pkey" PRIMARY KEY ("area_id")
);

-- CreateTable
CREATE TABLE "relief_item" (
    "item_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "item_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "relief_item_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "household" (
    "household_id" UUID NOT NULL,
    "short_code" TEXT NOT NULL,
    "area_id" UUID NOT NULL,
    "registered_by" UUID NOT NULL,
    "head_name" TEXT NOT NULL,
    "mobile_number" TEXT,
    "member_count" INTEGER NOT NULL,
    "consent_given" BOOLEAN NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "gps_location" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_pkey" PRIMARY KEY ("household_id")
);

-- CreateTable
CREATE TABLE "household_version" (
    "version_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "head_name" TEXT NOT NULL,
    "mobile_number" TEXT,
    "member_count" INTEGER NOT NULL,
    "changed_by" UUID NOT NULL,
    "change_source" "HouseholdChangeSource" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_version_pkey" PRIMARY KEY ("version_id")
);

-- CreateTable
CREATE TABLE "distribution" (
    "distribution_id" UUID NOT NULL,
    "household_id" UUID,
    "area_id" UUID NOT NULL,
    "recorded_by" UUID NOT NULL,
    "distributed_at" TIMESTAMPTZ(3) NOT NULL,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "DistributionStatus" NOT NULL DEFAULT 'Active',
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "distribution_pkey" PRIMARY KEY ("distribution_id")
);

-- CreateTable
CREATE TABLE "distribution_item" (
    "distribution_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "distribution_item_pkey" PRIMARY KEY ("distribution_id","item_id")
);

-- CreateTable
CREATE TABLE "sync_event" (
    "event_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "entity_type" "SyncEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" "SyncAction" NOT NULL,
    "payload" JSONB NOT NULL,
    "base_version" INTEGER NOT NULL,
    "client_time" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "conflict" (
    "conflict_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "local_value" TEXT,
    "server_value" TEXT,
    "local_user_id" UUID NOT NULL,
    "local_device_id" UUID NOT NULL,
    "client_time" TIMESTAMPTZ(3) NOT NULL,
    "resolved_value" TEXT,
    "status" "ConflictStatus" NOT NULL DEFAULT 'Open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "conflict_pkey" PRIMARY KEY ("conflict_id")
);

-- CreateTable
CREATE TABLE "duplicate_pair" (
    "pair_id" UUID NOT NULL,
    "household_a_id" UUID NOT NULL,
    "household_b_id" UUID NOT NULL,
    "score" DECIMAL(3,2) NOT NULL,
    "label" "DuplicateLabel" NOT NULL,
    "status" "DuplicatePairStatus" NOT NULL DEFAULT 'PendingReview',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "duplicate_pair_pkey" PRIMARY KEY ("pair_id")
);

-- CreateTable
CREATE TABLE "distribution_flag" (
    "flag_id" UUID NOT NULL,
    "first_distribution_id" UUID NOT NULL,
    "second_distribution_id" UUID NOT NULL,
    "status" "DistributionFlagStatus" NOT NULL DEFAULT 'PendingReview',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_flag_pkey" PRIMARY KEY ("flag_id")
);

-- CreateTable
CREATE TABLE "notification" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link_path" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "audit_id" UUID NOT NULL,
    "user_id" UUID,
    "organisation_id" UUID,
    "device_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("audit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisation_name_key" ON "organisation"("name");

-- CreateIndex
CREATE INDEX "organisation_status_idx" ON "organisation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_mobile_number_key" ON "user"("mobile_number");

-- CreateIndex
CREATE INDEX "user_organisation_id_idx" ON "user"("organisation_id");

-- CreateIndex
CREATE INDEX "user_role_status_idx" ON "user"("role", "status");

-- CreateIndex
CREATE INDEX "device_user_id_idx" ON "device"("user_id");

-- CreateIndex
CREATE INDEX "operation_status_idx" ON "operation"("status");

-- CreateIndex
CREATE INDEX "operation_membership_organisation_id_idx" ON "operation_membership"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "area_operation_id_upazila_union_name_ward_key" ON "area"("operation_id", "upazila", "union_name", "ward");

-- CreateIndex
CREATE UNIQUE INDEX "relief_item_operation_id_item_name_key" ON "relief_item"("operation_id", "item_name");

-- CreateIndex
CREATE UNIQUE INDEX "household_short_code_key" ON "household"("short_code");

-- CreateIndex
CREATE INDEX "household_area_id_idx" ON "household"("area_id");

-- CreateIndex
CREATE INDEX "household_mobile_number_idx" ON "household"("mobile_number");

-- CreateIndex
CREATE INDEX "household_registered_by_idx" ON "household"("registered_by");

-- CreateIndex
CREATE UNIQUE INDEX "household_version_household_id_version_key" ON "household_version"("household_id", "version");

-- CreateIndex
CREATE INDEX "distribution_household_id_distributed_at_idx" ON "distribution"("household_id", "distributed_at");

-- CreateIndex
CREATE INDEX "distribution_area_id_distributed_at_idx" ON "distribution"("area_id", "distributed_at");

-- CreateIndex
CREATE INDEX "distribution_recorded_by_idx" ON "distribution"("recorded_by");

-- CreateIndex
CREATE INDEX "distribution_item_item_id_idx" ON "distribution_item"("item_id");

-- CreateIndex
CREATE INDEX "sync_event_device_id_received_at_idx" ON "sync_event"("device_id", "received_at");

-- CreateIndex
CREATE INDEX "sync_event_entity_type_entity_id_idx" ON "sync_event"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "conflict_status_idx" ON "conflict"("status");

-- CreateIndex
CREATE INDEX "conflict_household_id_idx" ON "conflict"("household_id");

-- CreateIndex
CREATE INDEX "duplicate_pair_status_idx" ON "duplicate_pair"("status");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_pair_household_a_id_household_b_id_key" ON "duplicate_pair"("household_a_id", "household_b_id");

-- CreateIndex
CREATE INDEX "distribution_flag_status_idx" ON "distribution_flag"("status");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_flag_first_distribution_id_second_distribution_key" ON "distribution_flag"("first_distribution_id", "second_distribution_id");

-- CreateIndex
CREATE INDEX "notification_user_id_is_read_created_at_idx" ON "notification"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("organisation_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_membership" ADD CONSTRAINT "operation_membership_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operation"("operation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_membership" ADD CONSTRAINT "operation_membership_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("organisation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "area" ADD CONSTRAINT "area_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operation"("operation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relief_item" ADD CONSTRAINT "relief_item_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operation"("operation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household" ADD CONSTRAINT "household_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("area_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household" ADD CONSTRAINT "household_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_version" ADD CONSTRAINT "household_version_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_version" ADD CONSTRAINT "household_version_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution" ADD CONSTRAINT "distribution_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution" ADD CONSTRAINT "distribution_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("area_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution" ADD CONSTRAINT "distribution_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_item" ADD CONSTRAINT "distribution_item_distribution_id_fkey" FOREIGN KEY ("distribution_id") REFERENCES "distribution"("distribution_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_item" ADD CONSTRAINT "distribution_item_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "relief_item"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_event" ADD CONSTRAINT "sync_event_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("device_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict" ADD CONSTRAINT "conflict_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "sync_event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict" ADD CONSTRAINT "conflict_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict" ADD CONSTRAINT "conflict_local_user_id_fkey" FOREIGN KEY ("local_user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict" ADD CONSTRAINT "conflict_local_device_id_fkey" FOREIGN KEY ("local_device_id") REFERENCES "device"("device_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict" ADD CONSTRAINT "conflict_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_pair" ADD CONSTRAINT "duplicate_pair_household_a_id_fkey" FOREIGN KEY ("household_a_id") REFERENCES "household"("household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_pair" ADD CONSTRAINT "duplicate_pair_household_b_id_fkey" FOREIGN KEY ("household_b_id") REFERENCES "household"("household_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_pair" ADD CONSTRAINT "duplicate_pair_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_flag" ADD CONSTRAINT "distribution_flag_first_distribution_id_fkey" FOREIGN KEY ("first_distribution_id") REFERENCES "distribution"("distribution_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_flag" ADD CONSTRAINT "distribution_flag_second_distribution_id_fkey" FOREIGN KEY ("second_distribution_id") REFERENCES "distribution"("distribution_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_flag" ADD CONSTRAINT "distribution_flag_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("device_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity guards not expressible in Prisma schema
-- ---------------------------------------------------------------------------

-- Append-only enforcement for AUDIT_LOG and HOUSEHOLD_VERSION (UC-15, UC-17, NFR audit).
-- Row-level UPDATE/DELETE is rejected. TRUNCATE is intentionally not blocked so the
-- seed script can reset a development database; never TRUNCATE in application code.
CREATE OR REPLACE FUNCTION reject_mutation_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation_append_only();

CREATE TRIGGER household_version_append_only
  BEFORE UPDATE OR DELETE ON "household_version"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation_append_only();

-- Duplicate pairs are stored in canonical order so (A,B) and (B,A) cannot both exist.
ALTER TABLE "duplicate_pair"
  ADD CONSTRAINT "duplicate_pair_canonical_order" CHECK ("household_a_id" < "household_b_id"),
  ADD CONSTRAINT "duplicate_pair_score_range" CHECK ("score" >= 0 AND "score" <= 1);

ALTER TABLE "distribution_flag"
  ADD CONSTRAINT "distribution_flag_distinct" CHECK ("first_distribution_id" <> "second_distribution_id");

-- Anonymous distributions carry no household; identified ones must.
ALTER TABLE "distribution"
  ADD CONSTRAINT "distribution_anonymous_household" CHECK (
    ("is_anonymous" = TRUE AND "household_id" IS NULL) OR
    ("is_anonymous" = FALSE AND "household_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "distribution_void_reason" CHECK (
    "status" <> 'Voided' OR ("cancel_reason" IS NOT NULL AND length(trim("cancel_reason")) > 0)
  );

ALTER TABLE "distribution_item"
  ADD CONSTRAINT "distribution_item_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "household"
  ADD CONSTRAINT "household_member_count_positive" CHECK ("member_count" >= 1),
  ADD CONSTRAINT "household_consent_required" CHECK ("consent_given" = TRUE),
  ADD CONSTRAINT "household_head_name_english" CHECK ("head_name" ~ '^[A-Za-z][A-Za-z .''-]*$'),
  ADD CONSTRAINT "household_mobile_format" CHECK ("mobile_number" IS NULL OR "mobile_number" ~ '^01[3-9][0-9]{8}$');

ALTER TABLE "user"
  ADD CONSTRAINT "user_mobile_format" CHECK ("mobile_number" ~ '^01[3-9][0-9]{8}$'),
  ADD CONSTRAINT "user_failed_attempts_nonneg" CHECK ("failed_attempts" >= 0);

ALTER TABLE "household_version"
  ADD CONSTRAINT "household_version_member_count_positive" CHECK ("member_count" >= 1);

ALTER TABLE "conflict"
  ADD CONSTRAINT "conflict_resolution_complete" CHECK (
    "status" = 'Open' OR ("resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolved_value" IS NOT NULL)
  );
