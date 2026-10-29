import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { schema } from '@family/database';
import { scopedTemplateFingerprint, templateFingerprint } from '@family/card-parsers';
import type { MoneyShadowService } from '../money/money-shadow.service';
import type { MoneyWriteService } from '../money/money-write.service';
import { CardSmsReviewService } from './card-sms-review.service';
import { CardSmsQueryService } from './card-sms-query.service';

const H = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const U = '55555555-5555-4555-8555-555555555555';
const P = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-10-28T01:30:30.000Z';
const CONTENT = '[Web발신]\n현대카드(1234)승인\n김*수\n10/28 10:30\n12,000원 일시불\n테스트상점';
const input = { transactionType: 'approval' as const, amount: 12000, currency: 'KRW', merchantRaw: '테스트상점', occurredAt: '2026-10-28T01:30:00.000Z', cardId: C };
interface Options { otherMember?: boolean; inactiveMember?: boolean; otherCard?: boolean; promoted?: boolean; failPromotion?: boolean; policyExists?: boolean; policyEnabled?: boolean }

/** 실제 SQL을 생성하되 네트워크 없이 경계·커밋·롤백을 검증한다. */
function setup(options: Options = {}) {
  const queries: Array<{ sql: string; params: unknown[]; scope: 'outer' | 'transaction' }> = [];
  const state = { commits: 0, rollbacks: 0 };
  const event: Record<string, unknown> = { id: E, householdId: H, memberId: options.otherMember ? 'other' : M,
    sender: '1588-test', rawContent: CONTENT, receivedAt: NOW, issuer: '현대', parseStatus: 'parse_failed', createdAt: NOW, updatedAt: NOW };
  const policy: Record<string, unknown> = { id: P, fingerprint: 'scoped-key', sender: '1588-test', skeleton: 'private',
    recipe: { automationEnabled: options.policyEnabled !== false, approvedCardId: C, householdId: H, memberId: M },
    sourceEventId: E, confirmedBy: U, hitCount: 0, createdAt: NOW, updatedAt: NOW };
  const values = (table: typeof schema.cardSmsEvents | typeof schema.cardSmsTemplates, row: Record<string, unknown>): unknown[] => Object.keys(getTableColumns(table)).map(key => row[key] ?? null);
  function execute(sql: string): unknown[][] {
    if (sql.startsWith('update "card_sms_events"')) { event.parseStatus = 'parsed'; return []; }
    if (sql.startsWith('update "card_sms_templates"')) { policy.recipe = { ...(policy.recipe as object), automationEnabled: false }; return []; }
    if (sql.startsWith('insert into "card_transactions"')) {
      if (options.failPromotion) throw new Error('검증용 승격 실패');
      return [[E]];
    }
    if (sql.startsWith('insert into ')) return [];
    if (sql.includes('from "household_members"')) return options.inactiveMember ? [] : [[M]];
    if (sql.includes('from "payment_cards"')) {
      if (sql.startsWith('select "visibility"')) return [['private', options.otherCard ? 'other' : M, false]];
      return [[C, '1234', '현대', 'private', M, false]];
    }
    if (sql.includes('from "card_sms_templates"')) return options.policyExists === false ? [] : [values(schema.cardSmsTemplates, policy)];
    if (sql.includes('from "card_sms_events"')) return [values(schema.cardSmsEvents, event)];
    if (sql.includes('from "card_transactions"')) return options.promoted ? [[E]] : [];
    throw new Error(`예상하지 않은 검증용 SQL: ${sql}`);
  }
  const unsafe = (scope: 'outer' | 'transaction') => (sql: string, params: unknown[]) => {
      queries.push({ sql, params, scope });
      const result = Promise.resolve().then(() => execute(sql));
      return Object.assign(result, { values: () => result });
  };
  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe: unsafe('outer'),
    async begin<T>(run: (client: unknown) => Promise<T>): Promise<T> {
      const before = { event: { ...event }, policy: { ...policy } };
      try { const result = await run({ ...driver, unsafe: unsafe('transaction') }); state.commits += 1; return result; }
      catch (error) { Object.assign(event, before.event); Object.assign(policy, before.policy); state.rollbacks += 1; throw error; }
    },
  };
  const db = drizzle(driver as unknown as postgres.Sql, { schema });
  const observe = vi.fn();
  return { queries, state, observe, review: new CardSmsReviewService(db,
    { observe } as unknown as MoneyShadowService, { enforced: false } as unknown as MoneyWriteService), query: new CardSmsQueryService(db) };
}

const writes = (queries: Array<{ sql: string }>) => queries.filter(query => /^(insert|update)/.test(query.sql));

describe('사람 검토의 본인 범위와 부작용', () => {
  it('기본 확정은 현재 한 건만 처리하고 기존 재사용 설정을 건드리지 않는다', async () => {
    const { review, queries, state } = setup();
    await expect(review.review(U, E, input)).resolves.toMatchObject({ transactionId: E });
    expect(queries.some(query => /^(insert|update).*card_sms_templates/.test(query.sql))).toBe(false);
    expect(queries.find(query => query.sql.includes('from "card_sms_events"'))?.sql).toContain('for update');
    expect(queries.find(query => query.sql.includes('from "household_members"'))?.sql).toContain('"households"."deleted_at" is null');
    expect(queries.find(query => query.sql.includes('from "household_members"'))?.sql).toContain('"users"."deleted_at" is null');
    expect(queries.find(query => query.sql.includes('from "household_members"'))?.sql).toContain('for share');
    expect(queries.every(query => query.scope === 'transaction')).toBe(true);
    expect(state).toEqual({ commits: 1, rollbacks: 0 });
  });

  it('명시 재사용만 본인 지문과 카드·enabled·범위를 저장하고 전역 지문을 덮어쓰지 않는다', async () => {
    const { review, queries } = setup();
    await review.review(U, E, { ...input, reuseForSimilar: true });
    const insert = queries.find(query => query.sql.startsWith('insert into "card_sms_templates"'));
    expect(insert?.params).toContain(scopedTemplateFingerprint(H, M, '1588-test', CONTENT));
    expect(insert?.params).not.toContain(templateFingerprint('1588-test', CONTENT));
    const recipe = insert?.params.find(value => typeof value === 'string' && value.includes('automationEnabled'));
    expect(typeof recipe).toBe('string');
    expect(JSON.parse(recipe as string)).toMatchObject({ approvedCardId: C, automationEnabled: true, householdId: H, memberId: M,
      fingerprint: templateFingerprint('1588-test', CONTENT) });
    const label = queries.find(query => query.sql.startsWith('insert into "feedback_events"'))?.params.find(value => typeof value === 'string' && value.includes('reuseForSimilar'));
    expect(JSON.parse(label as string)).toMatchObject({ reuseForSimilar: true, approvedCardId: C });
  });

  it.each([{ otherMember: true }, { inactiveMember: true }])('권한 밖 문자는 쓰기 전에 거절한다', async options => {
    const { review, queries } = setup(options);
    await expect(review.review(U, E, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes(queries)).toEqual([]);
  });

  it('다른 구성원의 개인 카드를 선택하면 라벨·거래·정책을 만들지 않는다', async () => {
    const { review, queries } = setup({ otherCard: true });
    await expect(review.review(U, E, input)).rejects.toThrow('본인 소유');
    expect(writes(queries)).toEqual([]);
  });

  it('이미 승격된 문자와 중복 확정은 거절한다', async () => {
    const existing = setup({ promoted: true });
    await expect(existing.review.review(U, E, input)).rejects.toBeInstanceOf(ConflictException);
    expect(writes(existing.queries)).toEqual([]);
    const twice = setup();
    await twice.review.review(U, E, input);
    await expect(twice.review.review(U, E, input)).rejects.toBeInstanceOf(ConflictException);
    expect(twice.queries.filter(query => query.sql.startsWith('insert into "card_transactions"'))).toHaveLength(1);
  });

  it('승격 실패는 라벨·정책과 함께 롤백하고 성공 관측을 남기지 않는다', async () => {
    const { review, state, observe } = setup({ failPromotion: true });
    await expect(review.review(U, E, { ...input, reuseForSimilar: true })).rejects.toThrow();
    expect(state).toEqual({ commits: 0, rollbacks: 1 });
    expect(observe).not.toHaveBeenCalled();
  });
});

describe('본인 자동 정리 중지', () => {
  it('본인·가구·원본 구성원을 SQL에서 묶고 이력 한 번만 기록한다', async () => {
    const { query, queries } = setup();
    expect(await query.disableReviewPolicy(U, H, P)).toMatchObject({ id: P, enabled: false });
    expect(await query.disableReviewPolicy(U, H, P)).toMatchObject({ enabled: false });
    const selected = queries.find(q => q.sql.includes('from "card_sms_templates"'));
    expect(selected?.sql).toContain('"confirmed_by"');
    expect(selected?.sql).toContain("->>'householdId'");
    expect(selected?.sql).toContain('"card_sms_events"."member_id"');
    expect(selected?.sql).toContain('for update');
    expect(queries.every(query => query.scope === 'transaction')).toBe(true);
    expect(queries.filter(q => q.sql.startsWith('insert into "feedback_events"'))).toHaveLength(1);
    expect(queries.some(q => q.sql.startsWith('delete '))).toBe(false);
    expect(queries.some(q => q.sql.startsWith('update "card_transactions"'))).toBe(false);
  });

  it('타인 또는 존재하지 않는 설정에는 변경을 남기지 않는다', async () => {
    const { query, queries } = setup({ policyExists: false });
    await expect(query.disableReviewPolicy(U, H, P)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes(queries)).toEqual([]);
  });

  it('묶음 조회는 이미 승격된 문자를 제외하고 본인만 조회한다', async () => {
    const { query, queries } = setup();
    const result = await query.reviewGroups(U, H);
    expect(result.scope).toBe('own_member');
    expect(JSON.stringify(result)).not.toContain(CONTENT);
    const selected = queries.find(q => q.sql.includes('from "card_sms_events"') && q.sql.includes('not exists'));
    expect(selected?.sql).toContain('"card_transactions"."source_event_id" = "card_sms_events"."id"');
    expect(selected?.params).toContain(M);
  });
});
