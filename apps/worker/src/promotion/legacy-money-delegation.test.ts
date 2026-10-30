import type { schema } from '@family/database';
import { describe, expect, it, vi } from 'vitest';

import { TransactionPromotionService } from './transaction-promotion.service';

const ID = '00000000-0000-4000-8000-000000000001';
const TRANSACTION_ID = '00000000-0000-4000-8000-000000000002';
const occurredAt = new Date('2026-10-22T01:02:03.000Z');
const event = {
  id: ID,
  householdId: 'synthetic-household',
  memberId: 'synthetic-member',
  parseStatus: 'parsed',
  transactionType: 'approval',
  amount: 100,
  currency: 'USD',
  occurredAt,
  receivedAt: occurredAt,
  merchantRaw: 'synthetic merchant',
  installmentMonths: 3,
} as schema.CardSmsEvent;
const money = {
  amount: 1325,
  currency: 'KRW' as const,
  originalAmount: 100,
  originalCurrency: 'USD',
  exchangeRate: 1324.631860776439,
};
const link = { cardId: 'synthetic-card', ambiguous: false, visibility: 'household' as const };

type Money = typeof money;
type Link = Omit<typeof link, 'cardId'> & { cardId: string | null };
interface PromotionInternals {
  promote(id: string, options?: { repair?: boolean }): Promise<void>;
  promoteApproval(e: schema.CardSmsEvent, m: Money, l: Link, merchant: string | null, category: string | null): Promise<{
    status: string; transactionId: string | null;
  }>;
  promoteCancellation(e: schema.CardSmsEvent, m: Money, l: Link, merchant: string | null, category: string | null): Promise<{
    status: string; linked: boolean; skipped: boolean; transactionId: string | null;
  }>;
}

/** The worker may read/classify, but any worker-owned money write fails this fixture. */
function subject(enforced = false, sourceEvent = event) {
  const forbidden = vi.fn(() => { throw new Error('worker-owned money mutation'); });
  const responses: unknown[][] = [[sourceEvent], [], []];
  const db = {
    insert: forbidden,
    update: forbidden,
    delete: forbidden,
    transaction: vi.fn(async (_callback: (tx: unknown) => Promise<unknown>, _options?: unknown): Promise<unknown> => {
      throw new Error('unexpected worker transaction');
    }),
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected worker read');
      return next;
    } }) }) })),
  };
  const legacyApproval = vi.fn().mockResolvedValue({
    ok: true, value: { transactionId: TRANSACTION_ID, alreadyPromoted: false },
  });
  const legacyCancellation = vi.fn().mockResolvedValue({
    ok: true, value: {
      transactionId: TRANSACTION_ID, alreadyPromoted: false,
      linked: true, status: 'partially_cancelled',
    },
  });
  const v2Approval = vi.fn().mockResolvedValue({
    ok: true, value: { transactionId: TRANSACTION_ID, alreadyPromoted: false },
  });
  const v2Cancellation = vi.fn().mockResolvedValue({
    ok: true, value: { transactionId: TRANSACTION_ID, alreadyPromoted: false, parentTransactionId: 'synthetic-parent' },
  });
  const duplicate = vi.fn().mockResolvedValue(false);
  const category = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn().mockResolvedValue(undefined);
  const budget = vi.fn().mockResolvedValue(undefined);
  const shadow = vi.fn().mockResolvedValue(undefined);
  const service = Object.assign(Object.create(TransactionPromotionService.prototype), {
    db,
    moneyWrite: {
      enforced,
      legacy: { createApproval: legacyApproval, createCancellation: legacyCancellation },
      commands: { createApproval: v2Approval, createCancellation: v2Cancellation },
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    moneyShadow: { observe: shadow },
    isDuplicateApproval: duplicate,
    resolveCard: vi.fn().mockResolvedValue(link),
    resolveMerchantAlias: vi.fn().mockResolvedValue('synthetic normalized merchant'),
    resolveCategoryId: vi.fn().mockResolvedValue(null),
    convertToKrw: vi.fn().mockResolvedValue(money),
    enqueueCategorySuggestion: category,
    enqueueNotification: notify,
    checkBudgetAlerts: budget,
  }) as PromotionInternals;
  return { service, db, forbidden, legacyApproval, legacyCancellation,
    v2Approval, v2Cancellation, duplicate, category, notify, budget, shadow };
}

describe('legacy promotion delegates protected money writes to the shared domain', () => {
  it('keeps KRW duplicate classification and forwards the original FX facts to approval creation', async () => {
    const s = subject();
    s.duplicate.mockResolvedValue(true);
    expect(await s.service.promoteApproval(event, money, link, 'synthetic normalized', 'synthetic-category'))
      .toEqual({ status: 'duplicate_suspected', transactionId: TRANSACTION_ID });
    expect(s.duplicate).toHaveBeenCalledWith(event.householdId, event.memberId, link.cardId,
      money.amount, 'KRW', 'synthetic normalized', occurredAt);
    expect(s.legacyApproval).toHaveBeenCalledTimes(1);
    expect(s.legacyApproval).toHaveBeenCalledWith({
      metadata: {
        householdId: event.householdId, memberId: event.memberId, cardId: link.cardId,
        sourceEventId: ID, merchantRaw: event.merchantRaw, merchantNormalized: 'synthetic normalized',
        categoryId: 'synthetic-category', authorizationCode: null, installmentMonths: 3,
        visibility: 'household', memo: null,
      },
      money, occurredAt, status: 'duplicate_suspected',
    });
    expect(s.v2Approval).not.toHaveBeenCalled();
    expect(s.forbidden).not.toHaveBeenCalled();
    expect(s.db.transaction).not.toHaveBeenCalled();
  });

  it('keeps ambiguous cards pending without running a duplicate query', async () => {
    const s = subject();
    expect(await s.service.promoteApproval(event, money, { ...link, cardId: null, ambiguous: true }, null, null))
      .toEqual({ status: 'pending_review', transactionId: TRANSACTION_ID });
    expect(s.duplicate).not.toHaveBeenCalled();
    expect(s.legacyApproval).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending_review', metadata: expect.objectContaining({ cardId: null }),
    }));
  });

  it('does not expose an existing approval id to notification callers on an idempotent collision', async () => {
    const s = subject();
    s.legacyApproval.mockResolvedValue({ ok: true, value: { transactionId: TRANSACTION_ID, alreadyPromoted: true } });
    expect(await s.service.promoteApproval(event, money, link, null, null))
      .toEqual({ status: 'already_promoted', transactionId: null });
  });

  it('preserves linked cancellation outcome while the domain owns candidate locks, linking and cumulative amounts', async () => {
    const s = subject();
    expect(await s.service.promoteCancellation({ ...event, transactionType: 'cancellation' }, money, link, null, null))
      .toEqual({ status: 'partially_cancelled', linked: true, skipped: false, transactionId: TRANSACTION_ID });
    expect(s.legacyCancellation).toHaveBeenCalledTimes(1);
    expect(s.legacyCancellation).toHaveBeenCalledWith({
      metadata: {
        householdId: event.householdId, memberId: event.memberId, cardId: link.cardId,
        sourceEventId: ID, merchantRaw: event.merchantRaw, merchantNormalized: null,
        categoryId: null, authorizationCode: null, installmentMonths: 3,
        visibility: 'household', memo: null,
      },
      money, occurredAt,
    });
    expect(s.forbidden).not.toHaveBeenCalled();
    expect(s.db.transaction).not.toHaveBeenCalled();
    expect(s.v2Cancellation).not.toHaveBeenCalled();
  });

  it('keeps unmatched cancellations pending and forwards an absent timestamp', async () => {
    const s = subject();
    s.legacyCancellation.mockResolvedValue({ ok: true, value: {
      transactionId: TRANSACTION_ID, alreadyPromoted: false, linked: false, status: 'pending_review',
    } });
    expect(await s.service.promoteCancellation({ ...event, occurredAt: null }, money, { ...link, cardId: null }, null, null))
      .toEqual({ status: 'pending_review', linked: false, skipped: false, transactionId: TRANSACTION_ID });
    expect(s.legacyCancellation).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: null }));
  });

  it('hides an existing cancellation id and marks the promotion skipped on collision', async () => {
    const s = subject();
    s.legacyCancellation.mockResolvedValue({ ok: true, value: {
      transactionId: TRANSACTION_ID, alreadyPromoted: true, linked: false, status: 'pending_review',
    } });
    expect(await s.service.promoteCancellation(event, money, link, null, null))
      .toEqual({ status: 'pending_review', linked: false, skipped: true, transactionId: null });
  });

  it.each(['approval', 'cancellation'] as const)('propagates rejected %s commands before reporting promotion success', async (kind) => {
    const s = subject();
    const command = kind === 'approval' ? s.legacyApproval : s.legacyCancellation;
    command.mockResolvedValue({ ok: false, reason: 'invalid_money_input' });
    const run = kind === 'approval' ? s.service.promoteApproval.bind(s.service) : s.service.promoteCancellation.bind(s.service);
    await expect(run(event, money, link, null, null)).rejects.toThrow(`legacy money rejected ${kind}: invalid_money_input`);
    expect(s.forbidden).not.toHaveBeenCalled();
  });
});

describe('v2 promotion retains its existing money command and transaction boundaries', () => {
  it('locks the card and reclassifies duplicate status inside the passed serializable transaction', async () => {
    const s = subject(true);
    const order: string[] = [];
    s.duplicate.mockImplementation(async () => {
      order.push('duplicate');
      return order.length > 1;
    });
    const tx = { select: () => ({ from: () => ({ where: () => ({ for: async (mode: string) => {
      expect(mode).toBe('update'); order.push('card_lock'); return [];
    } }) }) }) };
    s.db.transaction.mockImplementation(async (callback: unknown, options: unknown) => {
      expect(options).toEqual({ isolationLevel: 'serializable' });
      return (callback as (tx: unknown) => Promise<unknown>)(tx);
    });
    expect(await s.service.promoteApproval(event, money, link, null, null))
      .toEqual({ status: 'duplicate_suspected', transactionId: TRANSACTION_ID });
    expect(order).toEqual(['duplicate', 'card_lock', 'duplicate']);
    expect(s.v2Approval).toHaveBeenCalledWith(expect.objectContaining({
      minorUnits: 100, currency: 'USD', reviewFlag: 'duplicate_suspected', occurredAt,
    }), { tx });
    expect(s.legacyApproval).not.toHaveBeenCalled();
    expect(s.forbidden).not.toHaveBeenCalled();
  });

  it('keeps the original-currency cancellation command and suppresses duplicate notification ids', async () => {
    const s = subject(true);
    s.v2Cancellation.mockResolvedValue({ ok: true, value: {
      transactionId: TRANSACTION_ID, alreadyPromoted: true, parentTransactionId: 'synthetic-parent',
    } });
    expect(await s.service.promoteCancellation(event, money, link, null, null))
      .toEqual({ status: 'approved', linked: true, skipped: true, transactionId: null });
    expect(s.v2Cancellation).toHaveBeenCalledWith(expect.objectContaining({
      minorUnits: 100, currency: 'USD', occurredAt, receivedAt: event.receivedAt,
    }));
    expect(s.legacyCancellation).not.toHaveBeenCalled();
  });
});

describe('delegation preserves the promotion side-effect policy', () => {
  it.each(['approval', 'cancellation'] as const)('keeps repair %s promotion free of notifications and category jobs', async (kind) => {
    const s = subject(false, { ...event, transactionType: kind });
    await s.service.promote(ID, { repair: true });
    expect(kind === 'approval' ? s.legacyApproval : s.legacyCancellation).toHaveBeenCalledTimes(1);
    expect(s.shadow).toHaveBeenCalledTimes(1);
    expect(s.category).not.toHaveBeenCalled();
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.budget).not.toHaveBeenCalled();
  });

  it.each(['approval', 'cancellation'] as const)('does not re-enqueue jobs after an idempotent %s collision', async (kind) => {
    const s = subject(false, { ...event, transactionType: kind });
    const command = kind === 'approval' ? s.legacyApproval : s.legacyCancellation;
    command.mockResolvedValue({ ok: true, value: {
      transactionId: TRANSACTION_ID, alreadyPromoted: true, linked: false, status: 'pending_review',
    } });
    await s.service.promote(ID);
    expect(s.shadow).toHaveBeenCalledWith(null, `worker_promotion_${kind}`);
    expect(s.category).not.toHaveBeenCalled();
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.budget).not.toHaveBeenCalled();
  });

  it('keeps the normal fresh approval notification, category and budget hooks', async () => {
    const s = subject();
    await s.service.promote(ID);
    expect(s.shadow).toHaveBeenCalledWith(TRANSACTION_ID, 'worker_promotion_approval');
    expect(s.category).toHaveBeenCalledTimes(1);
    expect(s.notify).toHaveBeenCalledWith(event.householdId, TRANSACTION_ID);
    expect(s.budget).toHaveBeenCalledTimes(1);
  });
});
