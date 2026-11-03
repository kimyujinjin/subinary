-- 별도 Mac 실행기 grant와 본인 전용 조회 작업이다. 은행·ChatGPT 인증정보를 저장하지 않는다.
-- 이 파일은 주 Drizzle journal과 분리한 모듈 SQL이다. 소유 적용기가 같은 트랜잭션에서 아래 표에 승인한 버전과 파일 해시를 기록한다.
CREATE TABLE mac_bank_runner_schema_migrations (
 version text PRIMARY KEY, sql_sha256 text NOT NULL CHECK(sql_sha256 ~ '^[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE mac_bank_runners (
 id uuid PRIMARY KEY, secret_hash text NOT NULL UNIQUE, user_code_hash text NOT NULL, label text NOT NULL,
 pair_expires_at timestamptz NOT NULL, owner_user_id uuid REFERENCES users(id), household_id uuid REFERENCES households(id),
 member_id uuid REFERENCES household_members(id), member_joined_at timestamptz, grant_expires_at timestamptz,
 last_seen_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mac_bank_runner_hash_check CHECK(secret_hash ~ '^[0-9a-f]{64}$' AND user_code_hash ~ '^[0-9a-f]{64}$'),
 CONSTRAINT mac_bank_runner_label_check CHECK(length(label) BETWEEN 1 AND 40),
 CONSTRAINT mac_bank_runner_scope_check CHECK((owner_user_id IS NULL AND household_id IS NULL AND member_id IS NULL AND member_joined_at IS NULL AND grant_expires_at IS NULL)
  OR (owner_user_id IS NOT NULL AND household_id IS NOT NULL AND member_id IS NOT NULL AND member_joined_at IS NOT NULL AND grant_expires_at IS NOT NULL)),
 CONSTRAINT mac_bank_runner_scope_unique UNIQUE(id,household_id,owner_user_id,member_id,member_joined_at)
);
--> statement-breakpoint
CREATE TABLE mac_bank_runner_jobs (
 id uuid PRIMARY KEY, runner_id uuid NOT NULL, household_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 member_id uuid NOT NULL, member_joined_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'queued',
 claim_id uuid, claimed_at timestamptz, expires_at timestamptz NOT NULL, continue_version integer NOT NULL DEFAULT 0,
 consent_version integer NOT NULL DEFAULT 1, consented_at timestamptz NOT NULL DEFAULT now(),
 error_code text, logout_confirmed boolean NOT NULL DEFAULT false, observations jsonb NOT NULL DEFAULT '[]'::jsonb, completion_hash text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CONSTRAINT mac_bank_job_scope_fk FOREIGN KEY(runner_id,household_id,owner_user_id,member_id,member_joined_at)
  REFERENCES mac_bank_runners(id,household_id,owner_user_id,member_id,member_joined_at),
 CONSTRAINT mac_bank_job_state_check CHECK(state IN ('queued','claimed','running','authentication_required','reading','logging_out','succeeded','failed','cancelled','expired','operation_unknown')),
 CONSTRAINT mac_bank_job_version_check CHECK(continue_version BETWEEN 0 AND 2147483647 AND consent_version=1),
 CONSTRAINT mac_bank_job_capture_check CHECK(jsonb_typeof(observations)='array' AND jsonb_array_length(observations)<=20
  AND (state='succeeded' OR observations='[]'::jsonb)
  AND (state<>'succeeded' OR (logout_confirmed AND jsonb_array_length(observations)>0 AND error_code IS NULL))),
 CONSTRAINT mac_bank_job_completion_check CHECK((state IN ('queued','claimed','running','authentication_required','reading','logging_out') AND completed_at IS NULL)
  OR (state IN ('succeeded','failed','cancelled','expired','operation_unknown') AND completed_at IS NOT NULL)),
 CONSTRAINT mac_bank_job_claim_check CHECK((claim_id IS NULL AND claimed_at IS NULL) OR (claim_id IS NOT NULL AND claimed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX mac_bank_job_owner_active ON mac_bank_runner_jobs(owner_user_id) WHERE state IN ('queued','claimed','running','authentication_required','reading','logging_out');
--> statement-breakpoint
CREATE UNIQUE INDEX mac_bank_job_runner_active ON mac_bank_runner_jobs(runner_id) WHERE state IN ('queued','claimed','running','authentication_required','reading','logging_out');
--> statement-breakpoint
CREATE UNIQUE INDEX mac_bank_job_claim_unique ON mac_bank_runner_jobs(runner_id,claim_id) WHERE claim_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX mac_bank_job_owner_history ON mac_bank_runner_jobs(owner_user_id,household_id,created_at DESC);
--> statement-breakpoint
CREATE FUNCTION guard_mac_bank_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Mac bank job is immutable' USING ERRCODE='55000'; END IF;
 IF OLD.state IN ('succeeded','failed','cancelled','expired','operation_unknown')
  OR ROW(OLD.id,OLD.runner_id,OLD.household_id,OLD.owner_user_id,OLD.member_id,OLD.member_joined_at,OLD.created_at,OLD.consented_at,OLD.consent_version)
  IS DISTINCT FROM ROW(NEW.id,NEW.runner_id,NEW.household_id,NEW.owner_user_id,NEW.member_id,NEW.member_joined_at,NEW.created_at,NEW.consented_at,NEW.consent_version)
  OR (OLD.claim_id IS NOT NULL AND ROW(OLD.claim_id,OLD.claimed_at,OLD.expires_at) IS DISTINCT FROM ROW(NEW.claim_id,NEW.claimed_at,NEW.expires_at)) THEN
  RAISE EXCEPTION 'Mac bank job is immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mac_bank_job_guard BEFORE UPDATE OR DELETE ON mac_bank_runner_jobs FOR EACH ROW EXECUTE FUNCTION guard_mac_bank_job();
--> statement-breakpoint
CREATE FUNCTION revoke_mac_bank_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_TABLE_NAME='household_members' AND (to_jsonb(NEW)->>'status'<>'active' OR to_jsonb(NEW)->>'role'='viewer'
   OR to_jsonb(NEW)->>'joined_at' IS DISTINCT FROM to_jsonb(OLD)->>'joined_at'))
  OR (TG_TABLE_NAME IN ('users','households') AND to_jsonb(NEW)->>'deleted_at' IS NOT NULL) THEN
  UPDATE mac_bank_runners SET revoked_at=COALESCE(revoked_at,now()) WHERE revoked_at IS NULL AND
   ((TG_TABLE_NAME='household_members' AND member_id=OLD.id) OR (TG_TABLE_NAME='users' AND owner_user_id=OLD.id) OR (TG_TABLE_NAME='households' AND household_id=OLD.id));
  UPDATE mac_bank_runner_jobs j SET state='cancelled',error_code=NULL,completed_at=now(),updated_at=now()
   WHERE state IN ('queued','claimed','running','authentication_required','reading','logging_out')
   AND EXISTS(SELECT 1 FROM mac_bank_runners r WHERE r.id=j.runner_id AND r.revoked_at IS NOT NULL);
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mac_bank_member_revoke AFTER UPDATE OF status,role,joined_at ON household_members FOR EACH ROW EXECUTE FUNCTION revoke_mac_bank_scope();
--> statement-breakpoint
CREATE TRIGGER mac_bank_user_revoke AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION revoke_mac_bank_scope();
--> statement-breakpoint
CREATE TRIGGER mac_bank_household_revoke AFTER UPDATE OF deleted_at ON households FOR EACH ROW EXECUTE FUNCTION revoke_mac_bank_scope();
