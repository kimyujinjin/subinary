import { describe, expect, it, vi } from 'vitest';

import {
  AcquiringFxSnapshotResolver,
  type FxSnapshotWritableStore,
} from './acquiring-fx-snapshot-resolver.js';
import type { FxSnapshotKey, FxSnapshotOrigin } from './fx-snapshot-store.js';
import type { HistoricalFxResult } from './historical-fx-provider.js';
import type { FxSnapshotRef } from './plan.js';

const KEY: FxSnapshotKey = { baseCurrency: 'USD', asOfDate: '2026-10-22', moneyContractVersion: 2 };
const ORIGIN: FxSnapshotOrigin = {
  provider: 'synthetic-provider',
  providerVersion: 'test-v1',
  providerReference: 'https://example.invalid/historical-rate',
  fetchedAt: new Date('2026-10-23T00:00:00Z'),
};
const AVAILABLE: HistoricalFxResult = { status: 'available', rate: '1300.000000000000', origin: ORIGIN };

function naturalKey(key: FxSnapshotKey): string {
  return `${key.baseCurrency.toUpperCase()}|${key.asOfDate}|${key.moneyContractVersion ?? 2}`;
}

function row(key: FxSnapshotKey = KEY, overrides: Partial<FxSnapshotRef> = {}): FxSnapshotRef {
  return {
    id: `snapshot-${naturalKey(key)}`,
    baseCurrency: key.baseCurrency.toUpperCase(),
    asOfDate: key.asOfDate,
    rate: '1300.000000000000',
    moneyContractVersion: key.moneyContractVersion ?? 2,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function harness() {
  const rows = new Map<string, FxSnapshotRef>();
  const store = {
    find: vi.fn(async (key: FxSnapshotKey) => rows.get(naturalKey(key)) ?? null),
    findById: vi.fn(async (id: string) => [...rows.values()].find((item) => item.id === id) ?? null),
    fixate: vi.fn(async (key: FxSnapshotKey, rate: string, _origin: FxSnapshotOrigin): Promise<FxSnapshotRef | null> => {
      const found = rows.get(naturalKey(key));
      if (found) return found;
      const fixed = row(key, { rate });
      rows.set(naturalKey(key), fixed);
      return fixed;
    }),
  } satisfies FxSnapshotWritableStore;
  const provider = { lookup: vi.fn(async (_currency: string, _date: string): Promise<HistoricalFxResult> => AVAILABLE) };
  const reportUnavailable = vi.fn();
  const resolver = new AcquiringFxSnapshotResolver(store, provider, { reportUnavailable });
  return { resolver, store, provider, rows, reportUnavailable };
}

describe('AcquiringFxSnapshotResolver', () => {
  it('returns an existing operator snapshot without a provider request or write', async () => {
    const h = harness();
    const manual = row(KEY, { id: 'operator-snapshot', rate: '1350.000000000000' });
    h.rows.set(naturalKey(KEY), manual);

    expect(await h.resolver.find(KEY)).toBe(manual);
    expect(h.provider.lookup).not.toHaveBeenCalled();
    expect(h.store.fixate).not.toHaveBeenCalled();
    expect(h.reportUnavailable).not.toHaveBeenCalled();
  });

  it('normalizes a valid key and persists the rate with its provenance', async () => {
    const h = harness();
    const result = await h.resolver.find({ baseCurrency: ' usd ', asOfDate: KEY.asOfDate });

    expect(h.store.find).toHaveBeenCalledWith(KEY);
    expect(h.provider.lookup).toHaveBeenCalledWith('USD', KEY.asOfDate);
    expect(h.store.fixate).toHaveBeenCalledWith(KEY, '1300.000000000000', ORIGIN);
    expect(result).toBe(h.rows.get(naturalKey(KEY)));
  });

  it('deduplicates concurrent acquisition while every caller checks the store first', async () => {
    const h = harness();
    const started = deferred<void>();
    const fetched = deferred<HistoricalFxResult>();
    h.provider.lookup.mockImplementation(async () => {
      started.resolve();
      return fetched.promise;
    });
    const first = h.resolver.find(KEY);
    const second = h.resolver.find({ ...KEY, baseCurrency: 'usd' });
    await started.promise;

    expect(h.store.find).toHaveBeenCalledTimes(2);
    expect(h.provider.lookup).toHaveBeenCalledTimes(1);
    fetched.resolve(AVAILABLE);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(h.store.fixate).toHaveBeenCalledTimes(1);
  });

  it('keeps different currency/date keys independent', async () => {
    const h = harness();
    const keys = [KEY, { ...KEY, baseCurrency: 'EUR' }, { ...KEY, asOfDate: '2026-10-23' }];

    const snapshots = await Promise.all(keys.map((key) => h.resolver.find(key)));

    expect(new Set(snapshots.map((snapshot) => snapshot?.id)).size).toBe(3);
    expect(h.provider.lookup).toHaveBeenCalledTimes(3);
    expect(h.store.fixate).toHaveBeenCalledTimes(3);
  });

  it('findById only reads the existing store and never acquires', async () => {
    const h = harness();
    expect(await h.resolver.findById('missing-snapshot')).toBeNull();
    const manual = row();
    h.rows.set(naturalKey(KEY), manual);
    expect(await h.resolver.findById(manual.id)).toBe(manual);
    expect(h.store.findById).toHaveBeenCalledTimes(2);
    expect(h.provider.lookup).not.toHaveBeenCalled();
    expect(h.store.fixate).not.toHaveBeenCalled();
  });

  it.each([1, 3])('never acquires a missing contract version %s', async (version) => {
    const h = harness();
    const key = { ...KEY, moneyContractVersion: version };

    expect(await h.resolver.find(key)).toBeNull();
    expect(h.store.find).toHaveBeenCalledWith(key);
    expect(h.provider.lookup).not.toHaveBeenCalled();
    expect(h.store.fixate).not.toHaveBeenCalled();
  });

  it('still returns existing snapshots for another contract version', async () => {
    const h = harness();
    const key = { ...KEY, moneyContractVersion: 1 };
    const existing = row(key);
    h.rows.set(naturalKey(key), existing);

    expect(await h.resolver.find(key)).toBe(existing);
    expect(h.provider.lookup).not.toHaveBeenCalled();
  });

  it('reports a provider exception without exposing exception contents', async () => {
    const h = harness();
    h.provider.lookup.mockRejectedValueOnce(new Error('synthetic-sensitive-provider-response'));

    expect(await h.resolver.find(KEY)).toBeNull();
    expect(h.reportUnavailable).toHaveBeenCalledExactlyOnceWith({ ...KEY, reason: 'provider_failed' });
    expect(h.store.fixate).not.toHaveBeenCalled();
  });

  it('reports a typed provider failure and can retry the same key', async () => {
    const h = harness();
    h.provider.lookup.mockResolvedValueOnce({ status: 'unavailable', reason: 'network_error' });

    expect(await h.resolver.find(KEY)).toBeNull();
    expect(h.reportUnavailable).toHaveBeenCalledExactlyOnceWith({ ...KEY, reason: 'network_error' });
    expect(h.store.fixate).not.toHaveBeenCalled();
    expect(await h.resolver.find(KEY)).not.toBeNull();
    expect(h.provider.lookup).toHaveBeenCalledTimes(2);
  });

  it('retries after a provider exception rather than retaining a negative cache', async () => {
    const h = harness();
    h.provider.lookup.mockRejectedValueOnce(new Error('synthetic-network-failure'));
    expect(await h.resolver.find(KEY)).toBeNull();

    expect(await h.resolver.find(KEY)).not.toBeNull();
    expect(h.provider.lookup).toHaveBeenCalledTimes(2);
    expect(h.store.fixate).toHaveBeenCalledTimes(1);
  });

  it('sees a manual snapshot immediately after a failed acquisition', async () => {
    const h = harness();
    h.provider.lookup.mockResolvedValueOnce({ status: 'unavailable', reason: 'observation_missing' });
    expect(await h.resolver.find(KEY)).toBeNull();
    const manual = row(KEY, { id: 'manual-after-failure', rate: '1350.000000000000' });
    h.rows.set(naturalKey(KEY), manual);

    expect(await h.resolver.find(KEY)).toBe(manual);
    expect(h.provider.lookup).toHaveBeenCalledTimes(1);
    expect(h.store.fixate).not.toHaveBeenCalled();
  });

  it('reports a null fixation result without claiming acquisition succeeded or caching it', async () => {
    const h = harness();
    h.store.fixate.mockResolvedValueOnce(null);

    expect(await h.resolver.find(KEY)).toBeNull();
    expect(h.rows.size).toBe(0);
    expect(h.reportUnavailable).toHaveBeenCalledExactlyOnceWith({ ...KEY, reason: 'snapshot_unavailable' });
    expect(await h.resolver.find(KEY)).not.toBeNull();
    expect(h.provider.lookup).toHaveBeenCalledTimes(2);
  });

  it('propagates a reporting failure and clears the unfinished acquisition', async () => {
    const h = harness();
    const failure = new Error('synthetic-reporting-failure');
    h.provider.lookup.mockResolvedValueOnce({ status: 'unavailable', reason: 'network_error' });
    h.reportUnavailable.mockImplementationOnce(() => { throw failure; });

    await expect(h.resolver.find(KEY)).rejects.toBe(failure);
    expect(h.store.fixate).not.toHaveBeenCalled();
    expect(await h.resolver.find(KEY)).not.toBeNull();
  });

  it('preserves an external first writer while provider acquisition is in flight', async () => {
    const h = harness();
    const started = deferred<void>();
    const fetched = deferred<HistoricalFxResult>();
    h.provider.lookup.mockImplementation(async () => { started.resolve(); return fetched.promise; });
    const first = h.resolver.find(KEY);
    await started.promise;
    const manual = row(KEY, { id: 'concurrent-manual-snapshot', rate: '1350.000000000000' });
    h.rows.set(naturalKey(KEY), manual);

    // A second caller need not wait for the HTTP request to finish.
    expect(await h.resolver.find(KEY)).toBe(manual);
    fetched.resolve(AVAILABLE);
    expect(await first).toBe(manual);
    expect(h.rows.get(naturalKey(KEY))).toBe(manual);
    expect(h.provider.lookup).toHaveBeenCalledTimes(1);
    expect(h.store.fixate).toHaveBeenCalledTimes(1);
  });

  it('propagates store read failures without misreporting them as provider failures', async () => {
    const h = harness();
    const failure = new Error('synthetic-store-read-failure');
    h.store.find.mockRejectedValueOnce(failure);

    await expect(h.resolver.find(KEY)).rejects.toBe(failure);
    expect(h.provider.lookup).not.toHaveBeenCalled();
    expect(h.reportUnavailable).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'exception'] as const)(
    'returns a concurrent stored winner when the in-flight provider ends with %s', async (failureMode) => {
      const h = harness();
      const started = deferred<void>();
      const fetched = deferred<HistoricalFxResult>();
      h.provider.lookup.mockImplementation(async () => {
        started.resolve();
        const result = await fetched.promise;
        if (failureMode === 'exception') throw new Error('synthetic-provider-error');
        return result;
      });
      const first = h.resolver.find(KEY);
      await started.promise;
      const manual = row(KEY, { id: 'winner-during-provider-failure', rate: '1350.000000000000' });
      h.rows.set(naturalKey(KEY), manual);
      fetched.resolve({ status: 'unavailable', reason: 'network_error' });

      expect(await first).toBe(manual);
      expect(h.store.find).toHaveBeenCalledTimes(2);
      expect(h.store.fixate).not.toHaveBeenCalled();
      expect(h.reportUnavailable).not.toHaveBeenCalled();
    },
  );

  it.each(['unavailable', 'exception'] as const)(
    'propagates a final store read failure after provider %s', async (failureMode) => {
      const h = harness();
      const failure = new Error('synthetic-final-store-read-failure');
      h.store.find.mockResolvedValueOnce(null).mockRejectedValueOnce(failure);
      if (failureMode === 'exception') h.provider.lookup.mockRejectedValueOnce(new Error('synthetic-provider-error'));
      else h.provider.lookup.mockResolvedValueOnce({ status: 'unavailable', reason: 'network_error' });

      await expect(h.resolver.find(KEY)).rejects.toBe(failure);
      expect(h.store.find).toHaveBeenCalledTimes(2);
      expect(h.store.fixate).not.toHaveBeenCalled();
      expect(h.reportUnavailable).not.toHaveBeenCalled();
      expect(await h.resolver.find(KEY)).not.toBeNull();
    },
  );

  it('propagates fixate failures and clears the unfinished acquisition', async () => {
    const h = harness();
    const failure = new Error('synthetic-store-write-failure');
    h.store.fixate.mockRejectedValueOnce(failure);

    await expect(h.resolver.find(KEY)).rejects.toBe(failure);
    expect(h.reportUnavailable).not.toHaveBeenCalled();
    expect(await h.resolver.find(KEY)).not.toBeNull();
    expect(h.provider.lookup).toHaveBeenCalledTimes(2);
  });

  it('propagates findById failures without a provider fallback', async () => {
    const h = harness();
    const failure = new Error('synthetic-store-read-failure');
    h.store.findById.mockRejectedValueOnce(failure);

    await expect(h.resolver.findById('snapshot')).rejects.toBe(failure);
    expect(h.provider.lookup).not.toHaveBeenCalled();
    expect(h.reportUnavailable).not.toHaveBeenCalled();
  });

  it.each([
    { ...KEY, baseCurrency: 'USD-invalid-input' },
    { ...KEY, asOfDate: '2026-02-30' },
    { ...KEY, asOfDate: '2026-13-01' },
    { ...KEY, asOfDate: '2026-10-22T00:00:00Z' },
    { ...KEY, asOfDate: '0000-01-01' },
    { ...KEY, moneyContractVersion: 0 },
    { ...KEY, moneyContractVersion: 1.5 },
    { ...KEY, moneyContractVersion: 2_147_483_648 },
    { ...KEY, moneyContractVersion: null },
  ])('rejects malformed input without querying or including it in diagnostics: %j', async (key) => {
    const h = harness();

    expect(await h.resolver.find(key as FxSnapshotKey)).toBeNull();
    expect(h.reportUnavailable).toHaveBeenCalledExactlyOnceWith({ reason: 'invalid_key' });
    expect(h.store.find).not.toHaveBeenCalled();
    expect(h.provider.lookup).not.toHaveBeenCalled();
    expect(h.store.fixate).not.toHaveBeenCalled();
  });
});
