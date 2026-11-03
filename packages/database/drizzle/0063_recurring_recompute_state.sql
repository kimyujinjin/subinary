-- 후보가 0건인 성공과 아직 계산하지 않은 상태를 구분한다. 기존 거래는 변경하지 않는다.
CREATE TABLE "recurring_recompute_state" (
  "household_id" uuid PRIMARY KEY REFERENCES "households"("id") ON DELETE CASCADE,
  "computed_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
