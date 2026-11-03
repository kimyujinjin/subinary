#!/usr/bin/env node
/**
 * 수정된 worker 이미지 안에서 실행하는 문자 실패 재처리 도구. 기본 plan은 DB 읽기 전용이다.
 * plan [계획파일] → apply <계획파일> --expected-count=N → verify <계획파일>
 * 일시 실패 복구: retry <원래 계획파일> --expected-count=<원본 그대로인 failed 잡 수>
 * apply는 기존 큐/승격 경로를 재사용하며 DB에 거래를 직접 생성하지 않는다.
 * 원문·가맹점·환경 비밀은 출력/저장하지 않는다. 계획·영수증 파일은 0600으로 생성한다.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requireWorker = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const PLAN_VERSION = 'sms-parsing-repair-plan-v1';
const MAX_TARGETS = 100;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

/** @param {unknown} value @returns {string} */
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** 빌드된 소비자와 같은 순수 가드를 사용한다. 구 이미지에는 이 모듈이 없으므로 실행되지 않는다. */
function runtime() { return requireWorker('./dist/card-sms/repair-guard.js'); }

/** @param {Record<string, unknown>} row 원문은 이 함수 내부의 판정과 해시에만 사용한다. */
function snapshot(row) {
  return {
    id: row.id, householdId: row.householdId, memberId: row.memberId,
    sender: row.sender, rawContent: row.rawContent,
    receivedAt: new Date(row.receivedAt), updatedAt: new Date(row.updatedAt), parseStatus: row.parseStatus,
  };
}

/** @param {Record<string, unknown>[]} rows @param {ReturnType<typeof runtime>} guardRuntime */
export function buildSmsRepairPlan(rows, guardRuntime = runtime()) {
  if (rows.length > MAX_TARGETS) throw new Error('sms_repair_target_limit');
  const entries = [];
  const skipped = [];
  const seen = new Set();
  for (const row of [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (typeof row.id !== 'string' || !UUID.test(row.id) || seen.has(row.id)) throw new Error('sms_repair_invalid_candidate');
    seen.add(row.id);
    if (Number(row.transactionCount) !== 0) { skipped.push({ id: row.id, reason: 'already_promoted' }); continue; }
    try {
      const { result, disposition, guard } = guardRuntime.evaluateCardSmsRepair(snapshot(row));
      entries.push({
        id: row.id, guard,
        expected: {
          parseStatus: disposition.parseStatus, transactionType: result.transactionType,
          promotable: disposition.promotable, amount: result.amount ?? null, currency: result.currency ?? null,
        },
      });
    } catch (error) {
      const reason = error instanceof Error && /^repair_[a-z_]+$/u.test(error.message) ? error.message : 'invalid_source';
      skipped.push({ id: row.id, reason });
    }
  }
  const plan = { version: PLAN_VERSION, guardVersion: guardRuntime.CARD_SMS_REPAIR_VERSION, createdAt: new Date().toISOString(), entries, skipped };
  return { ...plan, digest: digest(plan) };
}

/**
 * Dot 파서 개선이 증명한 본인/가구/원본만 한정한다. 기존 수동 CLI의 기본 동작은 유지한다.
 * @param {unknown} scope @returns {{version:string,memberId:string,householdId:string,entries:{id:string,snapshotHash:string}[],digest:string}}
 */
export function validateSmsRepairScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('sms_repair_invalid_scope');
  const { digest: expectedDigest, ...body } = scope;
  if (scope.version !== 'parser-maintenance-scope-v1' || !UUID.test(scope.memberId) || !UUID.test(scope.householdId)
    || !Array.isArray(scope.entries) || scope.entries.length < 1 || scope.entries.length > MAX_TARGETS
    || scope.entries.some(entry => !entry || typeof entry !== 'object' || !UUID.test(entry.id) || !/^[a-f0-9]{64}$/u.test(entry.snapshotHash))
    || new Set(scope.entries.map(entry => entry.id)).size !== scope.entries.length || digest(body) !== expectedDigest) throw new Error('sms_repair_invalid_scope');
  return scope;
}

/** @param {Record<string, unknown>[]} rows @param {ReturnType<typeof validateSmsRepairScope>} scope @param {ReturnType<typeof runtime>} guardRuntime */
export function assertSmsRepairScopeRows(rows, scope, guardRuntime = runtime()) {
  validateSmsRepairScope(scope);
  const expected = new Map(scope.entries.map(entry => [entry.id, entry.snapshotHash]));
  if (rows.length !== expected.size || rows.some(row => row.memberId !== scope.memberId || row.householdId !== scope.householdId
    || !expected.has(row.id) || guardRuntime.cardSmsRepairSnapshotHash(snapshot(row)) !== expected.get(row.id))) throw new Error('sms_repair_scope_source_changed');
}

/** @param {ReturnType<typeof buildSmsRepairPlan>} plan @param {number|undefined} expectedCount */
export function validateSmsRepairPlan(plan, expectedCount) {
  const { digest: expectedDigest, ...body } = plan;
  if (plan.version !== PLAN_VERSION || digest(body) !== expectedDigest ||
      !Array.isArray(plan.entries) || plan.entries.length > MAX_TARGETS ||
      new Set(plan.entries.map(entry => entry.id)).size !== plan.entries.length ||
      plan.entries.some(entry => !UUID.test(entry.id) || entry.guard?.version !== plan.guardVersion || entry.guard?.deterministicOnly !== true || !/^[a-f0-9]{64}$/u.test(entry.guard.snapshotHash) || !/^[a-f0-9]{64}$/u.test(entry.guard.resultHash))) {
    throw new Error('sms_repair_invalid_plan');
  }
  if (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount !== plan.entries.length)) {
    throw new Error('sms_repair_count_mismatch');
  }
}

/** 고정 ID를 완료/실패 후에도 보존한다. 결과 불명 때 같은 계획을 재전송해도 잡을 늘리지 않는다. */
export function smsRepairJobs(plan) {
  validateSmsRepairPlan(plan);
  return plan.entries.map(entry => ({
    name: 'repair-deterministic-v1',
    data: { cardSmsEventId: entry.id, repair: entry.guard },
    opts: {
      jobId: `smsrepair_${entry.id}_${entry.guard.snapshotHash.slice(0, 24)}`,
      attempts: 1, removeOnComplete: false, removeOnFail: false,
    },
  }));
}

/** @param {ReturnType<typeof buildSmsRepairPlan>} plan @param {Record<string, unknown>[]} rows */
export function verifySmsRepairRows(plan, rows) {
  validateSmsRepairPlan(plan);
  const actual = new Map(rows.map(row => [row.id, row]));
  return plan.entries.map(entry => {
    const row = actual.get(entry.id);
    if (!row) return { id: entry.id, status: 'missing' };
    const expected = entry.expected;
    const count = Number(row.transactionCount);
    const smsMatches = row.parseStatus === expected.parseStatus && row.transactionType === expected.transactionType &&
      row.amount === expected.amount && row.currency === expected.currency;
    const transactionMatches = expected.promotable
      ? count === 1 && row.transactionAmount === expected.amount && row.transactionCurrency === expected.currency && row.promotedType === expected.transactionType && row.transactionMemberId === row.memberId
      : count === 0;
    return { id: entry.id, status: smsMatches && transactionMatches ? 'verified' : 'incomplete_or_changed', parseStatus: row.parseStatus, transactionCount: count };
  });
}

/**
 * 확인된 실패 잡만 명시적으로 재시도한다. 완료·진행 중·결과 불명·변경된 원본은 제외한다.
 * 새 잡 생성/잡 삭제는 하지 않으며 BullMQ의 원자적 failed 상태 전이를 사용한다.
 */
export async function retrySmsRepairJobs(plan, rows, queue, expectedCount, onPrepared = () => undefined) {
  validateSmsRepairPlan(plan);
  const verified = new Map(verifySmsRepairRows(plan, rows).map(entry => [entry.id, entry.status]));
  const actual = new Map(rows.map(row => [row.id, row]));
  const definitions = smsRepairJobs(plan);
  const eligible = [];
  const skipped = [];
  for (const [index, entry] of plan.entries.entries()) {
    if (verified.get(entry.id) === 'verified') { skipped.push({ id: entry.id, reason: 'already_verified' }); continue; }
    const source = actual.get(entry.id);
    if (!source) { skipped.push({ id: entry.id, reason: 'missing_source' }); continue; }
    const current = buildSmsRepairPlan([source]);
    if (JSON.stringify(current.entries[0]) !== JSON.stringify(entry)) {
      skipped.push({ id: entry.id, reason: 'source_changed_or_partially_applied' }); continue;
    }
    const definition = definitions[index];
    const job = await queue.getJob(definition.opts.jobId);
    if (!job) { skipped.push({ id: entry.id, reason: 'unknown_job' }); continue; }
    if (job.name !== definition.name || job.data?.cardSmsEventId !== entry.id || JSON.stringify(job.data?.repair) !== JSON.stringify(entry.guard)) {
      skipped.push({ id: entry.id, reason: 'job_payload_changed' }); continue;
    }
    const state = await job.getState();
    if (state !== 'failed') {
      skipped.push({ id: entry.id, reason: ['active', 'waiting', 'delayed', 'completed', 'paused', 'waiting-children'].includes(state) ? `job_${state}` : 'unknown_job_state' });
      continue;
    }
    eligible.push({ id: entry.id, jobId: definition.opts.jobId, state, attemptsMade: job.attemptsMade, attemptsStarted: job.attemptsStarted, finishedOn: job.finishedOn ?? null, job });
  }
  // 명시적 재시도도 한 번의 새 실행이다. 이전 횟수는 감사에 보존하고 큐 카운터만
  // 초기화해야 worker의 attempt=attemptsMade+1이 maximumAttempts=1을 넘지 않는다.
  const retryOptions = { resetAttemptsMade: true, resetAttemptsStarted: true };
  const evidence = { checkedAt: new Date().toISOString(), digest: plan.digest, retryOptions, eligible: eligible.map(({ job, ...entry }) => entry), skipped };
  // 건수가 어긋나도 쓰기 없는 사전 판정 결과를 남겨 실제 재시도 범위를 확인할 수 있게 한다.
  onPrepared(evidence);
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || eligible.length !== expectedCount) throw new Error('sms_repair_retry_count_mismatch');
  const retried = [];
  for (const [index, candidate] of eligible.entries()) {
    try {
      // 사전 조회 후 다른 실행이 잡을 옮기면 BullMQ가 거절한다. 강제 삭제/새 ID 우회는 없다.
      await candidate.job.retry('failed', retryOptions);
      retried.push({ id: candidate.id, jobId: candidate.jobId });
    } catch {
      return {
        retryOptions, retried, skipped, unknown: [{ id: candidate.id, jobId: candidate.jobId }],
        notAttempted: eligible.slice(index + 1).map(({ id, jobId }) => ({ id, jobId })),
      };
    }
  }
  return { retryOptions, retried, skipped, unknown: [], notAttempted: [] };
}

/** 소비자와 같은 환경값만 사용하며 큐를 생성한 사실만으로 작업을 등록하지 않는다. */
function connectQueue() {
  const { Queue } = requireWorker('bullmq');
  if (!process.env.REDIS_HOST || !process.env.BULLMQ_PREFIX) throw new Error('sms_repair_queue_config_required');
  const queue = new Queue('card-sms-parse', {
    connection: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT ?? 6379), maxRetriesPerRequest: 1, connectTimeout: 5000 },
    prefix: process.env.BULLMQ_PREFIX,
  });
  queue.on('error', () => undefined);
  return queue;
}

/** @param {string} path @param {unknown} value */
function saveAudit(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

/** 모든 명령이 DB 조회에는 같은 readonly 트랜잭션을 사용한다. */
async function readRows(sql, ids, scope) {
  if (ids?.length === 0) return [];
  return sql.begin('read only', async tx => {
    await tx`set local statement_timeout = '10s'`;
    return tx`
      select e.id, e.household_id as "householdId", e.member_id as "memberId",
        e.sender, e.raw_content as "rawContent", e.received_at as "receivedAt", e.updated_at as "updatedAt",
        e.parse_status as "parseStatus", e.transaction_type as "transactionType", e.amount, e.currency,
        (select count(*)::int from card_transactions t where t.source_event_id=e.id) as "transactionCount",
        t.amount as "transactionAmount", t.currency as "transactionCurrency",
        t.transaction_type as "promotedType", t.member_id as "transactionMemberId"
      from card_sms_events e left join card_transactions t on t.source_event_id=e.id
      where ${ids ? tx`e.id in ${tx(ids)}` : tx`e.parse_status='parse_failed'`}
        ${scope ? tx`and e.member_id=${scope.memberId} and e.household_id=${scope.householdId}` : tx``}
      order by e.id limit ${MAX_TARGETS + 1}`;
  });
}

/** 컨테이너 내부 환경만 사용하며 DB·Redis 연결 문자열을 오류로 출력하지 않는다. */
export async function runSmsRepairCli(args = process.argv.slice(2)) {
  const [command = 'plan', suppliedFile, ...options] = args;
  if (!['plan', 'apply', 'verify', 'retry'].includes(command)) throw new Error('sms_repair_unknown_command');
  if (command !== 'plan' && !suppliedFile) throw new Error('sms_repair_plan_required');
  const guardRuntime = runtime();
  const path = resolve(suppliedFile ?? `.deploy-logs/sms-parsing/plan-${Date.now()}.json`);
  const plan = command === 'plan' ? null : JSON.parse(readFileSync(path, 'utf8'));
  const scopeFile = options.find(option => option.startsWith('--scope-file='))?.slice('--scope-file='.length);
  const scope = scopeFile ? validateSmsRepairScope(JSON.parse(readFileSync(resolve(scopeFile), 'utf8'))) : undefined;
  if (plan?.scope && (!scope || scope.digest !== plan.scope.digest)) throw new Error('sms_repair_scope_required');
  const rawCount = options.find(option => option.startsWith('--expected-count='))?.slice('--expected-count='.length);
  if (['apply', 'retry'].includes(command) && (!rawCount || !/^\d+$/u.test(rawCount))) throw new Error('sms_repair_expected_count_required');
  if (plan) {
    validateSmsRepairPlan(plan, command === 'apply' ? Number(rawCount) : undefined);
    if (plan.guardVersion !== guardRuntime.CARD_SMS_REPAIR_VERSION) throw new Error('sms_repair_worker_version_mismatch');
  }
  if (!process.env.DATABASE_URL) throw new Error('sms_repair_database_config_required');
  const postgres = requireWorker('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 5 });
  let queue;
  try {
    const rows = await readRows(sql, plan?.entries.map(entry => entry.id) ?? scope?.entries.map(entry => entry.id), scope);
    if (command === 'plan') {
      if (scope) assertSmsRepairScopeRows(rows, scope, guardRuntime);
      const generated = buildSmsRepairPlan(rows, guardRuntime);
      if (scope && (generated.entries.length !== scope.entries.length || generated.skipped.length > 0)) throw new Error('sms_repair_scope_not_fully_resolved');
      // 기존 plan digest 계약을 유지하면서 scope도 내용 해시에 포함한다.
      const { digest: _digest, ...body } = generated;
      const scoped = scope ? { ...body, scope: { digest: scope.digest, memberId: scope.memberId, householdId: scope.householdId } } : body;
      const savedPlan = { ...scoped, digest: digest(scoped) };
      saveAudit(path, savedPlan);
      return { mode: 'read_only_plan', targets: generated.entries.length, skipped: generated.skipped.length, plan: path, digest: savedPlan.digest };
    }
    if (command === 'verify') {
      const results = verifySmsRepairRows(plan, rows);
      const receipt = `${path}.${Date.now()}.verify.json`;
      saveAudit(receipt, { checkedAt: new Date().toISOString(), digest: plan.digest, results });
      return { mode: 'read_only_verify', verified: results.filter(result => result.status === 'verified').length, total: results.length, receipt };
    }
    if (command === 'retry') {
      queue = connectQueue();
      const receipt = `${path}.${Date.now()}.retry.json`;
      const results = await retrySmsRepairJobs(plan, rows, queue, Number(rawCount), evidence => {
        saveAudit(`${receipt}.prepared`, evidence);
      });
      saveAudit(receipt, { completedAt: new Date().toISOString(), digest: plan.digest, ...results });
      return {
        mode: results.unknown.length > 0 ? 'retry_outcome_unknown' : 'retried_not_verified',
        targets: results.retried.length, skipped: results.skipped.length, receipt, next: `verify ${path}`,
      };
    }
    // 이미 적용됐으면 새 작업을 만들지 않고 검증 결과만 반환한다.
    const verification = verifySmsRepairRows(plan, rows);
    if (verification.every(result => result.status === 'verified')) return { mode: 'already_verified', targets: verification.length, digest: plan.digest };
    if (scope) assertSmsRepairScopeRows(rows, scope, guardRuntime);
    const current = buildSmsRepairPlan(rows, guardRuntime);
    if (JSON.stringify(current.entries) !== JSON.stringify(plan.entries)) throw new Error('sms_repair_snapshot_changed_verify_first');
    const jobs = smsRepairJobs(plan);
    const receipt = `${path}.${Date.now()}.apply.json`;
    saveAudit(`${receipt}.prepared`, { preparedAt: new Date().toISOString(), digest: plan.digest, jobs });
    // 읽기와 유효성 검사가 끝난 뒤에만 Redis 연결과 큐 쓰기를 시작한다.
    queue = connectQueue();
    await queue.addBulk(jobs);
    saveAudit(receipt, { enqueuedAt: new Date().toISOString(), digest: plan.digest, jobIds: jobs.map(job => job.opts.jobId), status: 'enqueued_not_verified' });
    return { mode: 'enqueued_not_verified', targets: jobs.length, receipt, next: `verify ${path}` };
  } finally {
    await queue?.close();
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSmsRepairCli().then(result => {
    console.log(JSON.stringify(result));
    if (result.mode === 'retry_outcome_unknown') process.exitCode = 1;
  }).catch(error => {
    // PostgreSQL/BullMQ의 원시 오류에는 SQL·원문·접속 정보가 포함될 수 있다.
    const message = error instanceof Error && /^sms_repair_[a-z_]+$/u.test(error.message) ? error.message : 'sms_repair_failed_verify_before_retry';
    console.error(message);
    process.exitCode = 1;
  });
}
