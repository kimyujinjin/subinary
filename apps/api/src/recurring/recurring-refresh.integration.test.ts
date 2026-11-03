/** 격리 검증 DB의 임시 이름공간에서 실제 잠금·롤백·공개범위를 검증한다. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema, type Db } from '@family/database';

import { RecurringService } from './recurring.service';
import { RecurringRefreshService } from './recurring-refresh.service';
import { withRecurringTransaction } from './recurring-transaction';

const DATABASE_URL = process.env.RECURRING_TEST_DATABASE_URL;
const namespace = `fma_recurring_verify_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!DATABASE_URL)('정기결제 자동 갱신 — 격리 Postgres', () => {
  let admin: postgres.Sql | undefined;
  let client: postgres.Sql;
  let db: Db;
  let service: RecurringService;
  let householdId: string;
  let userId: string;
  let otherUserId: string;
  let memberId: string;
  let otherMemberId: string;

  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error('격리 검증 DB가 필요합니다.');
    const databaseName = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1));
    if (process.env.NODE_ENV === 'production' || !/(?:^|[_-])(?:test|verify|verification)(?:[_-]|$)/iu.test(databaseName)) {
      throw new Error('test 또는 verify 이름을 가진 격리 DB에서만 실행할 수 있습니다.');
    }
    vi.stubEnv('RECURRING_RADAR_ENABLED', 'true');
    admin = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
    await admin`create schema ${admin(namespace)}`;
    client = postgres(DATABASE_URL, {
      max: 4, prepare: false, onnotice: () => {}, connection: { search_path: namespace },
    });
    db = drizzle(client, { schema });
    service = new RecurringService(db);
    await client.unsafe(`
      create table users (id uuid primary key);
      create table households (id uuid primary key, deleted_at timestamptz);
      create table household_members (id uuid primary key, household_id uuid, user_id uuid, status text);
      create table expense_categories (id uuid primary key, is_transfer boolean);
      create table merchant_aliases (household_id uuid, alias text, canonical text);
      create table card_transactions (
        id uuid primary key, household_id uuid, member_id uuid, merchant_raw text, merchant_normalized text,
        net_amount integer, currency text default 'KRW', approved_at timestamptz, created_at timestamptz default now(),
        transaction_type text default 'approval', status text default 'approved', excluded_at timestamptz,
        category_id uuid, money_contract_version integer default 2, visibility text default 'household', card_id uuid
      );
      create table card_sms_events (
        household_id uuid, member_id uuid, merchant_raw text, decline_reason text,
        occurred_at timestamptz, created_at timestamptz default now(), transaction_type text
      );
    `);
    // 운영 migration을 그대로 적용하되 public 참조만 이 검증 이름공간으로 제한한다.
    for (const name of ['0053_recurring_series.sql', '0058_recurring_next_expected.sql', '0059_recurring_ended.sql', '0063_recurring_recompute_state.sql']) {
      const source = await readFile(resolve(process.cwd(), '../../packages/database/drizzle', name), 'utf8');
      for (const statement of source.replaceAll('"public".', `"${namespace}".`).split('--> statement-breakpoint')) {
        if (statement.trim()) await client.unsafe(statement);
      }
    }
  });

  beforeEach(async () => {
    await client.unsafe('truncate recurring_series_evidence, recurring_series, recurring_recompute_state, card_transactions, card_sms_events, merchant_aliases, household_members, households, users cascade');
    householdId = randomUUID(); userId = randomUUID(); otherUserId = randomUUID();
    memberId = randomUUID(); otherMemberId = randomUUID();
    await client`insert into users values (${userId}), (${otherUserId})`;
    await client`insert into households values (${householdId}, null)`;
    await client`insert into household_members values
      (${memberId}, ${householdId}, ${userId}, 'active'),
      (${otherMemberId}, ${householdId}, ${otherUserId}, 'active')`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (client) await client.end({ timeout: 5 });
    if (admin) {
      await admin`drop schema ${admin(namespace)} cascade`;
      await admin.end({ timeout: 5 });
    }
  });

  async function addMonthly(merchant = 'SYNTHETIC SUBSCRIPTION', owner = memberId, visibility = 'private', months = [3, 2, 1]): Promise<string[]> {
    const ids: string[] = [];
    const now = new Date();
    for (const monthsAgo of months) {
      const id = randomUUID();
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)).toISOString();
      await client`insert into card_transactions (id, household_id, member_id, merchant_raw, net_amount, approved_at, visibility)
        values (${id}, ${householdId}, ${owner}, ${merchant}, 10000, ${at}, ${visibility})`;
      ids.push(id);
    }
    return ids;
  }

  async function firstSeries(): Promise<typeof schema.recurringSeries.$inferSelect> {
    const [row] = await db.select().from(schema.recurringSeries).where(eq(schema.recurringSeries.householdId, householdId));
    if (!row) throw new Error('합성 후보가 생성되지 않았습니다.');
    return row;
  }

  it('미계산과 후보 0건의 성공을 구분하고 30분 이내 중복 실행을 건너뛴다', async () => {
    expect(await service.list(userId, householdId)).toMatchObject({ items: [], computedAt: null, calculationStatus: 'not_computed' });
    const result = await service.recomputeIfDue(householdId);
    expect(result?.created).toBe(0);
    expect(await service.list(userId, householdId)).toMatchObject({ items: [], computedAt: result?.computedAt, calculationStatus: 'computed' });
    expect(await service.recomputeIfDue(householdId)).toBeNull();
    await client`update recurring_recompute_state set computed_at = now() - interval '31 minutes'`;
    expect(await service.recomputeIfDue(householdId)).not.toBeNull();
  });

  it('같은 후보와 새 결제가 추가된 후보의 ID를 보존한다', async () => {
    await addMonthly();
    await service.recompute(userId, householdId);
    const before = await firstSeries();
    await service.recompute(userId, householdId);
    expect((await firstSeries()).id).toBe(before.id);
    await addMonthly(undefined, undefined, undefined, [0]);
    expect(await service.recompute(userId, householdId)).toMatchObject({ created: 0, updated: 1 });
    expect(await firstSeries()).toMatchObject({ id: before.id, occurrenceCount: 4 });
  });

  it.each(['confirmed', 'rejected', 'ended'] as const)('사용자 %s 판단과 결정자를 자동 계산이 보존한다', async (decision) => {
    await addMonthly();
    await service.recompute(userId, householdId);
    const before = await firstSeries();
    await service.decide(userId, before.id, decision);
    await service.recompute(userId, householdId);
    expect(await firstSeries()).toMatchObject({ id: before.id, status: decision, statusChangedBy: userId });
  });

  it.each(['rejected', 'ended'] as const)('근거가 사라져도 %s 결제를 자동으로 되살리지 않는다', async (decision) => {
    await addMonthly();
    await service.recompute(userId, householdId);
    const before = await firstSeries();
    await service.decide(userId, before.id, decision);
    await client`update card_transactions set excluded_at = now()`;
    expect(await service.recompute(userId, householdId)).toMatchObject({ created: 0, needsReview: 0 });
    expect(await firstSeries()).toMatchObject({ id: before.id, status: decision, statusChangedBy: userId });
  });

  it('동시 자동 계산이 후보를 중복 생성하지 않는다', async () => {
    await addMonthly();
    const results = await Promise.all([service.recomputeIfDue(householdId), service.recomputeIfDue(householdId)]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(await db.select().from(schema.recurringSeries)).toHaveLength(1);
  });

  it('자동 계산과 확인 버튼이 경합해도 같은 ID의 사용자 판단을 보존한다', async () => {
    await addMonthly();
    await service.recompute(userId, householdId);
    const before = await firstSeries();
    await Promise.all([service.recompute(userId, householdId), service.decide(userId, before.id, 'confirmed')]);
    expect(await firstSeries()).toMatchObject({ id: before.id, status: 'confirmed', statusChangedBy: userId });
  });

  it('중간 저장 실패는 기존 후보·근거·성공시각을 롤백하고 다음 실행에서 복구한다', async () => {
    await addMonthly();
    await service.recompute(userId, householdId);
    const before = await firstSeries();
    const previousState = await db.select().from(schema.recurringRecomputeState);
    await addMonthly(undefined, undefined, undefined, [0]);
    await client.unsafe(`create function reject_test_evidence() returns trigger language plpgsql as $$ begin raise exception 'synthetic evidence write failure'; end $$;
      create trigger reject_test_evidence before insert on recurring_series_evidence for each row execute function reject_test_evidence()`);
    try {
      await expect(service.recompute(userId, householdId)).rejects.toThrow();
      expect(await firstSeries()).toEqual(before);
      expect(await db.select().from(schema.recurringSeriesEvidence)).toHaveLength(3);
      expect(await db.select().from(schema.recurringRecomputeState)).toEqual(previousState);
    } finally {
      await client.unsafe('drop trigger reject_test_evidence on recurring_series_evidence; drop function reject_test_evidence()');
    }
    expect(await service.recompute(userId, householdId)).toMatchObject({ created: 0, updated: 1 });
    expect(await firstSeries()).toMatchObject({ id: before.id, occurrenceCount: 4 });
  });

  it('계산 중 거래 수정이 있어도 입력은 같은 스냅샷에서 읽는다', async () => {
    const [id] = await addMonthly();
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const reading = withRecurringTransaction(db, householdId, async (tx) => {
      const first = await tx.select({ amount: schema.cardTransactions.netAmount }).from(schema.cardTransactions).where(eq(schema.cardTransactions.id, id));
      entered();
      await barrier;
      const second = await tx.select({ amount: schema.cardTransactions.netAmount }).from(schema.cardTransactions).where(eq(schema.cardTransactions.id, id));
      return { first, second };
    });
    await ready;
    try { await client`update card_transactions set net_amount = 20000 where id = ${id}`; } finally { release(); }
    const result = await reading;
    expect(result.first).toEqual([{ amount: 10000 }]);
    expect(result.second).toEqual(result.first);
  });

  it('타인의 private·근거 없는 후보와 타인 거절 문자를 노출하지 않는다', async () => {
    await addMonthly('OWN SUBSCRIPTION');
    await addMonthly('PRIVATE SUBSCRIPTION', otherMemberId, 'private');
    await addMonthly('SUMMARY SUBSCRIPTION', otherMemberId, 'summary_only');
    await service.recompute(userId, householdId);
    await client`insert into card_sms_events (household_id, member_id, merchant_raw, decline_reason, transaction_type)
      values (${householdId}, ${otherMemberId}, 'OWN SUBSCRIPTION', 'lost_or_stolen', 'declined'),
             (${householdId}, ${otherMemberId}, 'OWN SUBSCRIPTION', 'lost_or_stolen', 'declined')`;
    const result = await service.list(userId, householdId);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((item) => item.merchant.includes('PRIVATE') || item.merchant.includes('SUMMARY'))).toBe(false);
    expect(result.items.every((item) => item.recentDeclineAttempts === 0)).toBe(true);
    await client`delete from recurring_series_evidence where series_id in (select id from recurring_series where member_id = ${otherMemberId})`;
    expect((await service.list(userId, householdId)).items).toHaveLength(1);
    await expect(service.list(randomUUID(), householdId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('갱신 서비스 재시작은 오래된 가구를 따라잡고 성공 후 중복 실행하지 않는다', async () => {
    await addMonthly();
    const refresh = new RecurringRefreshService(db, service);
    expect(await refresh.refreshDue()).toEqual({ refreshed: 1, failed: 0 });
    expect(await new RecurringRefreshService(db, service).refreshDue()).toEqual({ refreshed: 0, failed: 0 });
  });
});
