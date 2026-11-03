import { describe, expect, it, vi } from 'vitest';
import type { schema } from '@family/database';
import { planChain, type FxSnapshotRef } from '@family/transaction-domain';

import { TransactionPromotionService } from './transaction-promotion.service';

const snapshot: FxSnapshotRef = {
  id: 'synthetic-snapshot', baseCurrency: 'USD', asOfDate: '2026-10-22',
  rate: '1324.631860776439', moneyContractVersion: 2,
};
const event = {
  id: 'synthetic-event', currency: 'USD', transactionType: 'approval',
  occurredAt: new Date('2026-10-21T16:00:00Z'),
  receivedAt: new Date('2026-10-23T00:00:00Z'),
} as schema.CardSmsEvent;

function subject(enforced = true, found: FxSnapshotRef | null = snapshot) {
  const find = vi.fn().mockResolvedValue(found);
  const latest = vi.fn().mockResolvedValue(1500);
  const service = {
    moneyWrite: { enforced, fxSnapshots: { find } },
    fxRate: { getRateToKrw: latest },
    logger: { info: vi.fn(), warn: vi.fn() },
  };
  const method = (TransactionPromotionService.prototype as unknown as {
    convertToKrw: (e: schema.CardSmsEvent, amount: number) => Promise<{
      amount: number; currency: string; originalAmount: number | null;
      originalCurrency: string | null; exchangeRate: number | null;
    }>;
  }).convertToKrw;
  return { find, latest, convert: (e = event, amount = 10_000) => method.call(service, e, amount) };
}

describe('v2 promotion uses the same dated snapshot as the money domain', () => {
  it('uses the transaction Seoul date and never asks the legacy latest-rate client', async () => {
    const s = subject();
    const actual = await s.convert();
    expect(s.find).toHaveBeenCalledWith({ baseCurrency: 'USD', asOfDate: '2026-10-22', moneyContractVersion: 2 });
    expect(s.latest).not.toHaveBeenCalled();
    const plan = planChain({ minorUnits: 10_000, currency: 'USD', snapshot }, []);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(actual.amount).toBe(plan.value.approval.amount);
    expect(actual).toMatchObject({ currency: 'KRW', originalAmount: 10_000, originalCurrency: 'USD' });
  });

  it('falls back to receivedAt only when occurredAt is absent, keeping the Seoul boundary', async () => {
    const s = subject();
    await s.convert({ ...event, occurredAt: null, receivedAt: new Date('2026-10-21T15:00:00Z') });
    expect(s.find).toHaveBeenCalledWith(expect.objectContaining({ asOfDate: '2026-10-22' }));
  });

  it('keeps missing history blocked instead of using today or a constant rate', async () => {
    const s = subject(true, null);
    await expect(s.convert()).rejects.toThrow('fx_snapshot_missing');
    expect(s.latest).not.toHaveBeenCalled();
  });

  it('uses integer HALF_UP at the duplicate-comparison half-won boundary', async () => {
    const s = subject(true, { ...snapshot, rate: '10.000000000000' });
    expect((await s.convert(event, 5)).amount).toBe(1);
  });

  it('does not fetch FX at all for KRW', async () => {
    const s = subject();
    expect(await s.convert({ ...event, currency: 'KRW' }, 123)).toMatchObject({ amount: 123, currency: 'KRW' });
    expect(s.find).not.toHaveBeenCalled();
    expect(s.latest).not.toHaveBeenCalled();
  });

  it('preserves the legacy mode path', async () => {
    const s = subject(false);
    expect((await s.convert()).amount).toBe(150_000);
    expect(s.find).not.toHaveBeenCalled();
    expect(s.latest).toHaveBeenCalledWith('USD');
  });
});
