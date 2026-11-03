import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { maintenanceHash, maintenanceSourceHash } from './lib/parser-maintenance-core.mjs';
const requireWorker = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const enabled = process.env.PARSER_MAINTENANCE_DB_TEST === '1';
const sleep = () => new Promise(resolve => setTimeout(resolve, 250));
test('격리 PostgreSQL/Redis에서 본인 지정 SMS만 plan/apply/verify하고 재전송을 억제한다', { skip: !enabled, timeout: 60000 }, async () => {
  const suffix = randomUUID().slice(0, 8); const pgName = `fma-parser-pg-${suffix}`; const redisName = `fma-parser-redis-${suffix}`;
  const dir = mkdtempSync(join(tmpdir(), 'fma-parser-scope-'));
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim();
  let sql; let queue;
  try {
    docker(['run', '-d', '--rm', '--name', pgName, '-e', 'POSTGRES_PASSWORD=synthetic-test-only', '-e', 'POSTGRES_DB=family_parser_test', '-p', '127.0.0.1::5432', 'postgres:18']);
    docker(['run', '-d', '--rm', '--name', redisName, '-p', '127.0.0.1::6379', 'redis:7-alpine']);
    const pgPort = JSON.parse(docker(['inspect', pgName]))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
    const redisPort = JSON.parse(docker(['inspect', redisName]))[0].NetworkSettings.Ports['6379/tcp'][0].HostPort;
    const databaseUrl = `postgres://postgres:synthetic-test-only@127.0.0.1:${pgPort}/family_parser_test`;
    const postgres = requireWorker('postgres');
    for (let i = 0; i < 80; i += 1) {
      try { docker(['exec', pgName, 'pg_isready', '-U', 'postgres']); break; } catch { await sleep(); }
    }
    sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
    await sql`create table card_sms_events(id uuid primary key, household_id uuid, member_id uuid, sender text, raw_content text, received_at timestamptz, updated_at timestamptz, parse_status text, transaction_type text, amount integer, currency text)`;
    await sql`create table card_transactions(id uuid primary key, source_event_id uuid, member_id uuid, transaction_type text, amount integer, currency text)`;
    const memberId = randomUUID(); const otherMember = randomUUID(); const householdId = randomUUID();
    const original = { id: randomUUID(), memberId, householdId, sender: '15888700', content: '[Web발신]\n삼성카드 승인 (7777)\n예시님 12,345원 일시불\n01/02 03:04 예시상점', receivedAt: '2026-01-02T00:05:00.000Z', version: '2026-01-02T00:06:00.000Z', status: 'parse_failed' };
    const otherId = randomUUID(); const ownExcluded = randomUUID();
    for (const [id, member] of [[original.id, memberId], [otherId, otherMember], [ownExcluded, memberId]]) await sql`insert into card_sms_events(id,household_id,member_id,sender,raw_content,received_at,updated_at,parse_status) values(${id},${householdId},${member},${original.sender},${original.content},${original.receivedAt},${original.version},'parse_failed')`;
    const scopeBody = { version: 'parser-maintenance-scope-v1', memberId, householdId, entries: [{ id: original.id, snapshotHash: maintenanceSourceHash(original) }] };
    const scope = { ...scopeBody, digest: maintenanceHash(scopeBody) };
    const scopeFile = join(dir, 'scope.json'); const planFile = join(dir, 'plan.json');
    writeFileSync(scopeFile, JSON.stringify(scope), { mode: 0o600 });
    const env = { ...process.env, DATABASE_URL: databaseUrl, REDIS_HOST: '127.0.0.1', REDIS_PORT: redisPort, BULLMQ_PREFIX: `maintenance-test-${suffix}` };
    const cli = (command, options = []) => JSON.parse(execFileSync(process.execPath, [resolve('scripts/repair-sms-parsing.mjs'), command, planFile, `--scope-file=${scopeFile}`, ...options], { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }));
    assert.equal(cli('plan').targets, 1);
    assert.equal(cli('apply', ['--expected-count=1']).targets, 1);
    const { Queue } = requireWorker('bullmq');
    queue = new Queue('card-sms-parse', { connection: { host: '127.0.0.1', port: Number(redisPort) }, prefix: env.BULLMQ_PREFIX });
    const jobs = await queue.getJobs(['wait']); assert.equal(jobs.length, 1); assert.equal(jobs[0].data.cardSmsEventId, original.id);
    assert.equal(cli('verify').verified, 0);
    await sql`update card_sms_events set parse_status='parsed',transaction_type='approval',amount=12345,currency='KRW' where id=${original.id}`;
    await sql`insert into card_transactions(id,source_event_id,member_id,transaction_type,amount,currency) values(${randomUUID()},${original.id},${memberId},'approval',12345,'KRW')`;
    assert.equal(cli('verify').verified, 1);
    assert.equal(cli('apply', ['--expected-count=1']).mode, 'already_verified');
    assert.equal((await queue.getJobs(['wait'])).length, 1);
    const unchanged = await sql`select parse_status from card_sms_events where id in (${otherId},${ownExcluded})`;
    assert.ok(unchanged.every(row => row.parse_status === 'parse_failed'));
    const badBody = { ...scopeBody, memberId: otherMember }; writeFileSync(scopeFile, JSON.stringify({ ...badBody, digest: maintenanceHash(badBody) }));
    assert.throws(() => cli('apply', ['--expected-count=1']), error => String(error.stderr).includes('sms_repair_scope_required'));
  } finally {
    await queue?.close(); await sql?.end({ timeout: 5 });
    for (const name of [redisName, pgName]) { try { docker(['rm', '-f', name]); } catch {} }
    rmSync(dir, { recursive: true, force: true });
  }
});
