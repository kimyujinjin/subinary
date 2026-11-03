-- v1의 소유자 결박은 그대로 유지하고 승인된 grant의 만료 없음만 허용한다.
-- 주 Drizzle journal은 사용하지 않는다. 소유 적용기가 같은 트랜잭션에 v2 버전과 파일 해시를 기록한다.
DO $$
BEGIN
 IF to_regclass('public.mac_bank_runner_schema_migrations') IS NULL OR to_regclass('public.mac_bank_runners') IS NULL THEN
  RAISE EXCEPTION 'Mac runner v1 module is required' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mac_bank_runner_schema_migrations WHERE version='mac-bank-runner-v1')
  OR EXISTS(SELECT 1 FROM public.mac_bank_runner_schema_migrations WHERE version='mac-bank-runner-v2') THEN
  RAISE EXCEPTION 'Mac runner module version must be observed before apply' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.mac_bank_runners'::regclass
   AND conname='mac_bank_runner_scope_check' AND contype='c' AND convalidated) THEN
  RAISE EXCEPTION 'Mac runner v1 scope constraint is required' USING ERRCODE='55000';
 END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE public.mac_bank_runners DROP CONSTRAINT mac_bank_runner_scope_check;
--> statement-breakpoint
ALTER TABLE public.mac_bank_runners ADD CONSTRAINT mac_bank_runner_scope_check CHECK(
 (owner_user_id IS NULL AND household_id IS NULL AND member_id IS NULL AND member_joined_at IS NULL AND grant_expires_at IS NULL)
 OR (owner_user_id IS NOT NULL AND household_id IS NOT NULL AND member_id IS NOT NULL AND member_joined_at IS NOT NULL)
);
