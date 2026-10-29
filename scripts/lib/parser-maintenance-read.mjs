// 운영 worker에서만 실행하는 SELECT 전용 수집기. stdout은 상위 CLI의 메모리로만 전달한다.
import { createRequire } from 'node:module';
const requireWorker = createRequire('/app/apps/worker/package.json');
const postgres = requireWorker('postgres');
const member = process.env.PARSER_MAINTENANCE_MEMBER_ID;
const household = process.env.PARSER_MAINTENANCE_HOUSEHOLD_ID;
if (!/^[a-f0-9-]{36}$/u.test(member ?? '') || !/^[a-f0-9-]{36}$/u.test(household ?? '')) throw new Error('maintenance_scope_required');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 5 });
try {
  const rows = await sql.begin('isolation level repeatable read, read only', async tx => {
    await tx`set local statement_timeout = '10s'`;
    const members = await tx`select m.id from household_members m join users u on u.id=m.user_id and u.deleted_at is null
      join households h on h.id=m.household_id and h.deleted_at is null
      where m.id=${member} and m.household_id=${household} and m.status='active'`;
    if (members.length !== 1) throw new Error('maintenance_scope_unavailable');
    // 전역 파서 배포가 다른 테넌트에 영향을 주면 현재 개인 유지보수 범위에서 중단한다.
    const tenantCount = await tx`select count(distinct e.household_id)::int as count from card_sms_events e
      join households h on h.id=e.household_id and h.deleted_at is null
      join source_items s on s.id=e.source_item_id and s.deleted_at is null`;
    if (tenantCount[0]?.count !== 1) throw new Error('maintenance_global_scope_unavailable');
    return tx`select e.id, e.household_id as "householdId", e.member_id as "memberId", e.sender, e.raw_content as content, e.received_at as "receivedAt", e.updated_at::text as version, e.parse_status as status
      from card_sms_events e
      join household_members m on m.id=e.member_id and m.household_id=e.household_id and m.status='active'
      join users u on u.id=m.user_id and u.deleted_at is null
      join households h on h.id=e.household_id and h.deleted_at is null
      join source_items s on s.id=e.source_item_id and s.deleted_at is null
      where e.household_id=${household} order by e.id limit 10001`;
  });
  if (rows.length > 10000) throw new Error('maintenance_corpus_limit');
  process.stdout.write(JSON.stringify(rows));
} finally { await sql.end({ timeout: 5 }); }
