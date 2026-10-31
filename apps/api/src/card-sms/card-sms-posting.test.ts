import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { cardSmsPostingStatusResponseSchema } from '@family/contracts';
import { schema } from '@family/database';
import type { MoneyRuntimeService } from '../money/money-runtime.service';
import { cardSmsPosting, type PostedTransaction } from './card-sms-posting';
import { CardSmsQueryService } from './card-sms-query.service';
import { CardSmsEventsController } from './card-sms-events.controller';
import type { CardSmsReviewService } from './card-sms-review.service';

const H = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const T = '44444444-4444-4444-8444-444444444444';
const U = '55555555-5555-4555-8555-555555555555';
const S = '66666666-6666-4666-8666-666666666666';
const date = '2026-10-28T16:00:00.000Z';
const baseEvent = { householdId: H, parseStatus: 'parsed', transactionType: 'approval', currency: 'USD' } as const;
const transaction: PostedTransaction = { id: T, householdId: H, memberId: M, visibility: 'private', status: 'approved' };

describe('SMS parsing and ledger posting are independent', () => {
  it('parsed alone never means posted; a current missing v2 snapshot is explicit', () => {
    expect(cardSmsPosting(baseEvent, null, false, 'v2', M)).toEqual({ status: 'pending',
      transactionId: null, transactionStatus: null, reason: 'fx_snapshot_missing' });
  });
  it.each(['legacy', 'shadow', undefined])('does not invent a v2 FX failure in %s mode', mode => {
    expect(cardSmsPosting(baseEvent, null, false, mode, M)).toMatchObject({ status: 'pending', reason: 'processing' });
  });
  it('a newly available snapshot changes the observable reason without any write', () => {
    expect(cardSmsPosting(baseEvent, null, true, 'v2', M).reason).toBe('processing');
  });
  it('actual source-event linkage wins over stale parsing or missing-snapshot observations', () => {
    expect(cardSmsPosting({ ...baseEvent, parseStatus: 'parse_failed' }, transaction, false, 'v2', M))
      .toEqual({ status: 'posted', transactionId: T, transactionStatus: 'approved', reason: null });
  });
  it.each([{ ...transaction, memberId: 'other' }, { ...transaction, householdId: 'other' }])(
    'does not reveal a currently inaccessible transaction link or status', hidden => {
      expect(cardSmsPosting(baseEvent, hidden, false, 'v2', M)).toEqual({ status: 'posted',
        transactionId: null, transactionStatus: null, reason: null });
    });
  it.each(['parse_failed', 'quarantined'] as const)('keeps %s in the existing review queue', parseStatus => {
    expect(cardSmsPosting({ ...baseEvent, parseStatus }, null, false, 'v2', M))
      .toMatchObject({ status: 'needs_review', reason: parseStatus });
  });
  it('pending_review parsing is promotable, rather than necessarily waiting for human review', () => {
    expect(cardSmsPosting({ ...baseEvent, parseStatus: 'pending_review', currency: 'KRW' }, null, false, 'v2', M))
      .toMatchObject({ status: 'pending', reason: 'processing' });
  });
  it.each([
    { parseStatus: 'pending', transactionType: null, reason: 'parsing', status: 'pending' },
    { parseStatus: 'ignored', transactionType: 'unknown', reason: 'ignored', status: 'not_applicable' },
    { parseStatus: 'parsed', transactionType: 'declined', reason: 'declined', status: 'not_applicable' },
    { parseStatus: 'parsed', transactionType: 'unknown', reason: 'unsupported_message', status: 'not_applicable' },
  ] as const)('distinguishes $reason from ledger creation', input => {
    expect(cardSmsPosting({ ...baseEvent, ...input }, null, false, 'v2', M))
      .toMatchObject({ status: input.status, reason: input.reason });
  });
});

/** Actual Drizzle SQL and decoding, backed only by a synthetic in-memory driver. */
function setup(mode = 'v2') {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const state = { member: true, found: true, snapshot: false, transaction: null as PostedTransaction | null,
    event: { id: E, eventId: 'synthetic-event', householdId: H, memberId: M, parseStatus: 'parsed',
      transactionType: 'approval', currency: 'USD', occurredAt: date, receivedAt: date, createdAt: date,
      sender: 'synthetic-sender', rawContent: 'synthetic private message', merchantRaw: 'synthetic-merchant',
    } as Record<string, unknown> };
  const unsafe = (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    const result = Promise.resolve().then(() => {
      if (sql.includes('from "household_members"')) return state.member ? [[M]] : [];
      if (!sql.includes('from "card_sms_events"')) throw new Error('unexpected synthetic query');
      if (!state.found) return [];
      const keys = sql.includes('"card_sms_events"."raw_content"') ? Object.keys(getTableColumns(schema.cardSmsEvents))
        : ['id', 'householdId', 'memberId', 'parseStatus', 'transactionType', 'currency'];
      const tx = state.transaction;
      return [[...keys.map(key => state.event[key] ?? null),
        ...(tx ? [tx.id, tx.householdId, tx.memberId, tx.visibility, tx.status] : [null, null, null, null, null]),
        state.snapshot ? S : null]];
    });
    return Object.assign(result, { values: () => result });
  };
  const db = drizzle({ options: { parsers: {}, serializers: {} }, unsafe } as unknown as postgres.Sql, { schema });
  const service = new CardSmsQueryService(db, { contractMode: mode } as MoneyRuntimeService);
  const controller = new CardSmsEventsController(service, {} as CardSmsReviewService);
  return { service, controller, state, queries };
}

describe('authenticated posting API reachability and projection', () => {
  it('has a dedicated authenticated route and returns no raw or parsed financial fields', async () => {
    const { controller, queries } = setup();
    expect(Reflect.getMetadata(PATH_METADATA, CardSmsEventsController.prototype.getPosting)).toBe(':id/posting');
    const response = await controller.getPosting({ userId: U } as never, E);
    expect(cardSmsPostingStatusResponseSchema.parse(response)).toEqual({ id: E, parseStatus: 'parsed',
      transactionType: 'approval', posting: { status: 'pending', transactionId: null, transactionStatus: null, reason: 'fx_snapshot_missing' } });
    expect(Object.keys(response).sort()).toEqual(['id', 'parseStatus', 'posting', 'transactionType']);
    const select = queries.find(query => query.sql.includes('from "card_sms_events"'))!.sql.split(' from ')[0]!;
    expect(select).not.toMatch(/raw_content|sender|merchant|amount|parse_error|provider_reference/);
    expect(queries.every(query => query.sql.startsWith('select '))).toBe(true);
  });
  it('reads the actual source-event link and exact Seoul-date v2 snapshot in one statement', async () => {
    const { service, queries } = setup();
    await service.getPosting(U, E);
    const query = queries.find(row => row.sql.includes('from "card_sms_events"'))!;
    expect(query.sql).toContain('"card_transactions"."source_event_id" = "card_sms_events"."id"');
    expect(query.sql).toContain('"fx_rate_snapshots"."base_currency" = upper(coalesce(');
    expect(query.sql).toContain("at time zone 'Asia/Seoul')::date");
    expect(query.sql).toContain('coalesce("card_sms_events"."occurred_at", "card_sms_events"."received_at")');
    expect(query.sql).toContain('"fx_rate_snapshots"."money_contract_version"');
    expect(query.params).toContain(2);
    expect(query.params).toContain('KRW');
    expect(queries.filter(row => row.sql.includes('from "card_sms_events"'))).toHaveLength(1);
  });
  it('observes a completion between polls and does not cache the earlier missing result', async () => {
    const { service, state } = setup();
    expect((await service.getPosting(U, E)).posting.reason).toBe('fx_snapshot_missing');
    state.snapshot = true;
    expect((await service.getPosting(U, E)).posting.reason).toBe('processing');
    state.transaction = transaction;
    expect((await service.getPosting(U, E)).posting).toMatchObject({ status: 'posted', transactionId: T });
  });
  it('does not infer FX blocking for an actual legacy API process', async () => {
    expect((await setup('legacy').service.getPosting(U, E)).posting.reason).toBe('processing');
  });
  it('the existing detail and list also expose actual posting rather than parsing success', async () => {
    const { service, state } = setup();
    expect((await service.get(U, E)).posting?.status).toBe('pending');
    state.transaction = transaction;
    expect((await service.list(U, H, 'parsed', '10', undefined))[0]?.posting?.transactionId).toBe(T);
  });
  it('the list route applies unposted filtering before LIMIT and excludes other queues', async () => {
    const { controller, queries } = setup();
    await controller.list({ userId: U } as never, H, undefined, '10', undefined, 'unposted');
    const query = queries.find(row => row.sql.includes('from "card_sms_events"'))!;
    expect(query.sql).toContain('"card_transactions"."id" is null');
    expect(query.sql).toContain('"card_sms_events"."member_id" =');
    expect(query.sql).toContain('"card_sms_events"."household_id" =');
    expect(query.params).toEqual(expect.arrayContaining([H, M, 'pending', 'parsed', 'pending_review', 'approval', 'cancellation', 10]));
    expect(query.params).not.toEqual(expect.arrayContaining(['parse_failed', 'quarantined', 'ignored', 'declined']));
    expect(query.sql.indexOf('"card_transactions"."id" is null')).toBeLessThan(query.sql.indexOf(' limit '));
  });
  it('rejects invalid posting filters instead of silently listing other events', async () => {
    const { service } = setup();
    await expect(service.list(U, H, undefined, undefined, undefined, 'posted')).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each(['getPosting', 'get'] as const)('%s refuses another recipient and inactive membership', async method => {
    const { service, state } = setup();
    state.event.memberId = 'other';
    await expect(service[method](U, E)).rejects.toBeInstanceOf(ForbiddenException);
    state.event.memberId = M; state.member = false;
    await expect(service[method](U, E)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('missing events are not presented as pending', async () => {
    const { service, state } = setup(); state.found = false;
    await expect(service.getPosting(U, E)).rejects.toBeInstanceOf(NotFoundException);
  });
});
