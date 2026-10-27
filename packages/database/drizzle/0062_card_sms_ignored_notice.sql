-- 카드 결제가 아닌 안내를 실제 결제 파싱 실패와 구분한다.
-- 원문·기존 거래를 변경하지 않는다. 새 상태 사용은 이 마이그레이션 커밋 이후에 한다.
ALTER TYPE "card_sms_parse_status" ADD VALUE IF NOT EXISTS 'ignored';
