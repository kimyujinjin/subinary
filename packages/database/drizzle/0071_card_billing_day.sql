-- 카드 결제일(매월 며칠). 홈 '다가오는 지출'이 결제일과 지난달 사용액을 보여준다(2026-11-04).
-- 청구액은 저장·계산하지 않는다 — 카드사마다 이용기간 규칙이 달라 틀린 금액이 된다.
ALTER TABLE payment_cards ADD COLUMN billing_day integer;
--> statement-breakpoint
ALTER TABLE payment_cards ADD CONSTRAINT payment_cards_billing_day_check CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 31);
