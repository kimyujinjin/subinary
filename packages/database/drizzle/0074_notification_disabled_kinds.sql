-- 알림 종류별 끄기(2026-11-05): 여기 든 종류는 푸시만 보내지 않는다 — 알림함 기록은 그대로 남는다.
-- 빈 배열이 기본값이라 기존 행은 지금처럼 모든 종류를 받는다(상수 기본값이라 테이블을 다시 쓰지 않는다).
-- 값은 API가 알림 유형 목록으로 검증한다. 유형을 늘릴 때 마이그레이션이 필요 없도록 DB는 모양만 막는다:
-- NULL 원소 금지(array_position은 IS NOT DISTINCT FROM으로 NULL을 찾는다)와 길이 상한.
ALTER TABLE notification_preferences ADD COLUMN disabled_kinds text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_disabled_kinds_check CHECK (
 disabled_kinds IS NOT NULL
 AND array_position(disabled_kinds, NULL) IS NULL
 AND cardinality(disabled_kinds) <= 32
);
