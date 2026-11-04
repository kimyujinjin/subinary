-- v4: 조회 동의 v3(엔진을 특정하지 않는 문구, 2026-11-04 Codex 경로 제거)을 작업에 기록하고 로그인 정보를 받을 수 있게 한다.
-- 기존 작업의 동의 버전·로그인 정보 결박은 바꾸지 않는다. 적용기는 이 파일과 v4 버전/해시 기록을 한 트랜잭션에서 실행한다.
DO $$
BEGIN
 IF to_regclass('public.mac_bank_runner_schema_migrations') IS NULL OR to_regclass('public.mac_bank_runner_jobs') IS NULL THEN
  RAISE EXCEPTION 'Mac runner v3 module is required' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mac_bank_runner_schema_migrations WHERE version='mac-bank-runner-v3')
  OR EXISTS(SELECT 1 FROM public.mac_bank_runner_schema_migrations WHERE version='mac-bank-runner-v4') THEN
  RAISE EXCEPTION 'Mac runner v4 requires v3 and a fresh apply' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.mac_bank_runner_jobs'::regclass
   AND conname='mac_bank_job_version_check' AND contype='c' AND convalidated)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='mac_bank_job_credential_guard') THEN
  RAISE EXCEPTION 'Mac runner v4 expects the v3 version constraint and credential guard' USING ERRCODE='55000';
 END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE public.mac_bank_runner_jobs DROP CONSTRAINT mac_bank_job_version_check;
--> statement-breakpoint
ALTER TABLE public.mac_bank_runner_jobs ADD CONSTRAINT mac_bank_job_version_check
 CHECK(continue_version BETWEEN 0 AND 2147483647 AND consent_version IN (1,2,3));
--> statement-breakpoint
-- v3 함수와 같고, 로그인 정보 일회 전달을 허용하는 조회 동의만 2에서 2·3으로 넓힌다. 트리거는 그대로 이 함수를 부른다.
CREATE OR REPLACE FUNCTION guard_mac_bank_job_credential() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.credential_version IS DISTINCT FROM NEW.credential_version
  OR (OLD.credential_delivered_at IS NOT NULL AND OLD.credential_delivered_at IS DISTINCT FROM NEW.credential_delivered_at)
  OR (OLD.credential_delivered_at IS NULL AND NEW.credential_delivered_at IS NOT NULL
    AND (OLD.state NOT IN ('claimed','running') OR NEW.state<>OLD.state OR OLD.claim_id IS NULL OR OLD.continue_version<>0 OR OLD.consent_version NOT IN (2,3))) THEN
  RAISE EXCEPTION 'Mac bank credential claim binding is immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
