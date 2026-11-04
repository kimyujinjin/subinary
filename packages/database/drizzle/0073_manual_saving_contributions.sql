-- 적금 자동 납입(2026-11-04): 매월 contribution_day일에 contribution_amount원을 더한다.
-- 현재 적립액은 읽을 때 계산한다(packages/shared manual-savings) — 배치·자동 수정이 없다.
-- 셋 다 비어 있거나, 적금이면서 기준 금액이 있을 때만 계획을 둘 수 있다.
-- IS NOT NULL을 명시한다: `NULL BETWEEN 1 AND 31`은 NULL이고 CHECK는 NULL을 통과시킨다(반쪽 계획이 들어간다).
ALTER TABLE manual_assets ADD COLUMN contribution_amount numeric(20, 0);
--> statement-breakpoint
ALTER TABLE manual_assets ADD COLUMN contribution_day integer;
--> statement-breakpoint
ALTER TABLE manual_assets ADD COLUMN contribution_end_date date;
--> statement-breakpoint
ALTER TABLE manual_assets ADD CONSTRAINT manual_assets_contribution_check CHECK (
 (contribution_amount IS NULL AND contribution_day IS NULL AND contribution_end_date IS NULL)
 OR (kind = 'saving' AND amount IS NOT NULL
  AND contribution_amount IS NOT NULL AND contribution_amount > 0
  AND contribution_day IS NOT NULL AND contribution_day BETWEEN 1 AND 31)
);
