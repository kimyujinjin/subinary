-- Owner-only provider connections. No family aggregates or manual-asset writes.
CREATE TABLE finance_connections (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  member_id uuid NOT NULL REFERENCES household_members(id),
  member_joined_at timestamptz NOT NULL,
  provider text NOT NULL DEFAULT 'toss_securities',
  client_fingerprint text NOT NULL,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  consented_at timestamptz NOT NULL DEFAULT now(),
  consent_version integer NOT NULL DEFAULT 1,
  refresh_on_open boolean NOT NULL DEFAULT true,
  credentials jsonb,
  token_issuance text NOT NULL DEFAULT 'started',
  token jsonb,
  token_expires_at timestamptz,
  accounts jsonb,
  selected_account_id text,
  operation_id uuid,
  operation_started_at timestamptz,
  last_attempt_at timestamptz,
  retry_not_before timestamptz,
  last_success_at timestamptz,
  last_snapshot_id uuid,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  CONSTRAINT finance_connections_scope_unique UNIQUE (id, household_id, owner_user_id),
  CONSTRAINT finance_connections_provider_check CHECK (provider = 'toss_securities'),
  CONSTRAINT finance_connections_issuance_check CHECK (token_issuance IN ('started','complete','uncertain')),
  CONSTRAINT finance_connections_version_check CHECK (version > 0 AND consent_version = 1),
  CONSTRAINT finance_connections_status_check CHECK (status IN ('connecting','select_account','ready','refreshing','error','reauth_required','disconnected')),
  CONSTRAINT finance_connections_fingerprint_check CHECK (client_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT finance_connections_account_check CHECK (selected_account_id IS NULL OR selected_account_id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT finance_connections_disconnected_check CHECK (disconnected_at IS NULL OR
    (status = 'disconnected' AND credentials IS NULL AND token IS NULL AND accounts IS NULL AND operation_id IS NULL AND refresh_on_open = false))
);
--> statement-breakpoint
-- Disconnection must not release an in-flight/uncertain token issuance authority:
-- a late provider response could invalidate a newly issued token for the same client.
CREATE UNIQUE INDEX finance_connections_client_active_unique ON finance_connections (client_fingerprint)
  WHERE disconnected_at IS NULL OR token_issuance <> 'complete';
--> statement-breakpoint
CREATE INDEX finance_connections_owner_idx ON finance_connections (household_id, owner_user_id);
--> statement-breakpoint
CREATE TABLE finance_connection_snapshots (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL,
  household_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  connection_version integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  payload jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT finance_connection_snapshots_scope_fk FOREIGN KEY (connection_id, household_id, owner_user_id)
    REFERENCES finance_connections(id, household_id, owner_user_id),
  CONSTRAINT finance_connection_snapshots_state_check CHECK (
    (state = 'pending' AND payload IS NULL AND completed_at IS NULL)
    OR (state = 'succeeded' AND payload IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (state = 'failed' AND payload IS NULL AND completed_at IS NOT NULL)),
  CONSTRAINT finance_connection_snapshots_version_check CHECK (connection_version > 0)
);
--> statement-breakpoint
CREATE INDEX finance_connection_snapshots_connection_idx ON finance_connection_snapshots (connection_id, created_at);
--> statement-breakpoint
CREATE FUNCTION guard_finance_connection_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance observation is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'pending' OR NEW.state = 'pending'
    OR ROW(OLD.id, OLD.connection_id, OLD.household_id, OLD.owner_user_id, OLD.connection_version, OLD.created_at)
       IS DISTINCT FROM ROW(NEW.id, NEW.connection_id, NEW.household_id, NEW.owner_user_id, NEW.connection_version, NEW.created_at) THEN
    RAISE EXCEPTION 'finance observation is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_connection_snapshot_guard BEFORE UPDATE OR DELETE ON finance_connection_snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_finance_connection_snapshot();
--> statement-breakpoint
-- Database-level revocation also protects rollback to application code unaware of 0067.
-- A later rejoin or role upgrade must never restore a previous provider grant.
CREATE FUNCTION revoke_finance_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' OR NEW.role = 'viewer' OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    UPDATE finance_connections SET status = 'disconnected', disconnected_at = now(), refresh_on_open = false,
      credentials = NULL, token = NULL, token_expires_at = NULL, accounts = NULL,
      selected_account_id = NULL, operation_id = NULL, operation_started_at = NULL,
      error_code = NULL, updated_at = now(), version = LEAST(version::bigint + 1, 2147483647)::integer
      WHERE member_id = OLD.id AND disconnected_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_membership_revoke AFTER UPDATE OF status, role, joined_at ON household_members
  FOR EACH ROW EXECUTE FUNCTION revoke_finance_membership();
--> statement-breakpoint
CREATE FUNCTION revoke_finance_deleted_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    UPDATE finance_connections SET status = 'disconnected', disconnected_at = now(), refresh_on_open = false,
      credentials = NULL, token = NULL, token_expires_at = NULL, accounts = NULL,
      selected_account_id = NULL, operation_id = NULL, operation_started_at = NULL,
      error_code = NULL, updated_at = now(), version = LEAST(version::bigint + 1, 2147483647)::integer
      WHERE disconnected_at IS NULL AND
        ((TG_TABLE_NAME = 'users' AND owner_user_id = NEW.id) OR (TG_TABLE_NAME = 'households' AND household_id = NEW.id));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_user_revoke AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW EXECUTE FUNCTION revoke_finance_deleted_scope();
--> statement-breakpoint
CREATE TRIGGER finance_household_revoke AFTER UPDATE OF deleted_at ON households
  FOR EACH ROW EXECUTE FUNCTION revoke_finance_deleted_scope();
