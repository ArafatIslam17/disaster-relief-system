-- PL/pgSQL plans a whole boolean expression, so one shared trigger function cannot reference
-- columns that exist on only one of the two tables. Use one function per table.

CREATE OR REPLACE FUNCTION household_version_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.pii_purge', true) = 'on'
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
  RAISE EXCEPTION 'household_version is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.pii_purge', true) = 'on'
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
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER audit_log_append_only ON "audit_log";
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER household_version_append_only ON "household_version";
CREATE TRIGGER household_version_append_only
  BEFORE UPDATE OR DELETE ON "household_version"
  FOR EACH ROW EXECUTE FUNCTION household_version_append_only();

DROP FUNCTION reject_mutation_append_only();
