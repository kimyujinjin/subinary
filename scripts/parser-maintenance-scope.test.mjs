import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSmsRepairScope, assertSmsRepairScopeRows } from './repair-sms-parsing.mjs';
import { maintenanceHash, maintenanceSourceHash } from './lib/parser-maintenance-core.mjs';
const memberId = '11111111-1111-4111-8111-111111111111';
const householdId = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const source = { id, memberId, householdId, sender: '00000000', content: '합성 승인 예시', receivedAt: '2026-01-02T00:05:00.000Z', version: '2026-01-02T00:06:00.000Z', status: 'parse_failed' };
const body = { version: 'parser-maintenance-scope-v1', memberId, householdId, entries: [{ id, snapshotHash: maintenanceSourceHash(source) }] };
const scope = { ...body, digest: maintenanceHash(body) };
const row = { id, memberId, householdId, sender: source.sender, rawContent: source.content, receivedAt: source.receivedAt, updatedAt: source.version, parseStatus: source.status };
const guard = { cardSmsRepairSnapshotHash: value => maintenanceHash([value.id, value.householdId, value.memberId, value.sender, value.rawContent, value.receivedAt.toISOString(), value.updatedAt.toISOString(), value.parseStatus]) };
test('본인/가구/증명된 원본 해시만 재처리 대상으로 인정한다', () => {
  assert.equal(validateSmsRepairScope(scope), scope);
  assert.doesNotThrow(() => assertSmsRepairScopeRows([row], scope, guard));
});
test('다른 회원·가구·SMS·원문·상태 변경과 누락은 거절한다', () => {
  for (const patch of [{ memberId: id }, { householdId: id }, { id: memberId }, { rawContent: '다른 합성 입력' }, { parseStatus: 'parsed' }]) assert.throws(() => assertSmsRepairScopeRows([{ ...row, ...patch }], scope, guard), /sms_repair_scope_source_changed/u);
  assert.throws(() => assertSmsRepairScopeRows([], scope, guard), /sms_repair_scope_source_changed/u);
});
test('scope 훼손·빈 대상·중복·잘못된 식별자는 거절한다', () => {
  for (const value of [null, [], {}, { ...scope, digest: 'a' }, { ...scope, entries: [] }, { ...scope, entries: [scope.entries[0], scope.entries[0]] }, { ...scope, entries: [null] }, { ...scope, memberId: 'any' }]) assert.throws(() => validateSmsRepairScope(value), /sms_repair_invalid_scope/u);
});
