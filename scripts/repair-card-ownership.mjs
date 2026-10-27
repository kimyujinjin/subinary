#!/usr/bin/env node
/**
 * 카드 자동연결 오류 정정: 기본은 읽기 전용 plan, apply는 계획 파일과 검토 건수가 필요하다.
 * 원문 문자·가맹점·카드번호·자격증명은 출력하지 않는다. 감사 파일은 권한 0600으로 보관한다.
 * 예: node scripts/repair-card-ownership.mjs plan
 *     node scripts/repair-card-ownership.mjs apply <plan.json> --expected-count=65
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  OWNERSHIP_SNAPSHOT_SQL,
  buildCardOwnershipRepairSql,
  planCardOwnershipRepair,
} from './lib/card-ownership-repair.mjs';

const container = process.env.CARD_OWNERSHIP_DB_CONTAINER ?? 'family-memory-ai-postgres-1';
const [command = 'plan', file, ...options] = process.argv.slice(2);

/** @param {string} sql @returns {unknown} */
function runSql(sql) {
  let stdout;
  try {
    stdout = execFileSync('docker', [
      'exec','-i',container,'sh','-c',
      'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At',
    ], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] });
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    const detail = stderr.match(/ERROR:\s*([^\n]*)/u)?.[1];
    throw new Error(detail ?? 'DB 정정 작업을 완료하지 못했습니다. 계획을 다시 대조하세요.');
  }
  const line = stdout.split('\n').find((value) => value.startsWith('{'));
  if (!line) throw new Error('DB 결과를 확인하지 못했습니다. 재실행 전에 계획을 대조하세요.');
  return JSON.parse(line);
}

/** @param {string} path @param {unknown} value @returns {void} */
function saveAudit(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

try {
  if (command === 'plan') {
    const result = runSql(`BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT jsonb_build_object('candidates',COALESCE(jsonb_agg(candidate ORDER BY candidate->'before'->>'transaction_type',candidate->'before'->>'id'),'[]'::jsonb))
FROM (SELECT jsonb_build_object(
  'before',${OWNERSHIP_SNAPSHOT_SQL},
  'sourceMemberId',e.member_id,
  'cardOwnerMemberId',c.owner_member_id,
  'cardIsShared',c.is_shared,
  'chainConflict',EXISTS (SELECT 1 FROM card_transactions related
    WHERE (related.id=t.parent_transaction_id OR related.parent_transaction_id=t.id)
      AND (related.member_id IS DISTINCT FROM t.member_id OR related.card_id IS DISTINCT FROM t.card_id))
) candidate
FROM card_transactions t JOIN card_sms_events e ON e.id=t.source_event_id
JOIN payment_cards c ON c.id=t.card_id
WHERE NOT c.is_shared AND t.member_id<>c.owner_member_id) candidates;
COMMIT;`);
    if (!result || typeof result !== 'object' || !('candidates' in result) || !Array.isArray(result.candidates)) {
      throw new Error('정정 후보 응답 형식이 올바르지 않습니다.');
    }
    const plan = planCardOwnershipRepair(result.candidates);
    const path = resolve(file ?? `.deploy-logs/card-ownership/plan-${Date.now()}.json`);
    saveAudit(path, plan);
    console.log(JSON.stringify({ mode: 'read_only_plan', targets: plan.entries.length, manualReview: plan.skipped.length, plan: path, digest: plan.digest }));
  } else if (command === 'apply') {
    if (!file) throw new Error('apply에는 검토한 계획 JSON 경로가 필요합니다.');
    const rawCount = options.find((option) => option.startsWith('--expected-count='))?.slice('--expected-count='.length);
    if (!rawCount || !/^\d+$/u.test(rawCount)) throw new Error('--expected-count=<검토한 건수>가 필요합니다.');
    const path = resolve(file);
    const plan = JSON.parse(readFileSync(path, 'utf8'));
    const sql = buildCardOwnershipRepairSql(plan, Number(rawCount));
    // 적용 전에도 실행 의도와 원본 계획을 남겨 커밋 직후 연결 단절을 복구할 수 있게 한다.
    const receiptPath = `${path}.${Date.now()}.apply.json`;
    saveAudit(`${receiptPath}.prepared`, { preparedAt: new Date().toISOString(), plan });
    const result = runSql(sql);
    saveAudit(receiptPath, { completedAt: new Date().toISOString(), result });
    console.log(JSON.stringify({ mode: 'apply', receipt: receiptPath, digest: plan.digest }));
  } else {
    throw new Error('지원 명령은 plan과 apply입니다. 기본 plan은 읽기 전용입니다.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : '카드 정정 도구에서 오류가 발생했습니다.');
  process.exitCode = 1;
}
