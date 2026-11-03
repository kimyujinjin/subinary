import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { cardLast4CorrectionRequestSchema, cardUpdateRequestSchema, type CardLast4CorrectionRequest } from '@family/contracts';
import { schema } from '@family/database';
import { CardController } from './card.controller';
import { CardService } from './card.service';

const H = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const U = '44444444-4444-4444-8444-444444444444';
const O = '55555555-5555-4555-8555-555555555555';
const SECOND = '66666666-6666-4666-8666-666666666666';
const DATE = '2026-11-01T00:00:00.000Z';
const request = { last4: '5678', expectedLast4: '1234', expectedOwnerMemberId: M } as const;
type Row = Record<string, unknown>;

const target = (changes: Row = {}): Row => ({ id: C, householdId: H, ownerMemberId: M,
  issuer: '테스트카드', alias: '합성 카드', maskedNumber: '1234', cardFingerprint: 'synthetic-fingerprint',
  visibility: 'private', isShared: false, status: 'active', createdBy: U, createdAt: DATE, updatedAt: DATE, ...changes });
const peer = (changes: Row = {}): Row => target({ id: SECOND, alias: '다른 합성 카드', maskedNumber: '5678', ...changes });

interface State {
  cards: Row[];
  actor: Row;
  household: boolean;
  begins: number;
  commits: number;
  rollbacks: number;
}
interface Options {
  card?: Row;
  peers?: Row[];
  member?: Row;
  household?: boolean;
  beforeTransaction?: (state: State) => void;
  updateFails?: boolean;
  updateCasMiss?: boolean;
  busyLock?: 'membership' | 'cards';
}

/** Real Drizzle SQL/decoding over synthetic rows; no server, credentials or network. */
function setup(options: Options = {}) {
  const state: State = { cards: [target(options.card), ...(options.peers ?? [])],
    actor: { id: M, householdId: H, userId: U, role: 'member', status: 'active', joinedAt: DATE,
      createdAt: DATE, updatedAt: DATE, ...(options.member ?? {}) }, household: options.household !== false,
    begins: 0, commits: 0, rollbacks: 0 };
  const queries: Array<{ sql: string; params: unknown[]; scope: string }> = [];
  const rowValues = (table: typeof schema.paymentCards | typeof schema.householdMembers, row: Row) =>
    Object.keys(getTableColumns(table)).map(key => row[key] ?? null);
  const unsafe = (scope: string) => (sql: string, params: unknown[]) => {
    queries.push({ sql, params, scope });
    const result = Promise.resolve().then((): unknown[][] => {
      if (sql.startsWith('set transaction')) return [];
      if (sql.includes('from "households"')) return state.household ? [[H]] : [];
      if (sql.includes('from "household_members"')) {
        if (scope === 'transaction' && options.busyLock === 'membership') {
          throw Object.assign(new Error('synthetic row lock busy'), { code: '55P03' });
        }
        return state.actor.status === 'active' && params[0] === state.actor.householdId && params[1] === state.actor.userId
          ? [rowValues(schema.householdMembers, state.actor)] : [];
      }
      if (sql.startsWith('update "payment_cards"')) {
        if (options.updateFails) throw new Error('synthetic update failure');
        if (options.updateCasMiss) return [];
        const card = state.cards.find(row => row.id === params[2]);
        if (!card) return [];
        card.maskedNumber = params[0]; card.updatedAt = params[1];
        return [rowValues(schema.paymentCards, card)];
      }
      if (sql.includes('from "payment_cards"')) {
        if (sql.includes('for update') && options.busyLock === 'cards') {
          throw Object.assign(new Error('synthetic row lock busy'), { code: '55P03' });
        }
        const cards = sql.includes('for update')
          ? state.cards.filter(row => row.householdId === H).sort((a, b) => String(a.id).localeCompare(String(b.id)))
          : state.cards.filter(row => row.id === params[0]);
        return cards.map(row => rowValues(schema.paymentCards, row));
      }
      throw new Error('unexpected synthetic query');
    });
    return Object.assign(result, { values: () => result });
  };
  const driver = {
    options: { parsers: {}, serializers: {} }, unsafe: unsafe('outer'),
    async begin<T>(run: (client: unknown) => Promise<T>): Promise<T> {
      options.beforeTransaction?.(state);
      const before = structuredClone(state.cards);
      state.begins += 1;
      try { const value = await run({ ...driver, unsafe: unsafe('transaction') }); state.commits += 1; return value; }
      catch (error) { state.cards = before; state.rollbacks += 1; throw error; }
    },
  };
  const db = drizzle(driver as unknown as postgres.Sql, { schema });
  const service = new CardService(db);
  return { service, controller: new CardController(service), state, queries };
}

const writes = (queries: Array<{ sql: string }>) => queries.filter(q => /^(update|insert|delete)/.test(q.sql));
const responseCode = async (run: Promise<unknown>): Promise<unknown> => {
  const error: unknown = await run.then(() => null, e => e);
  expect(error).toBeInstanceOf(ConflictException);
  return (error as ConflictException).getResponse();
};

describe('strict last-four correction contract', () => {
  it('requires the expected value and permits only four ASCII digits or a null expected value', () => {
    expect(cardLast4CorrectionRequestSchema.parse(request)).toEqual(request);
    expect(cardLast4CorrectionRequestSchema.parse({ ...request, expectedLast4: null })).toEqual({ ...request, expectedLast4: null });
  });
  it.each(['123', '12345', '1234\n', ' 1234', '１２３４', '12a4', '****1234', '0000000000000000', '', null, 1234])(
    'rejects invalid last4 without coercion: %j', last4 => {
      expect(cardLast4CorrectionRequestSchema.safeParse({ ...request, last4 }).success).toBe(false);
    });
  it.each([undefined, '', '123', '12345', '１２３４', '****1234', 1234])('rejects invalid expectedLast4: %j', expectedLast4 => {
    expect(cardLast4CorrectionRequestSchema.safeParse({ ...request, expectedLast4 }).success).toBe(false);
  });
  it.each([undefined, null, '', '1234', 'not-a-uuid', 1234])('requires a valid expected owner UUID: %j', expectedOwnerMemberId => {
    expect(cardLast4CorrectionRequestSchema.safeParse({ ...request, expectedOwnerMemberId }).success).toBe(false);
  });
  it.each(['ownerMemberId', 'maskedNumber', 'alias', 'issuer', 'visibility', 'status', 'isShared'])('forbids extra field %s', key => {
    expect(cardLast4CorrectionRequestSchema.safeParse({ ...request, [key]: '1234' }).success).toBe(false);
  });
  it('does not add last4 correction to the general update schema', () => {
    expect(cardUpdateRequestSchema.parse({ maskedNumber: '5678' })).toEqual({});
  });
});

describe('dedicated last-four correction endpoint', () => {
  it('uses normal authenticated PATCH routing and returns CardSummary', async () => {
    const { controller } = setup();
    expect(Reflect.getMetadata(PATH_METADATA, CardController.prototype.correctLast4)).toBe(':id/last4');
    expect(Reflect.getMetadata(METHOD_METADATA, CardController.prototype.correctLast4)).toBe(RequestMethod.PATCH);
    expect(await controller.correctLast4({ userId: U } as never, C, request)).toMatchObject({ id: C, maskedNumber: '5678', ownerMemberId: M });
  });
  it.each([
    { ...request, last4: '0000000000000000' }, { ...request, ownerMemberId: O },
    { last4: '5678' }, { ...request, expectedLast4: '****1234' },
    { last4: '5678', expectedLast4: '1234' }, { ...request, expectedOwnerMemberId: 'not-a-uuid' },
  ])('revalidates service calls before any query: %j', input => {
    const { service, queries, state } = setup();
    return expect(service.correctLast4(U, C, input as CardLast4CorrectionRequest)).rejects.toBeInstanceOf(BadRequestException)
      .then(() => { expect(queries).toEqual([]); expect(state.begins).toBe(0); });
  });
  it('changes only target maskedNumber and updatedAt, never creates or backfills', async () => {
    const { service, state, queries } = setup({ peers: [peer({ ownerMemberId: O })] });
    const before = structuredClone(state.cards);
    const create = vi.spyOn(service, 'create');
    const backfill = vi.spyOn(service as unknown as { backfillUnlinked: () => Promise<number> }, 'backfillUnlinked');
    await service.correctLast4(U, C, request);
    const actual = state.cards.find(row => row.id === C)!;
    expect(actual).toEqual({ ...before[0], maskedNumber: '5678', updatedAt: expect.any(String) });
    expect(state.cards.find(row => row.id === SECOND)).toEqual(before[1]);
    expect(writes(queries)).toHaveLength(1);
    const update = writes(queries)[0]!;
    expect(update.sql.split(' where ')[0]).toMatch(/^update "payment_cards" set "masked_number" = \$1, "updated_at" = \$2$/);
    expect(update.sql).toContain('"payment_cards"."masked_number" =');
    expect(queries.some(q => /card_transactions|card_sms_events|budgets/.test(q.sql))).toBe(false);
    expect(create).not.toHaveBeenCalled(); expect(backfill).not.toHaveBeenCalled();
  });
  it('locks the household, active actor, then cards in deterministic order at READ COMMITTED', async () => {
    const { service, queries } = setup(); await service.correctLast4(U, C, request);
    const transaction = queries.filter(q => q.scope === 'transaction');
    expect(transaction[0]?.sql).toBe('set transaction isolation level read committed');
    const lockQueries = transaction.filter(q => /for (update|share)/.test(q.sql));
    expect(lockQueries).toHaveLength(3);
    expect(lockQueries[0]?.sql).toContain('from "households"'); expect(lockQueries[0]?.sql).toContain('for update');
    expect(lockQueries[0]?.sql).not.toContain('nowait');
    expect(lockQueries[1]?.sql).toContain('from "household_members"'); expect(lockQueries[1]?.sql).toContain('for share');
    expect(lockQueries[1]?.sql).toContain('nowait');
    expect(lockQueries[1]?.params).toEqual(expect.arrayContaining([H, U, 'active']));
    expect(lockQueries[2]?.sql).toContain('order by "payment_cards"."id" asc for update');
    expect(lockQueries[2]?.sql).toContain('nowait');
    expect(lockQueries[2]?.params).toEqual([H]);
  });
  it('checks active membership and ownership before taking any transactional lock', async () => {
    const { service, queries, state } = setup({ card: { ownerMemberId: O } });
    await expect(service.correctLast4(U, C, request)).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.begins).toBe(0); expect(writes(queries)).toEqual([]);
  });
  it.each(['owner', 'admin'])('permits the active household %s to correct another owner’s card', async role => {
    const { service, state } = setup({ card: { ownerMemberId: O }, member: { role } });
    expect(await service.correctLast4(U, C, { ...request, expectedOwnerMemberId: O })).toMatchObject({ ownerMemberId: O, maskedNumber: '5678' });
    expect(state.cards[0]?.ownerMemberId).toBe(O);
  });
  it('refuses inactive members before locking', async () => {
    const { service, state } = setup({ member: { status: 'removed' } });
    await expect(service.correctLast4(U, C, request)).rejects.toBeInstanceOf(ForbiddenException); expect(state.begins).toBe(0);
  });
  it('refuses another household before locking or writing', async () => {
    const { service, state, queries } = setup({ card: { householdId: O } });
    await expect(service.correctLast4(U, C, request)).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.begins).toBe(0); expect(writes(queries)).toEqual([]);
  });
  it('uses the exact card ID and does not select a similarly named peer', async () => {
    const { service, state, queries } = setup({ peers: [peer({ alias: '합성 카드', ownerMemberId: O })] });
    await expect(service.correctLast4(U, O, request)).rejects.toBeInstanceOf(NotFoundException);
    expect(state.begins).toBe(0); expect(writes(queries)).toEqual([]);
  });
  it('rechecks membership after the household lock', async () => {
    const { service, state, queries } = setup({ beforeTransaction: s => { s.actor.status = 'removed'; } });
    await expect(service.correctLast4(U, C, request)).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.rollbacks).toBe(1); expect(writes(queries)).toEqual([]);
  });
  it('rechecks current owner after locking, rather than trusting the preflight owner', async () => {
    const { service, queries } = setup({ beforeTransaction: s => { s.cards[0]!.ownerMemberId = O; } });
    await expect(service.correctLast4(U, C, request)).rejects.toBeInstanceOf(ForbiddenException); expect(writes(queries)).toEqual([]);
  });
  it('rejects a manager’s stale UI owner even when the expected digits still match', async () => {
    const { service, state, queries } = setup({ card: { ownerMemberId: O }, member: { role: 'admin' } });
    const before = structuredClone(state.cards);
    expect(await responseCode(service.correctLast4(U, C, request))).toMatchObject({ code: 'card_last4_stale' });
    expect(state.cards).toEqual(before); expect(state.rollbacks).toBe(1); expect(writes(queries)).toEqual([]);
  });
  it.each(['1234', '5678'])('checks a concurrently changed owner before update or same-value idempotence (%s)', async maskedNumber => {
    const { service, state, queries } = setup({ card: { maskedNumber }, member: { role: 'admin' },
      beforeTransaction: s => { s.cards[0]!.ownerMemberId = O; } });
    expect(await responseCode(service.correctLast4(U, C, request))).toMatchObject({ code: 'card_last4_stale' });
    expect(state.cards[0]).toMatchObject({ ownerMemberId: O, maskedNumber, updatedAt: DATE });
    expect(state.rollbacks).toBe(1); expect(writes(queries)).toEqual([]);
  });
  it('does not mutate a missing household or deleted card', async () => {
    const missingHousehold = setup({ household: false });
    await expect(missingHousehold.service.correctLast4(U, C, request)).rejects.toBeInstanceOf(ForbiddenException);
    const missingCard = setup({ beforeTransaction: s => { s.cards = []; } });
    await expect(missingCard.service.correctLast4(U, C, request)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes(missingCard.queries)).toEqual([]);
  });
  it('returns a safe stale 409 without echoing current digits or card metadata', async () => {
    const { service, queries } = setup({ card: { maskedNumber: '2468' } });
    const response = await responseCode(service.correctLast4(U, C, request));
    expect(response).toMatchObject({ code: 'card_last4_stale' });
    expect(JSON.stringify(response)).not.toMatch(/2468|5678|합성 카드/); expect(writes(queries)).toEqual([]);
  });
  it('a response-loss retry with desired digits already stored is idempotent even with the old expectation', async () => {
    const { service, state, queries } = setup({ card: { maskedNumber: '5678' } });
    const before = structuredClone(state.cards);
    expect(await service.correctLast4(U, C, request)).toMatchObject({ maskedNumber: '5678' });
    expect(state.cards).toEqual(before); expect(writes(queries)).toEqual([]);
  });
  it('supports an explicitly unregistered null value without treating other formats as null', async () => {
    const { service } = setup({ card: { maskedNumber: null } });
    expect(await service.correctLast4(U, C, { ...request, expectedLast4: null })).toMatchObject({ maskedNumber: '5678' });
  });
  it('understands a four-digit legacy decoration without accepting that format in requests', async () => {
    const { service } = setup({ card: { maskedNumber: '**** 1234' } });
    expect(await service.correctLast4(U, C, request)).toMatchObject({ maskedNumber: '5678' });
  });
  it.each(['', '123', '0000000000000000', '１２３４'])('never guesses digits or null from malformed stored format: %j', maskedNumber => {
    const { service, queries } = setup({ card: { maskedNumber } });
    return responseCode(service.correctLast4(U, C, { ...request, expectedLast4: null })).then(response => {
      expect(response).toMatchObject({ code: 'card_last4_stale' }); expect(writes(queries)).toEqual([]);
    });
  });
  it('a CAS miss is stale and does not produce a successful result', async () => {
    const { service, state } = setup({ updateCasMiss: true });
    expect(await responseCode(service.correctLast4(U, C, request))).toMatchObject({ code: 'card_last4_stale' });
    expect(state.rollbacks).toBe(1);
  });
  it('write errors roll back instead of returning a corrected card', async () => {
    const { service, state } = setup({ updateFails: true }); const before = structuredClone(state.cards);
    const error: unknown = await service.correctLast4(U, C, request).catch(e => e);
    expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(ConflictException);
    expect((error as { cause: unknown }).cause).toMatchObject({ message: 'synthetic update failure' });
    expect(state.cards).toEqual(before); expect(state.rollbacks).toBe(1);
  });
  it.each(['membership', 'cards'] as const)('never waits while holding the household for a busy %s lock', async busyLock => {
    const { service, state, queries } = setup({ busyLock }); const before = structuredClone(state.cards);
    expect(await responseCode(service.correctLast4(U, C, request))).toMatchObject({ code: 'card_last4_stale' });
    expect(state.cards).toEqual(before); expect(state.rollbacks).toBe(1); expect(writes(queries)).toEqual([]);
  });
});

describe('matching-scope collisions', () => {
  it.each([
    { description: 'same owner', other: peer() },
    { description: 'normalized issuer and decoration', other: peer({ issuer: ' 테 스 트 ', maskedNumber: '**** 5678' }) },
    { description: 'other shared card', other: peer({ ownerMemberId: O, isShared: true }) },
  ])('rejects $description with no conflicting-card details', async ({ other }) => {
    const { service, queries } = setup({ peers: [other] });
    const response = await responseCode(service.correctLast4(U, C, request));
    expect(response).toMatchObject({ code: 'card_last4_conflict' });
    expect(JSON.stringify(response)).not.toMatch(/5678|다른 합성 카드|66666666|55555555/); expect(writes(queries)).toEqual([]);
  });
  it('a shared target conflicts with another member’s personal card', async () => {
    const { service } = setup({ card: { isShared: true }, peers: [peer({ ownerMemberId: O })] });
    expect(await responseCode(service.correctLast4(U, C, request))).toMatchObject({ code: 'card_last4_conflict' });
  });
  it.each([
    { description: 'different personal owner', other: peer({ ownerMemberId: O }) },
    { description: 'different issuer', other: peer({ issuer: '다른카드' }) },
    { description: 'inactive other card', other: peer({ status: 'inactive' }) },
    { description: 'unregistered other card', other: peer({ maskedNumber: null }) },
    { description: 'different household', other: peer({ householdId: O }) },
  ])('allows $description without changing that card', async ({ other }) => {
    const { service, state } = setup({ peers: [other] });
    const before = structuredClone(state.cards[1]);
    expect(await service.correctLast4(U, C, request)).toMatchObject({ maskedNumber: '5678' });
    expect(state.cards.find(row => row.id === SECOND)).toEqual(before);
  });
  it('an inactive target does not participate in active matching collisions', async () => {
    const { service } = setup({ card: { status: 'inactive' }, peers: [peer()] });
    expect(await service.correctLast4(U, C, request)).toMatchObject({ status: 'inactive', maskedNumber: '5678' });
  });
  it('invalid non-null digits in an overlapping card are not truncated into inferred last4', async () => {
    const { service } = setup({ peers: [peer({ maskedNumber: '0000000000000000' })] });
    expect(await responseCode(service.correctLast4(U, C, request))).toMatchObject({ code: 'card_last4_stale' });
  });
  it('invalid digits in a different personal owner’s card do not widen the collision scope', async () => {
    const { service } = setup({ peers: [peer({ ownerMemberId: O, maskedNumber: '0000000000000000' })] });
    expect(await service.correctLast4(U, C, request)).toMatchObject({ maskedNumber: '5678' });
  });
});
