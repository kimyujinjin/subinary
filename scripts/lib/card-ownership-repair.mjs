import { createHash } from 'node:crypto';

/** @typedef {{ before: Record<string, unknown>; sourceMemberId: string; cardOwnerMemberId: string; cardIsShared: boolean; chainConflict: boolean }} OwnershipCandidate */
/** @typedef {{ id: string; before: Record<string, unknown>; sourceMemberId: string; cardOwnerMemberId: string }} OwnershipRepairEntry */
/** @typedef {{ cardId: string; currency: string; includedApprovalCount: number; netMovedToUnlinked: number }} OwnershipRepairImpact */
/** @typedef {{ version: 1; action: 'unlink_foreign_personal_card'; entries: OwnershipRepairEntry[]; skipped: { id: string; reason: string }[]; impact: { totalNetChange: 0; byCard: OwnershipRepairImpact[] }; digest: string }} OwnershipRepairPlan */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** 수정 계획을 식별하는 결정적 체크섬을 계산한다. @param {unknown} value @returns {string} */
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * 원본 구성원이 확인된 타인 개인 카드 연결만 해제하도록 계획한다.
 * 거래 소유자·금액·취소 관계·공개범위·상태는 모두 보존하고 새 카드를 생성하지 않는다.
 * @param {OwnershipCandidate[]} candidates 읽기 전용 조회 결과
 * @returns {OwnershipRepairPlan} 적용 전 검토할 계획
 */
export function planCardOwnershipRepair(candidates) {
  /** @type {OwnershipRepairEntry[]} */
  const entries = [];
  /** @type {{ id: string; reason: string }[]} */
  const skipped = [];
  for (const candidate of candidates) {
    const row = candidate.before;
    const id = String(row.id);
    let reason = null;
    if (!UUID.test(id) || !UUID.test(String(row.card_id))) reason = 'invalid_identifier';
    else if (row.member_id !== candidate.sourceMemberId) reason = 'source_member_differs';
    else if (candidate.cardIsShared) reason = 'shared_card';
    else if (row.member_id === candidate.cardOwnerMemberId) reason = 'already_owned';
    else if (candidate.chainConflict) reason = 'cancellation_chain_requires_review';
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }
    entries.push({
      id,
      before: row,
      sourceMemberId: candidate.sourceMemberId,
      cardOwnerMemberId: candidate.cardOwnerMemberId,
    });
  }
  /** @type {Map<string, OwnershipRepairImpact>} */
  const impactByCard = new Map();
  for (const entry of entries) {
    const row = entry.before;
    if (row.transaction_type !== 'approval' || row.excluded_at != null) continue;
    const cardId = String(row.card_id);
    const currency = String(row.currency ?? 'unknown');
    const key = `${cardId}:${currency}`;
    const impact = impactByCard.get(key) ?? { cardId, currency, includedApprovalCount: 0, netMovedToUnlinked: 0 };
    impact.includedApprovalCount += 1;
    impact.netMovedToUnlinked += Number(row.net_amount);
    impactByCard.set(key, impact);
  }
  const impact = { totalNetChange: 0, byCard: [...impactByCard.values()] };
  const body = { version: 1, action: 'unlink_foreign_personal_card', entries, skipped, impact };
  return { ...body, digest: digest(body) };
}

/**
 * 파일 변경·잘못된 작업 종류·대상 건수 차이를 적용 전에 차단한다.
 * @param {OwnershipRepairPlan} plan 저장된 계획
 * @param {number} expectedCount 검토한 대상 건수
 * @returns {void}
 */
export function assertCardOwnershipRepairPlan(plan, expectedCount) {
  if (plan?.version !== 1 || plan.action !== 'unlink_foreign_personal_card' ||
      !Array.isArray(plan.entries) || !Array.isArray(plan.skipped)) {
    throw new Error('카드 소유자 정정 계획의 형식이 올바르지 않습니다.');
  }
  const { digest: storedDigest, ...body } = plan;
  if (storedDigest !== digest(body)) throw new Error('정정 계획 체크섬이 달라졌습니다. 다시 계획하세요.');
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount !== plan.entries.length) {
    throw new Error('검토한 대상 건수와 계획이 다릅니다. --expected-count를 확인하세요.');
  }
  const ids = new Set();
  for (const entry of plan.entries) {
    if (!UUID.test(entry.id) || entry.id !== entry.before.id || !UUID.test(String(entry.before.card_id)) ||
        !UUID.test(String(entry.before.source_event_id)) || entry.sourceMemberId !== entry.before.member_id ||
        entry.cardOwnerMemberId === entry.sourceMemberId || ids.has(entry.id)) {
      throw new Error('정정 대상의 식별자 또는 소유자 근거가 올바르지 않습니다.');
    }
    ids.add(entry.id);
  }
}

/** 원문·가맹점·메모·승인번호를 제외한 감사 스냅샷 SQL. */
export const OWNERSHIP_SNAPSHOT_SQL = "to_jsonb(t) - ARRAY['merchant_raw','merchant_normalized','memo','authorization_code']::text[]";

/**
 * 계획된 카드 연결만 원자적으로 해제한다. 중간 충돌 시 전체 롤백하며 재실행은 무변경이다.
 * @param {OwnershipRepairPlan} plan 검토된 계획
 * @param {number} expectedCount 검토한 대상 건수
 * @returns {string} psql 표준 입력으로 전달할 SQL
 */
export function buildCardOwnershipRepairSql(plan, expectedCount) {
  assertCardOwnershipRepairPlan(plan, expectedCount);
  const literal = JSON.stringify(plan).replaceAll("'", "''");
  // 외부 문자열에 DO 블록 구분자가 있어도 코드 경계를 닫지 못하게 한다.
  let blockTag = '$ownership_repair$';
  while (literal.includes(blockTag)) blockTag = `${blockTag.slice(0, -1)}_$`;
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
CREATE TEMP TABLE ownership_repair_result (result jsonb) ON COMMIT DROP;
DO ${blockTag}
DECLARE
  plan jsonb := '${literal}'::jsonb;
  item jsonb;
  current_row jsonb;
  expected_after jsonb;
  after_row jsonb;
  actual_source_member uuid;
  actual_card_owner uuid;
  actual_shared boolean;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(plan->'entries') LOOP
    SELECT ${OWNERSHIP_SNAPSHOT_SQL} INTO current_row
      FROM card_transactions t WHERE t.id=(item->>'id')::uuid FOR UPDATE;
    IF current_row IS NULL THEN RAISE EXCEPTION '정정 대상이 삭제됐습니다. 다시 계획하세요.'; END IF;
    expected_after := (item->'before') || jsonb_build_object('card_id', NULL);
    IF (current_row - 'updated_at') = (expected_after - 'updated_at') THEN
      INSERT INTO ownership_repair_result VALUES (jsonb_build_object('id',item->>'id','status','already_applied','before',item->'before','after',current_row));
      CONTINUE;
    END IF;
    IF current_row <> item->'before' THEN RAISE EXCEPTION '계획 후 거래가 변경됐습니다. 다시 계획하세요.'; END IF;
    SELECT member_id INTO actual_source_member FROM card_sms_events
      WHERE id=(current_row->>'source_event_id')::uuid FOR SHARE;
    SELECT owner_member_id,is_shared INTO actual_card_owner,actual_shared FROM payment_cards
      WHERE id=(current_row->>'card_id')::uuid FOR SHARE;
    IF actual_source_member IS DISTINCT FROM (item->>'sourceMemberId')::uuid OR
       actual_card_owner IS DISTINCT FROM (item->>'cardOwnerMemberId')::uuid OR actual_shared IS DISTINCT FROM false THEN
      RAISE EXCEPTION '원본 구성원 또는 카드 소유 정보가 변경됐습니다. 다시 계획하세요.';
    END IF;
    IF EXISTS (SELECT 1 FROM card_transactions related
      WHERE (related.id=(current_row->>'parent_transaction_id')::uuid OR related.parent_transaction_id=(item->>'id')::uuid)
        AND (related.member_id IS DISTINCT FROM (current_row->>'member_id')::uuid OR related.card_id IS DISTINCT FROM (current_row->>'card_id')::uuid)
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(plan->'entries') planned
          WHERE planned->>'id'=related.id::text AND related.card_id IS NULL AND related.member_id=(current_row->>'member_id')::uuid)
    ) THEN RAISE EXCEPTION '연결된 취소 체인을 먼저 검토해야 합니다.'; END IF;
    UPDATE card_transactions SET card_id=NULL,updated_at=clock_timestamp() WHERE id=(item->>'id')::uuid;
    SELECT ${OWNERSHIP_SNAPSHOT_SQL} INTO after_row FROM card_transactions t WHERE t.id=(item->>'id')::uuid;
    INSERT INTO ownership_repair_result VALUES (jsonb_build_object('id',item->>'id','status','applied','before',item->'before','after',after_row));
  END LOOP;
END
${blockTag};
SELECT jsonb_build_object('digest','${plan.digest}','results',COALESCE(jsonb_agg(result),'[]'::jsonb)) FROM ownership_repair_result;
COMMIT;
`;
}
