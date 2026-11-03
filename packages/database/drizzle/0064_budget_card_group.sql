-- 기존 예산을 자동 전환하지 않는다. 카드 묶음은 사용자 요청으로만 설정한다.
ALTER TYPE "public"."budget_scope_type" ADD VALUE IF NOT EXISTS 'card_group';
--> statement-breakpoint
CREATE FUNCTION budget_card_ids_canonical(input uuid[]) RETURNS uuid[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT ARRAY(SELECT DISTINCT card_id FROM unnest(input) AS card_id WHERE card_id IS NOT NULL ORDER BY card_id)
$$;
--> statement-breakpoint
ALTER TABLE budgets ADD COLUMN card_ids uuid[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
-- enum 추가와 같은 트랜잭션에서도 안전하도록 기존 값만 비교한다.
ALTER TABLE budgets ADD CONSTRAINT budgets_card_group_shape_check CHECK (
  (scope_type IN ('household', 'member', 'category', 'card') AND cardinality(card_ids) = 0)
  OR (scope_type NOT IN ('household', 'member', 'category', 'card')
    AND scope_ref_id IS NULL AND cardinality(card_ids) BETWEEN 2 AND 20
    AND card_ids = budget_card_ids_canonical(card_ids))
);
--> statement-breakpoint
CREATE UNIQUE INDEX budgets_household_month_card_group_unique ON budgets (household_id, effective_month, card_ids)
WHERE scope_type NOT IN ('household', 'member', 'category', 'card');
--> statement-breakpoint
CREATE TABLE budget_scope_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  previous_card_ids uuid[] NOT NULL,
  card_ids uuid[] NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX budget_scope_corrections_budget_id_idx ON budget_scope_corrections (budget_id);
