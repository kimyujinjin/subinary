import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { schema, type DbExecutor } from '@family/database';
import type { CardSmsReviewRequest, ManualFieldsEntryRequest } from '@family/contracts';
import type { MoneyShadowService } from '../money/money-shadow.service';
import type { MoneyWriteService } from '../money/money-write.service';
import type { CardSmsIngestService } from './card-sms-ingest.service';
import { CardSmsReviewService } from './card-sms-review.service';
import { ManualEntryService } from './manual-entry.service';

// The policy's own tests cover extraction. This suite uses no message samples and
// checks only that entry commands preserve its surrounding transaction/consent.
vi.mock('./card-sms-review-policy', () => ({
  reusableReviewRecipe: vi.fn(() => ({ version: 'synthetic-policy' })),
}));

const H = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const U = '55555555-5555-4555-8555-555555555555';
const T = '66666666-6666-4666-8666-666666666666';
const D = '77777777-7777-4777-8777-777777777777';
const S = '88888888-8888-4888-8888-888888888888';
const K = '99999999-9999-4999-8999-999999999999';
const WHEN = '2026-01-02T01:00:00.000Z';
const reviewInput: CardSmsReviewRequest = { transactionType: 'approval', amount: 1700,
  currency: 'USD', merchantRaw: 'Synthetic merchant', occurredAt: WHEN, cardId: C, categoryId: K };
const manualInput: ManualFieldsEntryRequest = { householdId: H, transactionType: 'approval', amount: 1700, currency: 'USD',
  merchantRaw: 'Synthetic merchant', occurredAt: WHEN, cardId: C, categoryId: K };

interface Options {
  enforced?: boolean;
  inactiveMember?: boolean;
  otherRecipient?: boolean;
  invalidCard?: boolean;
  existingTransaction?: boolean;
  alreadyPromoted?: boolean;
  rejection?: string;
  commandThrows?: boolean;
  missingFullRow?: boolean;
}

/** Actual Drizzle SQL; the in-memory driver cannot open a DB or a queue. */
function setup(options: Options = {}) {
  const queries: Array<{ sql: string; params: unknown[]; scope: 'outer' | 'transaction' }> = [];
  const state = { commits: 0, rollbacks: 0, open: false, sources: 0, events: 0,
    feedback: 0, policies: 0, parseStatus: 'parse_failed' };
  const event = { id: E, householdId: H, memberId: options.otherRecipient ? D : M,
    sender: 'synthetic-sender', rawContent: 'synthetic fixture content', receivedAt: WHEN,
    parseStatus: 'parse_failed', transactionType: 'unknown', createdAt: WHEN, updatedAt: WHEN };
  const transaction = { id: T, householdId: H, memberId: M, cardId: C, sourceEventId: E,
    transactionType: 'approval', status: 'approved', amount: 1700, netAmount: 1700,
    cancelledAmount: 0, currency: 'USD', originalAmount: null, originalCurrency: null,
    exchangeRate: null, merchantRaw: 'Synthetic merchant', merchantNormalized: 'synthetic merchant',
    categoryId: K, approvedAt: WHEN, cancelledAt: null, authorizationCode: null,
    installmentMonths: null, parentTransactionId: null, visibility: 'private', memo: null,
    excludedAt: null, createdAt: WHEN, updatedAt: WHEN };
  const tableValues = (table: Parameters<typeof getTableColumns>[0], values: Record<string, unknown>) =>
    Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);

  function execute(query: string): unknown[][] {
    if (query === 'select 1 as legacy_scope_probe') return [[1]];
    if (query.startsWith('insert into "card_transactions"')) {
      throw new Error('API entry must delegate protected writes to a money command');
    }
    if (query.startsWith('insert into "source_items"')) { state.sources += 1; return [[S]]; }
    if (query.startsWith('insert into "card_sms_events"')) { state.events += 1; return [[E]]; }
    if (query.startsWith('insert into "feedback_events"')) { state.feedback += 1; return []; }
    if (query.startsWith('insert into "card_sms_templates"')) { state.policies += 1; return []; }
    if (query.startsWith('update "card_sms_events"')) { state.parseStatus = 'parsed'; return []; }
    if (query.includes('from "household_members"')) return options.inactiveMember ? [] : [[M]];
    if (query.includes('from "registered_devices"')) return [[D]];
    if (query.includes('from "payment_cards"')) {
      if (options.invalidCard) return [];
      const projection = query.split(' from ')[0];
      if (projection.includes('"owner_member_id"') && !projection.includes('"masked_number"')) {
        return [['private', M, false]];
      }
      if (projection.includes('"masked_number"')) return [[C, 'synthetic-card', 'synthetic', 'private', M, false]];
      return [['private']];
    }
    if (query.includes('from "card_sms_events"')) {
      return [tableValues(schema.cardSmsEvents, { ...event, parseStatus: state.parseStatus })];
    }
    if (query.includes('from "card_transactions"')) {
      if (query.includes('"card_transactions"."source_event_id" =')) {
        return options.existingTransaction ? [[T]] : [];
      }
      return options.missingFullRow ? [] : [tableValues(schema.cardTransactions, transaction)];
    }
    if (query.includes('from "expense_categories"')) return [['synthetic-category']];
    throw new Error(`Unexpected synthetic SQL: ${query}`);
  }

  const unsafe = (scope: 'outer' | 'transaction') => (query: string, params: unknown[]) => {
    queries.push({ sql: query, params, scope });
    const result = Promise.resolve().then(() => execute(query));
    return Object.assign(result, { values: () => result });
  };
  const driver = {
    options: { parsers: {}, serializers: {} }, unsafe: unsafe('outer'),
    async begin<R>(run: (client: unknown) => Promise<R>): Promise<R> {
      const before = { ...state };
      state.open = true;
      try {
        const result = await run({ ...driver, unsafe: unsafe('transaction') });
        state.open = false; state.commits += 1; return result;
      } catch (error) {
        Object.assign(state, before); state.open = false; state.rollbacks += 1; throw error;
      }
    },
  };
  const db = drizzle(driver as unknown as postgres.Sql, { schema });
  const command = async (_input: unknown, { tx }: { tx: DbExecutor }) => {
    // A marker read proves that the passed executor is the outer transaction,
    // rather than a new transaction or the unscoped database handle.
    expect(state.open).toBe(true);
    await tx.execute(sql`select 1 as legacy_scope_probe`);
    if (options.commandThrows) throw new Error('synthetic command failure');
    if (options.rejection) return { ok: false as const, reason: options.rejection };
    return { ok: true as const, value: { transactionId: T, alreadyPromoted: options.alreadyPromoted === true } };
  };
  const legacy = { createReviewedTransaction: vi.fn(command), createApproval: vi.fn(command) };
  const commands = { createApproval: vi.fn(command), createCancellation: vi.fn(command) };
  const observe = vi.fn(() => {
    expect(state.open).toBe(false);
    expect(state.commits).toBe(1);
  });
  const shadow = { observe } as unknown as MoneyShadowService;
  const money = { enforced: options.enforced === true, legacy, commands } as unknown as MoneyWriteService;
  return { state, queries, legacy, commands, observe,
    review: new CardSmsReviewService(db, shadow, money),
    manual: new ManualEntryService(db, {} as CardSmsIngestService, shadow, money,
      { get: () => ({ cardSmsActionGate: 'off' }) } as unknown as ConfigService) };
}

const inputWrites = (queries: Array<{ sql: string }>) => queries.filter((q) => /^(insert|update)/.test(q.sql));

describe('legacy human review uses the common money command', () => {
  it.each(['approval', 'cancellation'] as const)('delegates %s with visibility, metadata, and the enclosing transaction', async (transactionType) => {
    const f = setup();
    await expect(f.review.review(U, E, { ...reviewInput, transactionType }))
      .resolves.toEqual({ cardSmsEventId: E, parseStatus: 'parsed', transactionId: T });
    expect(f.legacy.createReviewedTransaction).toHaveBeenCalledWith({
      metadata: expect.objectContaining({ householdId: H, memberId: M, cardId: C,
        sourceEventId: E, categoryId: K, visibility: 'private', merchantRaw: 'Synthetic merchant' }),
      minorUnits: 1700, currency: 'USD', transactionType, occurredAt: new Date(WHEN),
    }, { tx: expect.anything() });
    expect(f.commands.createApproval).not.toHaveBeenCalled();
    expect(f.commands.createCancellation).not.toHaveBeenCalled();
    expect(f.queries.find((q) => q.sql === 'select 1 as legacy_scope_probe')?.scope).toBe('transaction');
    expect(f.queries.every((q) => q.scope === 'transaction')).toBe(true);
    expect(f.state.feedback).toBe(1);
    expect(f.observe).toHaveBeenCalledWith(T, 'api_human_review');
  });

  it('preserves declined review without creating a transaction command', async () => {
    const f = setup();
    await expect(f.review.review(U, E, { transactionType: 'declined' }))
      .resolves.toEqual({ cardSmsEventId: E, parseStatus: 'parsed', transactionId: null });
    expect(f.legacy.createReviewedTransaction).not.toHaveBeenCalled();
    expect(f.commands.createApproval).not.toHaveBeenCalled();
    expect(f.state.feedback).toBe(1);
    expect(f.observe).toHaveBeenCalledWith(null, 'api_human_review');
  });

  it.each([{ inactiveMember: true }, { otherRecipient: true }, { invalidCard: true }, { existingTransaction: true }])(
    'keeps membership, recipient, card, and already-promoted checks before writes: %j', async (options) => {
      const f = setup(options);
      await expect(f.review.review(U, E, reviewInput)).rejects.toThrow();
      expect(inputWrites(f.queries)).toEqual([]);
      expect(f.legacy.createReviewedTransaction).not.toHaveBeenCalled();
      expect(f.observe).not.toHaveBeenCalled();
    });

  it.each([{ alreadyPromoted: true }, { rejection: 'invalid_amount' }, { commandThrows: true }])(
    'rolls back the event, label, and consent policy on command failure: %j', async (options) => {
      const f = setup(options);
      await expect(f.review.review(U, E, { ...reviewInput, reuseForSimilar: true })).rejects.toThrow();
      expect(f.state).toMatchObject({ commits: 0, rollbacks: 1, feedback: 0, policies: 0,
        parseStatus: 'parse_failed' });
      expect(f.queries.some((q) => q.sql.startsWith('insert into "card_sms_templates"'))).toBe(true);
      expect(f.observe).not.toHaveBeenCalled();
    });

  it('retains the v2 cancellation path when enforced', async () => {
    const f = setup({ enforced: true });
    await f.review.review(U, E, { ...reviewInput, transactionType: 'cancellation' });
    expect(f.commands.createCancellation).toHaveBeenCalledWith(expect.objectContaining({
      minorUnits: 1700, currency: 'USD', occurredAt: new Date(WHEN), receivedAt: new Date(WHEN),
    }), { tx: expect.anything() });
    expect(f.legacy.createReviewedTransaction).not.toHaveBeenCalled();
  });
});

describe('legacy manual fields uses the common approval command', () => {
  it('preserves legacy money, private visibility, full-row response and category mapping', async () => {
    const f = setup();
    const result = await f.manual.manualFields(U, manualInput);
    expect(f.legacy.createApproval).toHaveBeenCalledWith({
      metadata: expect.objectContaining({ householdId: H, memberId: M, sourceEventId: E,
        cardId: C, categoryId: K, visibility: 'private', merchantRaw: 'Synthetic merchant' }),
      money: { amount: 1700, currency: 'USD', originalAmount: null, originalCurrency: null, exchangeRate: null },
      occurredAt: new Date(WHEN), status: 'approved',
    }, { tx: expect.anything() });
    expect(result).toMatchObject({ id: T, amount: 1700, netAmount: 1700, currency: 'USD',
      originalAmount: null, visibility: 'private', categorySlug: 'synthetic-category', masked: false });
    expect(f.queries.find((q) => q.sql === 'select 1 as legacy_scope_probe')?.scope).toBe('transaction');
    expect(f.state).toMatchObject({ commits: 1, sources: 1, events: 1 });
    expect(f.commands.createApproval).not.toHaveBeenCalled();
    expect(f.observe).toHaveBeenCalledWith(T, 'api_manual_fields');
  });

  it.each([{ inactiveMember: true }, { invalidCard: true }])('does not write a source/event for rejected access: %j', async (options) => {
    const f = setup(options);
    const expected = options.inactiveMember ? ForbiddenException : BadRequestException;
    await expect(f.manual.manualFields(U, manualInput)).rejects.toBeInstanceOf(expected);
    expect(inputWrites(f.queries)).toEqual([]);
    expect(f.legacy.createApproval).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
  });

  it.each([{ rejection: 'invalid_amount' }, { commandThrows: true }, { missingFullRow: true }])(
    'rolls back the source/event and omits shadow observation on failure: %j', async (options) => {
      const f = setup(options);
      await expect(f.manual.manualFields(U, manualInput)).rejects.toThrow();
      expect(f.state).toMatchObject({ commits: 0, rollbacks: 1, sources: 0, events: 0 });
      expect(f.observe).not.toHaveBeenCalled();
    });

  it('treats a conflicting source event as a transaction conflict and rolls back', async () => {
    const f = setup({ alreadyPromoted: true });
    await expect(f.manual.manualFields(U, manualInput)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state).toMatchObject({ commits: 0, rollbacks: 1, sources: 0, events: 0 });
    expect(f.observe).not.toHaveBeenCalled();
  });

  it('retains the v2 approval command and performs full-row lookup after it', async () => {
    const f = setup({ enforced: true });
    expect(await f.manual.manualFields(U, manualInput)).toMatchObject({ id: T, currency: 'USD' });
    expect(f.commands.createApproval).toHaveBeenCalledWith(expect.objectContaining({
      minorUnits: 1700, currency: 'USD', occurredAt: new Date(WHEN),
    }), { tx: expect.anything() });
    expect(f.legacy.createApproval).not.toHaveBeenCalled();
  });
});
