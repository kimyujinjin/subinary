import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.PARSER_MAINTENANCE_WORKER_TEST === '1';
const pause = () => new Promise(done => setTimeout(done, 250));

// 운영 환경변수·볼륨을 가져오지 않는다. 내부 네트워크의 합성 DB와 Redis만 사용한다.
const runner = String.raw`
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const requireWorker = createRequire('/app/apps/worker/package.json');
requireWorker('reflect-metadata');
const { createDbClient, schema } = requireWorker('@family/database');
const { ConfigService } = requireWorker('@nestjs/config');
const { Queue, QueueEvents, Worker } = requireWorker('bullmq');
const { CardSmsParseProcessor } = requireWorker('./dist/processors/card-sms-parse.processor.js');
const { TransactionPromotionService } = requireWorker('./dist/promotion/transaction-promotion.service.js');
const { MoneyWriteService } = requireWorker('./dist/promotion/money-write.service.js');
const { evaluateCardSmsRepair } = requireWorker('./dist/card-sms/repair-guard.js');
const { runSmsRepairCli } = await import('/app/scripts/repair-sms-parsing.mjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { db, client } = createDbClient(process.env.DATABASE_URL, { max: 4 });
let queue; let events; let consumer;
const forbidden = { model: 0, recipe: 0, category: 0, notification: 0, fx: 0 };
const calls = { process: 0, realtime: 0, shadow: 0 };
const rejectCall = name => async () => { forbidden[name] += 1; throw Error('forbidden_' + name); };
try {
  await client.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
  await client.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await client.unsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  execFileSync('node', ['/app/packages/database/dist/migrate.js'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  const userId = randomUUID(), spouseUserId = randomUUID(), householdId = randomUUID();
  const memberId = randomUUID(), spouseId = randomUUID(), deviceId = randomUUID(), spouseDeviceId = randomUUID(), cardId = randomUUID();
  await db.insert(schema.users).values([
    { id: userId, email: 'synthetic-self@example.invalid', passwordHash: 'synthetic-only', name: '합성 본인' },
    { id: spouseUserId, email: 'synthetic-spouse@example.invalid', passwordHash: 'synthetic-only', name: '합성 배우자' },
  ]);
  await db.insert(schema.households).values({ id: householdId, name: '합성 가구', createdBy: userId });
  await db.insert(schema.householdMembers).values([
    { id: memberId, householdId, userId, role: 'owner' },
    { id: spouseId, householdId, userId: spouseUserId, role: 'member' },
  ]);
  await db.insert(schema.registeredDevices).values([
    { id: deviceId, householdId, memberId, name: '합성 본인 기기', platform: 'android', createdBy: userId },
    { id: spouseDeviceId, householdId, memberId: spouseId, name: '합성 배우자 기기', platform: 'android', createdBy: spouseUserId },
  ]);
  await db.insert(schema.paymentCards).values({ id: cardId, householdId, ownerMemberId: memberId, issuer: '삼성카드', alias: '합성 카드', maskedNumber: '7777', visibility: 'private', createdBy: userId });
  const content = '[Web발신]\n삼성카드 승인 (7777)\n예시님 12,345원 일시불\n01/02 03:04 예시상점';
  const receivedAt = new Date('2026-01-02T00:05:00.000Z'), version = new Date('2026-01-02T00:06:00.000Z');
  const targetId = randomUUID(), excludedId = randomUUID(), spouseEventId = randomUUID(), tamperedId = randomUUID();
  for (const [id, owner, device] of [[targetId, memberId, deviceId], [excludedId, memberId, deviceId], [spouseEventId, spouseId, spouseDeviceId], [tamperedId, memberId, deviceId]]) {
    const sourceId = randomUUID();
    await db.insert(schema.sourceItems).values({ id: sourceId, householdId, memberId: owner, deviceId: device, kind: 'card_sms', objectKey: 'synthetic/' + id, contentHash: id, receivedAt });
    await db.insert(schema.cardSmsEvents).values({ id, householdId, memberId: owner, deviceId: device, sourceItemId: sourceId, eventId: id, sender: '15888700', rawContent: content, contentHash: id, receivedAt, updatedAt: version, parseStatus: 'parse_failed' });
  }
  const getEvent = async id => (await client.unsafe('select * from card_sms_events where id=$1', [id]))[0];
  const excludedBefore = await getEvent(excludedId), spouseBefore = await getEvent(spouseEventId), tamperedBefore = await getEvent(tamperedId);
  const scopeBody = { version: 'parser-maintenance-scope-v1', memberId, householdId, entries: [{ id: targetId, snapshotHash: hash([targetId, householdId, memberId, '15888700', content, receivedAt.toISOString(), version.toISOString(), 'parse_failed']) }] };
  const scope = { ...scopeBody, digest: hash(scopeBody) };
  const scopeFile = '/tmp/scope.json', planFile = '/tmp/plan.json';
  writeFileSync(scopeFile, JSON.stringify(scope), { mode: 0o600 });
  const cli = (command, extra = []) => runSmsRepairCli([command, planFile, '--scope-file=' + scopeFile, ...extra]);
  assert.equal((await cli('plan')).targets, 1);
  const connection = { host: process.env.REDIS_HOST, port: 6379, maxRetriesPerRequest: null };
  const prefix = process.env.BULLMQ_PREFIX;
  queue = new Queue('card-sms-parse', { connection, prefix });
  events = new QueueEvents('card-sms-parse', { connection, prefix });
  await events.waitUntilReady();
  await cli('apply', ['--expected-count=1']);
  const queued = await queue.getJobs(['wait']);
  assert.equal(queued.length, 1); assert.equal(queued[0].data.cardSmsEventId, targetId);
  const config = new ConfigService({ app: { nodeEnv: 'production' }, ai: { cardSmsActionGate: 'on' } });
  const runtime = { contractMode: 'v2', isPromotionPaused: false, register() {} };
  const promotion = new TransactionPromotionService(db,
    { add: rejectCall('category') }, { add: rejectCall('notification') },
    new Proxy({}, { get: () => rejectCall('fx') }), { observe: async () => { calls.shadow += 1; } },
    new MoneyWriteService(db, runtime), config, runtime);
  const processor = new CardSmsParseProcessor(db, promotion,
    { publish: async () => { calls.realtime += 1; } },
    { enabled: true, appliesResult: true, extract: rejectCall('model') },
    { extract: rejectCall('recipe') }, runtime, config);
  consumer = new Worker('card-sms-parse', async job => { calls.process += 1; return processor.process(job); }, { connection, prefix, concurrency: 1 });
  consumer.on('error', () => undefined);
  const result = await queued[0].waitUntilFinished(events, 15000);
  assert.equal(result.parseStatus, 'parsed');
  assert.equal((await cli('verify')).verified, 1);
  const actual = await getEvent(targetId);
  assert.equal(actual.amount, 12345); assert.equal(actual.currency, 'KRW'); assert.equal(actual.transaction_type, 'approval');
  const transactions = await client.unsafe('select * from card_transactions');
  assert.equal(transactions.length, 1); assert.equal(transactions[0].source_event_id, targetId);
  assert.equal(transactions[0].member_id, memberId); assert.equal(transactions[0].card_id, cardId);
  assert.equal(transactions[0].amount, 12345); assert.equal(transactions[0].currency, 'KRW');
  assert.deepEqual(await getEvent(excludedId), excludedBefore); assert.deepEqual(await getEvent(spouseEventId), spouseBefore);
  assert.equal((await cli('apply', ['--expected-count=1'])).mode, 'already_verified');
  assert.equal((await queue.getJobCounts('completed', 'waiting', 'active')).completed, 1);
  const badGuard = evaluateCardSmsRepair({ id: tamperedId, householdId, memberId, sender: '15888700', rawContent: content, receivedAt, updatedAt: version, parseStatus: 'parse_failed' }).guard;
  const badJob = await queue.add('repair-deterministic-v1', { cardSmsEventId: tamperedId, repair: { ...badGuard, resultHash: '0'.repeat(64) } }, { jobId: 'synthetic-tampered-guard', attempts: 1 });
  await assert.rejects(badJob.waitUntilFinished(events, 15000), /repair_snapshot_or_parser_changed/);
  assert.deepEqual(await getEvent(tamperedId), tamperedBefore);
  assert.equal((await client.unsafe('select count(*)::int as count from card_transactions'))[0].count, 1);
  const duplicate = await queue.add('repair-deterministic-v1', queued[0].data, { jobId: 'synthetic-duplicate-event', attempts: 1 });
  await assert.rejects(duplicate.waitUntilFinished(events, 15000), /repair_already_promoted/);
  assert.equal((await client.unsafe('select count(*)::int as count from card_transactions'))[0].count, 1);
  assert.deepEqual(forbidden, { model: 0, recipe: 0, category: 0, notification: 0, fx: 0 });
  assert.equal(calls.process, 3); assert.equal(calls.realtime, 1); assert.equal(calls.shadow, 1);
  const runs = await client.unsafe('select status from pipeline_runs order by created_at');
  assert.equal(runs.length, 3); assert.equal(runs.filter(row => row.status === 'succeeded').length, 1);
  assert.equal(runs.filter(row => row.status === 'failed').length, 2);
  const steps = await client.unsafe('select attempt from pipeline_step_runs');
  assert.equal(steps.length, 3); assert.ok(steps.every(row => row.attempt === 1));
  console.log('WORKER_E2E_RESULT ' + JSON.stringify({ actualProcessorInvocations: calls.process, transactionsCreated: 1, excludedEventsUnchanged: 2, tamperedGuardRejected: true, duplicateRejected: true, forbiddenCalls: forbidden, productionWrites: 0 }));
} finally {
  await consumer?.close(true); await events?.close(); await queue?.close(); await client.end({ timeout: 5 });
}
`;

test('격리 실제 worker가 지정 실패 SMS만 거래로 만들고 변조·중복을 차단한다', { skip: !enabled, timeout: 120000 }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const network = `fma-worker-e2e-${suffix}`;
  const pg = `${network}-pg`, redis = `${network}-redis`, app = `${network}-app`;
  const dir = mkdtempSync(join(tmpdir(), 'fma-worker-e2e-'));
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 90000, maxBuffer: 4 * 1024 * 1024 }).trim();
  try {
    const image = docker(['image', 'inspect', '--format', '{{.Id}}', 'family-memory-ai/prod:sms-automation-20261029']);
    assert.match(image, /^sha256:[a-f0-9]{64}$/u);
    docker(['network', 'create', '--internal', network]);
    docker(['run', '-d', '--rm', '--name', pg, '--network', network, '--network-alias', 'test-postgres', '-e', 'POSTGRES_PASSWORD=synthetic-test-only', '-e', 'POSTGRES_DB=family_worker_test', 'pgvector/pgvector:pg17']);
    docker(['run', '-d', '--rm', '--name', redis, '--network', network, '--network-alias', 'test-redis', 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no']);
    for (let i = 0; i < 80; i += 1) {
      try { docker(['exec', pg, 'pg_isready', '-U', 'postgres']); break; } catch { await pause(); }
    }
    const script = join(dir, 'runner.mjs'); writeFileSync(script, runner, { mode: 0o600 });
    const output = docker(['run', '--rm', '--name', app, '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '768m', '--cpus', '2', '--pids-limit', '128', '--user', '0:0', '--entrypoint', 'node',
      '--tmpfs', '/tmp:rw,size=64m', '--tmpfs', '/app/.deploy-logs:ro,size=1m',
      '--mount', `type=bind,src=${script},dst=/runner.mjs,readonly`,
      '--mount', `type=bind,src=${join(ROOT, 'scripts/repair-sms-parsing.mjs')},dst=/app/scripts/repair-sms-parsing.mjs,readonly`,
      '-e', 'DATABASE_URL=postgres://postgres:synthetic-test-only@test-postgres:5432/family_worker_test', '-e', 'REDIS_HOST=test-redis', '-e', 'REDIS_PORT=6379', '-e', `BULLMQ_PREFIX=${network}`, image, '/runner.mjs']);
    const resultLine = output.split('\n').find(line => line.startsWith('WORKER_E2E_RESULT '));
    assert.ok(resultLine, '실제 worker 완료 결과가 있어야 한다.');
    const result = JSON.parse(resultLine.slice('WORKER_E2E_RESULT '.length));
    assert.equal(result.actualProcessorInvocations, 3); assert.equal(result.transactionsCreated, 1); assert.equal(result.productionWrites, 0);
  } finally {
    for (const name of [app, redis, pg]) { try { docker(['rm', '-f', name]); } catch { /* 생성한 검증 자원만 정리한다. */ } }
    try { docker(['network', 'rm', network]); } catch { /* 시작 실패 시 네트워크가 없을 수 있다. */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
