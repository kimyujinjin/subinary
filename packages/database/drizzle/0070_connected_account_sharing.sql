-- 연결 계좌(토스증권·신한 Mac 조회) 가족 공유 동의. 사람 단위 한 번의 동의로 그 사람의 모든 연결 계좌를 가족 합계에 포함한다.
-- 철회는 행을 지우지 않고 revoked_at으로 남긴다(동의 이력).
CREATE TABLE connected_account_sharing (
 household_id uuid NOT NULL REFERENCES households(id),
 user_id uuid NOT NULL REFERENCES users(id),
 consent_version integer NOT NULL,
 consented_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (household_id, user_id),
 CONSTRAINT connected_account_sharing_version_check CHECK (consent_version > 0)
);
