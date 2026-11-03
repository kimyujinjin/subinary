-- Additive bank grants; contains no credentials or operational records.
CREATE TABLE bank_connections (
 id uuid PRIMARY KEY, household_id uuid NOT NULL REFERENCES households(id), owner_user_id uuid NOT NULL REFERENCES users(id),
 member_id uuid NOT NULL REFERENCES household_members(id), member_joined_at timestamptz NOT NULL,
 provider text NOT NULL, login_fingerprint text NOT NULL, account_last4 text NOT NULL, loan_type text NOT NULL,
 credentials jsonb, consented_at timestamptz NOT NULL DEFAULT now(), consent_version integer NOT NULL DEFAULT 1,
 refresh_on_open boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'stored', version integer NOT NULL DEFAULT 1,
 operation_id uuid, operation_started_at timestamptz, last_attempt_at timestamptz, last_success_at timestamptz,
 last_snapshot_id uuid, selected_fingerprint text, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), disconnected_at timestamptz,
 CONSTRAINT bank_connections_scope_unique UNIQUE(id,household_id,owner_user_id),
 CONSTRAINT bank_connections_provider_check CHECK(provider = 'shinhan_bank'),
 CONSTRAINT bank_connections_selector_check CHECK(account_last4 ~ '^[0-9]{4}$' AND loan_type IN ('interim','jeonse')),
 CONSTRAINT bank_connections_version_check CHECK(version > 0 AND consent_version = 1),
 CONSTRAINT bank_connections_status_check CHECK(status IN ('stored','refreshing','ready','error','reauth_required','disconnected')),
 CONSTRAINT bank_connections_fingerprint_check CHECK(login_fingerprint ~ '^[0-9a-f]{64}$' AND (selected_fingerprint IS NULL OR selected_fingerprint ~ '^[0-9a-f]{64}$')),
 CONSTRAINT bank_connections_disconnected_check CHECK(disconnected_at IS NULL OR (status = 'disconnected' AND credentials IS NULL AND operation_id IS NULL AND refresh_on_open = false))
);
--> statement-breakpoint
CREATE UNIQUE INDEX bank_connections_active_selector ON bank_connections(owner_user_id,household_id,provider,account_last4,loan_type) WHERE disconnected_at IS NULL;
--> statement-breakpoint
CREATE INDEX bank_connections_login_operation ON bank_connections(login_fingerprint,operation_id);
--> statement-breakpoint
CREATE TABLE bank_connection_snapshots (
 id uuid PRIMARY KEY, connection_id uuid NOT NULL, household_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 connection_version integer NOT NULL, state text NOT NULL DEFAULT 'pending', payload jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CONSTRAINT bank_snapshots_scope_fk FOREIGN KEY(connection_id,household_id,owner_user_id) REFERENCES bank_connections(id,household_id,owner_user_id),
 CONSTRAINT bank_snapshots_state_check CHECK((state = 'pending' AND payload IS NULL AND completed_at IS NULL) OR (state = 'succeeded' AND payload IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL) OR (state = 'failed' AND payload IS NULL AND completed_at IS NOT NULL)),
 CONSTRAINT bank_snapshots_version_check CHECK(connection_version > 0)
);
--> statement-breakpoint
CREATE FUNCTION guard_bank_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'bank observation is immutable' USING ERRCODE = '55000'; END IF;
 IF OLD.state <> 'pending' OR NEW.state = 'pending' OR ROW(OLD.id,OLD.connection_id,OLD.household_id,OLD.owner_user_id,OLD.connection_version,OLD.created_at)
 IS DISTINCT FROM ROW(NEW.id,NEW.connection_id,NEW.household_id,NEW.owner_user_id,NEW.connection_version,NEW.created_at) THEN
  RAISE EXCEPTION 'bank observation is immutable' USING ERRCODE = '55000';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_snapshot_guard BEFORE UPDATE OR DELETE ON bank_connection_snapshots FOR EACH ROW EXECUTE FUNCTION guard_bank_snapshot();
--> statement-breakpoint
CREATE FUNCTION revoke_bank_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status <> 'active' OR NEW.role = 'viewer' OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
  UPDATE bank_connections SET status = 'disconnected', disconnected_at = now(), refresh_on_open = false,
   credentials = NULL, operation_id = NULL, operation_started_at = NULL, selected_fingerprint = NULL,
   error_code = NULL, updated_at = now(), version = LEAST(version::bigint+1,2147483647)::integer
   WHERE member_id = OLD.id AND disconnected_at IS NULL;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_membership_revoke AFTER UPDATE OF status,role,joined_at ON household_members FOR EACH ROW EXECUTE FUNCTION revoke_bank_membership();
--> statement-breakpoint
CREATE FUNCTION revoke_bank_deleted_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN
  UPDATE bank_connections SET status = 'disconnected', disconnected_at = now(), refresh_on_open = false,
   credentials = NULL, operation_id = NULL, operation_started_at = NULL, selected_fingerprint = NULL,
   error_code = NULL, updated_at = now(), version = LEAST(version::bigint+1,2147483647)::integer
   WHERE disconnected_at IS NULL AND ((TG_TABLE_NAME = 'users' AND owner_user_id = NEW.id) OR (TG_TABLE_NAME = 'households' AND household_id = NEW.id));
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_user_revoke AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION revoke_bank_deleted_scope();
--> statement-breakpoint
CREATE TRIGGER bank_household_revoke AFTER UPDATE OF deleted_at ON households FOR EACH ROW EXECUTE FUNCTION revoke_bank_deleted_scope();
