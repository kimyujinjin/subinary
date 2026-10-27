import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { buildSmsRepairPlan, retrySmsRepairJobs, smsRepairJobs } from './repair-sms-parsing.mjs';

const requireWorker = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const { Queue, Worker, QueueEvents } = requireWorker('bullmq');

test('설치 BullMQ와 격리 Redis에서 명시적 retry가 attempt 1/max 1로 다시 실행된다', {
  skip: process.env.SMS_REPAIR_REDIS_INTEGRATION !== '1', timeout: 30000,
}, async () => {
  const container = `fma-sms-retry-verify-${process.pid}-${Date.now()}`;
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let queue;
  let worker;
  let events;
  try {
    // 운영 컨테이너·환경·포트를 읽지 않는다. Redis 데이터는 메모리에만 두고 종료 시 폐기한다.
    docker(['run', '--detach', '--rm', '--name', container, '--memory', '64m', '--cpus', '0.25', '--pids-limit', '64',
      '--publish', '127.0.0.1::6379', 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no', '--maxmemory', '16mb', '--maxmemory-policy', 'noeviction']);
    const binding = docker(['port', container, '6379/tcp']);
    assert.match(binding, /^127\.0\.0\.1:\d+$/u);
    const connection = { host: '127.0.0.1', port: Number(binding.split(':')[1]), maxRetriesPerRequest: null, connectTimeout: 5000 };
    const prefix = `sms-repair-verification-${process.pid}`;
    queue = new Queue('card-sms-parse', { connection, prefix });
    events = new QueueEvents('card-sms-parse', { connection, prefix });
    await events.waitUntilReady();
    const attempts = [];
    worker = new Worker('card-sms-parse', async job => {
      const attempt = job.attemptsMade + 1;
      const maximumAttempts = job.opts.attempts ?? 1;
      attempts.push({ attemptsMade: job.attemptsMade, attemptsStarted: job.attemptsStarted, attempt, maximumAttempts });
      // 실제 trackPipelineExecution 시작 전 계약과 동일하다. 실패 시 원본은 그대로 남는다.
      if (maximumAttempts < attempt) throw new Error('maximumAttempts must be an integer greater than or equal to attempt');
      if (attempts.length === 1) throw new Error('fixture_database_failure_before_write');
      return { parsed: true };
    }, { connection, prefix });
    worker.on('error', () => undefined);
    const source = {
      id: '00000000-0000-4000-8000-000000000001', householdId: 'household', memberId: 'member', sender: 'fixture',
      rawContent: '[현대카드]해외원화결제차단신청으로 승인거절되었습니다.',
      receivedAt: '2026-10-10T20:46:30+09:00', updatedAt: '2026-10-11T00:00:00Z', parseStatus: 'parse_failed', transactionCount: 0,
    };
    const plan = buildSmsRepairPlan([source]);
    const [first] = await queue.addBulk(smsRepairJobs(plan));
    await assert.rejects(first.waitUntilFinished(events, 10000), /fixture_database_failure_before_write/);
    const failed = await queue.getJob(first.id);
    assert.equal(await failed.getState(), 'failed');
    assert.equal(failed.attemptsMade, 1);
    assert.equal(failed.attemptsStarted, 1);
    const audit = [];
    const outcome = await retrySmsRepairJobs(plan, [source], queue, 1, record => audit.push(record));
    assert.equal(outcome.retried.length, 1);
    const retried = await queue.getJob(first.id);
    assert.deepEqual(await retried.waitUntilFinished(events, 10000), { parsed: true });
    assert.deepEqual(attempts, [
      { attemptsMade: 0, attemptsStarted: 1, attempt: 1, maximumAttempts: 1 },
      { attemptsMade: 0, attemptsStarted: 1, attempt: 1, maximumAttempts: 1 },
    ]);
    assert.equal(audit[0].eligible[0].attemptsMade, 1);
    assert.equal(audit[0].eligible[0].attemptsStarted, 1);
    assert.deepEqual(audit[0].retryOptions, { resetAttemptsMade: true, resetAttemptsStarted: true });
    assert.equal((await queue.getJob(first.id)).id, first.id);
  } finally {
    await worker?.close(true);
    await events?.close();
    await queue?.close();
    try { docker(['stop', '--time', '1', container]); } catch { /* 시작 실패 또는 자동 정리된 컨테이너 */ }
  }
});
