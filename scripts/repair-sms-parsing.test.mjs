import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSmsRepairPlan, smsRepairJobs, validateSmsRepairPlan, verifySmsRepairRows,
} from './repair-sms-parsing.mjs';
import * as repairs from './repair-sms-parsing.mjs';

const approval = '[Web발신]\n현대 네이버 해외승인\n김*수\n10/10 20:46\nKRW 29,000.00\nEXAMPLE*SUBSCRIPTION';
const notice = '토스뱅크 [모임통장 안내]\n가족통장 모임통장 모임금고에 123,456원이 저금됐어요.';
const decline = '[현대카드]해외원화결제차단신청으로 승인거절되었습니다.';
const row = (id, rawContent = approval) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  householdId: 'household', memberId: 'member', sender: 'fixture-secret-sender', rawContent,
  receivedAt: '2026-10-10T20:46:30+09:00', updatedAt: '2026-10-11T00:00:00Z',
  parseStatus: 'parse_failed', transactionCount: 0,
});

test('실패 형식 6건을 원화 승인 2/안내 2/거절 2로 계획하고 원문은 저장하지 않는다', () => {
  const plan = buildSmsRepairPlan([row(1), row(2), row(3, notice), row(4, notice), row(5, decline), row(6, decline)]);
  assert.equal(plan.entries.length, 6);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.entries.filter(entry => entry.expected.promotable).length, 2);
  assert.equal(plan.entries.filter(entry => entry.expected.parseStatus === 'ignored').length, 2);
  assert.equal(plan.entries.filter(entry => entry.expected.transactionType === 'declined').length, 2);
  assert.doesNotMatch(JSON.stringify(plan), /fixture-secret-sender|EXAMPLE|김\*수|rawContent|저금됐어요/);
  validateSmsRepairPlan(plan, 6);
});

test('이미 거래가 있거나 결정적으로 읽히지 않는 문자는 자동 재처리에서 제외한다', () => {
  const plan = buildSmsRepairPlan([{ ...row(1), transactionCount: 1 }, row(2, '새로운 미지원 문자')]);
  assert.equal(plan.entries.length, 0);
  assert.deepEqual(plan.skipped.map(entry => entry.reason), ['already_promoted', 'repair_requires_manual_review']);
});

test('기대 건수·계획 무결성·중복 event·최대 범위를 검증한다', () => {
  const plan = buildSmsRepairPlan([row(1)]);
  assert.throws(() => validateSmsRepairPlan(plan, 2), /sms_repair_count_mismatch/);
  assert.throws(() => validateSmsRepairPlan({ ...plan, createdAt: '변경' }), /sms_repair_invalid_plan/);
  assert.throws(() => buildSmsRepairPlan([row(1), row(1)]), /sms_repair_invalid_candidate/);
  assert.throws(() => buildSmsRepairPlan(Array.from({ length: 101 }, (_, index) => row(index + 1))), /sms_repair_target_limit/);
});

test('재전송은 같은 jobId를 사용하고 자동 재시도와 완료 잡 삭제를 하지 않는다', () => {
  const plan = buildSmsRepairPlan([row(1)]);
  const jobs = smsRepairJobs(plan);
  assert.deepEqual(jobs, smsRepairJobs(plan));
  assert.equal(jobs[0].opts.attempts, 1);
  assert.equal(jobs[0].opts.removeOnComplete, false);
  assert.equal(jobs[0].opts.removeOnFail, false);
  assert.match(jobs[0].opts.jobId, /^smsrepair_[a-f0-9-]+_[a-f0-9]{24}$/);
  assert.equal(jobs[0].data.repair.deterministicOnly, true);
});

test('검증은 큐 완료 대신 실제 상태·거래 수·금액·귀속을 대조한다', () => {
  const plan = buildSmsRepairPlan([row(1), row(2, notice), row(3, decline)]);
  const results = plan.entries.map(entry => ({
    id: entry.id, memberId: 'member', parseStatus: entry.expected.parseStatus,
    transactionType: entry.expected.transactionType, amount: entry.expected.amount, currency: entry.expected.currency,
    transactionCount: entry.expected.promotable ? 1 : 0,
    transactionAmount: entry.expected.amount, transactionCurrency: entry.expected.currency,
    promotedType: entry.expected.transactionType, transactionMemberId: 'member',
  }));
  assert.equal(verifySmsRepairRows(plan, results).filter(result => result.status === 'verified').length, 3);
  for (const changed of [{ transactionCount: 2 }, { transactionAmount: 1 }, { transactionMemberId: 'other' }, { parseStatus: 'parse_failed' }]) {
    assert.equal(verifySmsRepairRows(plan, [{ ...results[0], ...changed }, ...results.slice(1)])[0].status, 'incomplete_or_changed');
  }
  assert.equal(verifySmsRepairRows(plan, [results[0], { ...results[1], transactionCount: 1 }, results[2]])[1].status, 'incomplete_or_changed');
  assert.equal(verifySmsRepairRows(plan, [])[0].status, 'missing');
});

test('원문·갱신시각·수신자 변경은 계획 fingerprint를 바꾼다', () => {
  const first = buildSmsRepairPlan([row(1)]).entries[0].guard;
  for (const changed of [{ rawContent: `${approval}\n변경` }, { updatedAt: '2026-10-12T00:00:00Z' }, { memberId: 'other' }]) {
    const next = buildSmsRepairPlan([{ ...row(1), ...changed }]).entries[0].guard;
    assert.notEqual(next.snapshotHash, first.snapshotHash);
  }
});

/** 완료 응답과 실제 거래가 모두 확인된 합성 행. */
function completed(entry) {
  return {
    id: entry.id, memberId: 'member', parseStatus: entry.expected.parseStatus,
    transactionType: entry.expected.transactionType, amount: entry.expected.amount, currency: entry.expected.currency,
    transactionCount: entry.expected.promotable ? 1 : 0,
    transactionAmount: entry.expected.amount, transactionCurrency: entry.expected.currency,
    promotedType: entry.expected.transactionType, transactionMemberId: 'member',
  };
}

/** BullMQ의 기존 ID 중복 거절과 failed→waiting 전이를 재현한다. */
function retryQueue(plan, states = []) {
  const attempts = [];
  const jobs = new Map(smsRepairJobs(plan).map((definition, index) => {
    const job = {
      id: definition.opts.jobId, name: definition.name, data: definition.data,
      state: states[index] ?? 'failed', attemptsMade: 1, attemptsStarted: 1, finishedOn: 123,
      async getState() { return this.state; },
      async retry(state, options) {
        assert.equal(state, 'failed');
        assert.equal(this.state, 'failed');
        assert.deepEqual(options, { resetAttemptsMade: true, resetAttemptsStarted: true });
        this.attemptsMade = 0; this.attemptsStarted = 0;
        attempts.push(this.id); this.state = 'waiting';
      },
    };
    return [job.id, job];
  }));
  return { attempts, jobs, async getJob(id) { return jobs.get(id); } };
}

test('5건 완료·1건 일시 실패 후 원래 계획에서 실패 잡만 명시적으로 재시도한다', async () => {
  const originals = Array.from({ length: 6 }, (_, index) => row(index + 1));
  const plan = buildSmsRepairPlan(originals);
  const rows = [...plan.entries.slice(0, 5).map(completed), originals[5]];
  // 이전 경로의 원인: 계획은 6건인데 현재 후보는 1건이며 새 계획도 같은 failed jobId다.
  const remaining = buildSmsRepairPlan(rows);
  assert.equal(remaining.entries.length, 1);
  assert.equal(smsRepairJobs(remaining)[0].opts.jobId, smsRepairJobs(plan)[5].opts.jobId);
  const queue = retryQueue(plan, ['completed', 'completed', 'completed', 'completed', 'completed', 'failed']);
  const audit = [];
  const result = await repairs.retrySmsRepairJobs(plan, rows, queue, 1, record => audit.push(record));
  assert.equal(result.retried.length, 1);
  assert.equal(result.skipped.filter(entry => entry.reason === 'already_verified').length, 5);
  assert.deepEqual(queue.attempts, [smsRepairJobs(plan)[5].opts.jobId]);
  assert.equal(audit[0].eligible.length, 1);
  assert.equal(audit[0].eligible[0].state, 'failed');
  await assert.rejects(repairs.retrySmsRepairJobs(plan, rows, queue, 1), /sms_repair_retry_count_mismatch/);
  assert.equal(queue.attempts.length, 1);
});

test('활성·대기·완료·없는 잡과 변경된 원본·payload는 명시적 retry에서도 전송하지 않는다', async () => {
  const originals = Array.from({ length: 8 }, (_, index) => row(index + 1));
  const plan = buildSmsRepairPlan(originals);
  const queue = retryQueue(plan, ['active', 'waiting', 'completed', 'failed', 'failed', 'failed', 'failed', 'failed']);
  const definitions = smsRepairJobs(plan);
  queue.jobs.delete(definitions[3].opts.jobId);
  queue.jobs.get(definitions[6].opts.jobId).data = { cardSmsEventId: originals[6].id, repair: {} };
  const changed = originals.map((source, index) => index === 4 ? { ...source, updatedAt: '2026-10-12T00:00:00Z' }
    : index === 5 ? { ...source, parseStatus: 'parsed', transactionCount: 0 } : source);
  const result = await repairs.retrySmsRepairJobs(plan, changed, queue, 1);
  assert.deepEqual(queue.attempts, [definitions[7].opts.jobId]);
  assert.deepEqual(result.skipped.map(entry => entry.reason), [
    'job_active', 'job_waiting', 'job_completed', 'unknown_job',
    'source_changed_or_partially_applied', 'source_changed_or_partially_applied', 'job_payload_changed',
  ]);
});

test('retry 기대 건수 불일치는 모든 큐 쓰기 전에 중단한다', async () => {
  const originals = [row(1), row(2)];
  const plan = buildSmsRepairPlan(originals);
  const queue = retryQueue(plan);
  const audit = [];
  await assert.rejects(repairs.retrySmsRepairJobs(plan, originals, queue, 1, evidence => audit.push(evidence)), /sms_repair_retry_count_mismatch/);
  assert.equal(queue.attempts.length, 0);
  assert.equal(audit[0].eligible.length, 2);
});

test('재시도 응답이 유실되면 결과 불명과 미시도 범위를 구분하고 후속 전송을 멈춘다', async () => {
  const originals = [row(1), row(2)];
  const plan = buildSmsRepairPlan(originals);
  const queue = retryQueue(plan);
  const definitions = smsRepairJobs(plan);
  const first = queue.jobs.get(definitions[0].opts.jobId);
  first.retry = async function () { this.state = 'waiting'; throw new Error('합성 응답 유실'); };
  const result = await repairs.retrySmsRepairJobs(plan, originals, queue, 2);
  assert.equal(result.retried.length, 0);
  assert.deepEqual(result.unknown, [{ id: originals[0].id, jobId: definitions[0].opts.jobId }]);
  assert.deepEqual(result.notAttempted, [{ id: originals[1].id, jobId: definitions[1].opts.jobId }]);
  assert.equal(queue.attempts.length, 0);
  // 다음의 명시적 retry도 이미 waiting인 첫 잡은 건너뛰고 여전히 failed인 잡만 허용한다.
  const remaining = await repairs.retrySmsRepairJobs(plan, originals, queue, 1);
  assert.deepEqual(remaining.skipped, [{ id: originals[0].id, reason: 'job_waiting' }]);
  assert.deepEqual(queue.attempts, [definitions[1].opts.jobId]);
});
