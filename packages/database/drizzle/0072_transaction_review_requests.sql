-- 가족에게 결제 물어보기(확인 요청, 2026-11-04). 받은 사람이 '확인했어요'를 누르거나 물어본 사람이
-- 취소하면 resolved_at이 채워진다. 거래를 지우면 요청도 함께 지운다.
CREATE TABLE transaction_review_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES households(id),
 transaction_id uuid NOT NULL REFERENCES card_transactions(id) ON DELETE CASCADE,
 requester_member_id uuid NOT NULL REFERENCES household_members(id),
 assignee_member_id uuid NOT NULL REFERENCES household_members(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolved_by_member_id uuid REFERENCES household_members(id),
 CONSTRAINT transaction_review_requests_distinct_check CHECK (requester_member_id <> assignee_member_id),
 CONSTRAINT transaction_review_requests_resolved_check CHECK ((resolved_at IS NULL) = (resolved_by_member_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX transaction_review_requests_open_unique ON transaction_review_requests (transaction_id, assignee_member_id) WHERE resolved_at IS NULL;
--> statement-breakpoint
CREATE INDEX transaction_review_requests_open_idx ON transaction_review_requests (household_id, assignee_member_id, requester_member_id) WHERE resolved_at IS NULL;
