-- 기존 모듈과 별개로 기록하는 v3 암호화 로그인 정보 저장소다. 주 Drizzle journal은 사용하지 않는다.
-- 적용기는 이 파일과 v3 버전/해시 기록을 한 트랜잭션에서 실행한다.
DO $$
BEGIN
 IF to_regclass('public.mac_bank_runner_schema_migrations') IS NULL OR to_regclass('public.mac_bank_runners') IS NULL
  OR to_regclass('public.mac_bank_runner_jobs') IS NULL THEN
  RAISE EXCEPTION 'Mac runner v2 module is required' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mac_bank_runner_schema_migrations WHERE version='mac-bank-runner-v2')
  OR EXISTS(SELECT 1 FROM public.mac_bank_runner_schema_migrations WHERE version='mac-bank-runner-v3')
  OR to_regclass('public.mac_bank_runner_credentials') IS NOT NULL THEN
  RAISE EXCEPTION 'Mac runner v3 requires a fresh owned module apply' USING ERRCODE='55000';
 END IF;
END;
$$;
--> statement-breakpoint
CREATE TABLE mac_bank_runner_credentials (
 id uuid PRIMARY KEY, runner_id uuid NOT NULL UNIQUE, household_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 member_id uuid NOT NULL, member_joined_at timestamptz NOT NULL, version integer NOT NULL,
 envelope jsonb, consent_version integer NOT NULL DEFAULT 1, consented_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mac_bank_credential_scope_fk FOREIGN KEY(runner_id,household_id,owner_user_id,member_id,member_joined_at)
  REFERENCES mac_bank_runners(id,household_id,owner_user_id,member_id,member_joined_at),
 CONSTRAINT mac_bank_credential_version_check CHECK(version BETWEEN 1 AND 2147483646 AND consent_version=1),
 CONSTRAINT mac_bank_credential_envelope_check CHECK(envelope IS NULL OR jsonb_typeof(envelope)='object')
);
--> statement-breakpoint
ALTER TABLE public.mac_bank_runner_jobs ADD COLUMN credential_version integer,
 ADD COLUMN credential_delivered_at timestamptz,
 ADD CONSTRAINT mac_bank_job_credential_check CHECK(
  (credential_version IS NULL OR credential_version BETWEEN 1 AND 2147483646)
  AND (credential_delivered_at IS NULL OR credential_version IS NOT NULL)
 );
--> statement-breakpoint
ALTER TABLE public.mac_bank_runner_jobs DROP CONSTRAINT mac_bank_job_version_check;
--> statement-breakpoint
ALTER TABLE public.mac_bank_runner_jobs ADD CONSTRAINT mac_bank_job_version_check
 CHECK(continue_version BETWEEN 0 AND 2147483647 AND consent_version IN (1,2));
--> statement-breakpoint
CREATE FUNCTION guard_mac_bank_job_credential() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.credential_version IS DISTINCT FROM NEW.credential_version
  OR (OLD.credential_delivered_at IS NOT NULL AND OLD.credential_delivered_at IS DISTINCT FROM NEW.credential_delivered_at)
  OR (OLD.credential_delivered_at IS NULL AND NEW.credential_delivered_at IS NOT NULL
    AND (OLD.state NOT IN ('claimed','running') OR NEW.state<>OLD.state OR OLD.claim_id IS NULL OR OLD.continue_version<>0 OR OLD.consent_version<>2)) THEN
  RAISE EXCEPTION 'Mac bank credential claim binding is immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mac_bank_job_credential_guard BEFORE UPDATE ON mac_bank_runner_jobs FOR EACH ROW EXECUTE FUNCTION guard_mac_bank_job_credential();
--> statement-breakpoint
CREATE FUNCTION discard_mac_bank_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL THEN
  UPDATE mac_bank_runner_credentials SET envelope=NULL,version=LEAST(version+1,2147483646),updated_at=now()
   WHERE runner_id=NEW.id AND envelope IS NOT NULL;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mac_bank_credential_revoke AFTER UPDATE OF revoked_at ON mac_bank_runners FOR EACH ROW EXECUTE FUNCTION discard_mac_bank_credentials();
