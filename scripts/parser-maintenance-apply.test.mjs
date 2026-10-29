import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMaintenanceApply } from './lib/parser-maintenance-apply-flow.mjs';
function setup(patch = {}) {
  const calls = [];
  return { calls, io: { targets: 1, deploy: async () => { calls.push('deploy'); }, healthy: async () => true,
    rollback: async () => { calls.push('rollback'); }, plan: async () => ({ targets: 1 }), enqueue: async () => { calls.push('enqueue'); },
    verify: async () => ({ verified: 1, total: 1 }), wait: async () => {}, ...patch } };
}
test('배포와 실제 재처리 검증까지 끝나야 완료다', async () => {
  const { calls, io } = setup(); assert.equal((await executeMaintenanceApply(io)).status, 'verified'); assert.deepEqual(calls, ['deploy', 'enqueue']);
});
test('health 실패는 이전 이미지 복구를 확인하고 큐를 보내지 않는다', async () => {
  let checks = 0; const { calls, io } = setup({ healthy: async () => ++checks > 1 });
  assert.equal((await executeMaintenanceApply(io)).status, 'rolled_back'); assert.deepEqual(calls, ['deploy', 'rollback']);
});
test('복구 실패를 정상으로 보고하지 않는다', async () => {
  const { io } = setup({ deploy: async () => { throw Error(); }, rollback: async () => { throw Error(); } }); assert.equal((await executeMaintenanceApply(io)).status, 'rollback_failed');
});
test('scope 대상 수가 다르면 재처리하지 않는다', async () => {
  const { calls, io } = setup({ plan: async () => ({ targets: 2 }) }); assert.equal((await executeMaintenanceApply(io)).phase, 'scope_plan'); assert.deepEqual(calls, ['deploy']);
});
test('큐 응답 유실 뒤 실제 결과가 맞으면 완료, 중복 전송은 없다', async () => {
  let sends = 0; const { io } = setup({ enqueue: async () => { sends += 1; throw Error(); } }); assert.equal((await executeMaintenanceApply(io)).status, 'verified'); assert.equal(sends, 1);
});
test('결과 불명과 미완료를 분리하며 거래를 되돌리지 않는다', async () => {
  for (const unknown of [false, true]) {
    let verifies = 0;
    const { calls, io } = setup({ enqueue: async () => { if (unknown) throw Error(); }, verify: async () => { verifies += 1; return { total: 1, verified: 0 }; } });
    assert.equal((await executeMaintenanceApply(io)).status, unknown ? 'repair_outcome_unknown' : 'repair_incomplete'); assert.equal(verifies, 15); assert.deepEqual(calls, ['deploy']);
  }
});
