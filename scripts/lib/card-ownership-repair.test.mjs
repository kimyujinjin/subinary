import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCardOwnershipRepairPlan, buildCardOwnershipRepairSql, planCardOwnershipRepair } from './card-ownership-repair.mjs';

const self = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const cardId = '00000000-0000-4000-8000-000000000003';
const id = '00000000-0000-4000-8000-000000000004';
const eventId = '00000000-0000-4000-8000-000000000005';

/** @param {Partial<import('./card-ownership-repair.mjs').OwnershipCandidate>} [overrides] */
function candidate(overrides = {}) {
  return {
    before: { id, card_id: cardId, member_id: self, source_event_id: eventId, status: 'duplicate_suspected', transaction_type: 'approval', currency: 'KRW', amount: 5000, net_amount: 4000, cancelled_amount: 1000, parent_transaction_id: null, visibility: 'private', updated_at: '2026-10-27T12:00:00+00:00' },
    sourceMemberId: self, cardOwnerMemberId: other, cardIsShared: false, chainConflict: false,
    ...overrides,
  };
}

test('원본 구성원이 확인된 타인 개인 카드만 계획한다', () => {
  const plan = planCardOwnershipRepair([candidate()]);
  assert.equal(plan.entries.length, 1);
  assert.deepEqual(plan.entries[0].before, candidate().before);
  assert.deepEqual(plan.impact, { totalNetChange: 0, byCard: [{ cardId, currency: 'KRW', includedApprovalCount: 1, netMovedToUnlinked: 4000 }] });
  assertCardOwnershipRepairPlan(plan, 1);
});

test('합계 영향은 취소를 반영한 승인 순액만 계산하고 제외 거래를 더하지 않는다', () => {
  const normal = candidate();
  const cancellation = candidate({ before: { ...normal.before, id: '00000000-0000-4000-8000-000000000006', transaction_type: 'cancellation', net_amount: 0 } });
  const excluded = candidate({ before: { ...normal.before, id: '00000000-0000-4000-8000-000000000007', excluded_at: '2026-10-27T12:00:00Z' } });
  const plan = planCardOwnershipRepair([normal, cancellation, excluded]);
  assert.equal(plan.entries.length, 3);
  assert.equal(plan.impact.byCard[0].netMovedToUnlinked, 4000);
  assert.equal(plan.impact.byCard[0].includedApprovalCount, 1);
  assert.equal(plan.impact.totalNetChange, 0);
});

test('원본 구성원 불일치·공용 카드·이미 본인 카드·취소 체인 충돌은 자동 수정하지 않는다', () => {
  for (const overrides of [
    { sourceMemberId: other }, { cardIsShared: true },
    { cardOwnerMemberId: self }, { chainConflict: true },
  ]) {
    const plan = planCardOwnershipRepair([candidate(overrides)]);
    assert.equal(plan.entries.length, 0);
    assert.equal(plan.skipped.length, 1);
  }
});

test('카드 미연결이나 잘못된 식별자는 대상이 아니다', () => {
  const plan = planCardOwnershipRepair([candidate({ before: { ...candidate().before, card_id: null } })]);
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.skipped[0].reason, 'invalid_identifier');
});

test('대상 건수·내용이 바뀐 계획과 중복 대상은 적용을 막는다', () => {
  const plan = planCardOwnershipRepair([candidate()]);
  assert.throws(() => assertCardOwnershipRepairPlan(plan, 2), /건수/u);
  assert.throws(() => assertCardOwnershipRepairPlan({ ...plan, entries: [] }, 0), /체크섬/u);
  const duplicate = planCardOwnershipRepair([candidate(), candidate()]);
  assert.throws(() => assertCardOwnershipRepairPlan(duplicate, 2), /식별자/u);
});

test('적용 SQL은 금액·상태·구성원을 보존하고 잠금·낡은 계획·재실행을 처리한다', () => {
  const sql = buildCardOwnershipRepairSql(planCardOwnershipRepair([candidate()]), 1);
  assert.match(sql, /BEGIN;/u);
  assert.match(sql, /FOR UPDATE/u);
  assert.match(sql, /current_row <> item->'before'/u);
  assert.match(sql, /already_applied/u);
  assert.match(sql, /SET card_id=NULL,updated_at=clock_timestamp\(\)/u);
  assert.doesNotMatch(sql, /SET (?:amount|status|member_id|net_amount|cancelled_amount|visibility|parent_transaction_id)=/u);
  assert.match(sql, /COMMIT;/u);
});

test('비어 있는 계획도 결정적이며 외부 값을 SQL 문자열 밖으로 내보내지 않는다', () => {
  assert.deepEqual(planCardOwnershipRepair([]), planCardOwnershipRepair([]));
  const value = candidate({ before: { ...candidate().before, extra_note: "x'; DROP TABLE card_transactions; --" } });
  const plan = planCardOwnershipRepair([value]);
  assert.match(buildCardOwnershipRepairSql(plan, 1), /x''; DROP TABLE/u);
  const tagged = planCardOwnershipRepair([candidate({ before: { ...candidate().before, extra_note: '$ownership_repair$' } })]);
  assert.match(buildCardOwnershipRepairSql(tagged, 1), /DO \$ownership_repair_\$/u);
});
