-- AlterTable
ALTER TABLE "distribution" ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "operation" ADD COLUMN     "pii_purged_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "unserved_release" (
    "release_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "released_by" UUID NOT NULL,
    "household_ids" UUID[],
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unserved_release_pkey" PRIMARY KEY ("release_id")
);

-- CreateIndex
CREATE INDEX "unserved_release_area_id_released_at_idx" ON "unserved_release"("area_id", "released_at");

-- CreateIndex
CREATE INDEX "distribution_area_id_updated_at_idx" ON "distribution"("area_id", "updated_at");

-- CreateIndex
CREATE INDEX "household_area_id_updated_at_idx" ON "household"("area_id", "updated_at");

-- AddForeignKey
ALTER TABLE "unserved_release" ADD CONSTRAINT "unserved_release_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operation"("operation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unserved_release" ADD CONSTRAINT "unserved_release_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("area_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unserved_release" ADD CONSTRAINT "unserved_release_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- NFR07 PII purge support
-- ---------------------------------------------------------------------------

-- Redacted households keep the row (distributions/coverage stay intact) but drop the name.
ALTER TABLE "household" DROP CONSTRAINT "household_head_name_english";
ALTER TABLE "household"
  ADD CONSTRAINT "household_head_name_english" CHECK (
    "head_name" = '[REDACTED]' OR "head_name" ~ '^[A-Za-z][A-Za-z .''-]*$'
  );

-- Append-only tables stay append-only. The single exception is a PII purge
-- transaction that has run `SET LOCAL app.pii_purge = 'on'`, and even then only
-- the PII-bearing columns may change, and only to redacted values. DELETE is
-- always rejected.
CREATE OR REPLACE FUNCTION reject_mutation_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.pii_purge', true) = 'on' THEN
    IF TG_TABLE_NAME = 'household_version'
       AND NEW.version_id = OLD.version_id
       AND NEW.household_id = OLD.household_id
       AND NEW.version = OLD.version
       AND NEW.member_count = OLD.member_count
       AND NEW.changed_by = OLD.changed_by
       AND NEW.change_source = OLD.change_source
       AND NEW.created_at = OLD.created_at
       AND NEW.head_name = '[REDACTED]'
       AND NEW.mobile_number IS NULL THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'audit_log'
       AND NEW.audit_id = OLD.audit_id
       AND NEW.action = OLD.action
       AND NEW.entity_type = OLD.entity_type
       AND NEW.entity_id = OLD.entity_id
       AND NEW.created_at = OLD.created_at
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id
       AND NEW.device_id IS NOT DISTINCT FROM OLD.device_id THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "unserved_release"
  ADD CONSTRAINT "unserved_release_nonempty" CHECK (cardinality("household_ids") > 0);
