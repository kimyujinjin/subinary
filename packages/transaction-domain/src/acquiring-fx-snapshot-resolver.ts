import { MONEY_CONTRACT_VERSION_V2 } from '@family/database';

import type {
  FxSnapshotKey,
  FxSnapshotOrigin,
  FxSnapshotResolver,
} from './fx-snapshot-store.js';
import type {
  HistoricalFxProvider,
  HistoricalFxResult,
  HistoricalFxUnavailableReason,
} from './historical-fx-provider.js';
import type { FxSnapshotRef } from './plan.js';

/** The writer must preserve the first snapshot for a natural key. */
export interface FxSnapshotWritableStore extends FxSnapshotResolver {
  fixate(
    key: FxSnapshotKey,
    rate: string,
    origin: FxSnapshotOrigin,
  ): Promise<FxSnapshotRef | null>;
}

type NormalizedKey = Required<FxSnapshotKey>;

/** Invalid input is deliberately omitted rather than copied into diagnostics. */
export type FxSnapshotUnavailableNotice =
  | { readonly reason: 'invalid_key' }
  | (NormalizedKey & {
      readonly reason: HistoricalFxUnavailableReason | 'provider_failed' | 'snapshot_unavailable';
    });

export interface AcquiringFxSnapshotResolverOptions {
  reportUnavailable(notice: FxSnapshotUnavailableNotice): void;
}

function normalizeKey(input: FxSnapshotKey): NormalizedKey | null {
  if (!input || typeof input !== 'object') return null;
  const { baseCurrency, asOfDate } = input;
  const version = input.moneyContractVersion === undefined
    ? MONEY_CONTRACT_VERSION_V2
    : input.moneyContractVersion;
  if (typeof baseCurrency !== 'string' || typeof asOfDate !== 'string'
    || !Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) return null;

  const currency = baseCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return null;
  const date = new Date(`${asOfDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || asOfDate.startsWith('0000-')
    || date.toISOString().slice(0, 10) !== asOfDate) return null;

  return { baseCurrency: currency, asOfDate, moneyContractVersion: version };
}

/**
 * Existing snapshots always win, including operator-supplied snapshots written
 * while acquisition is in flight. Only a missing v2 key can contact a provider.
 * The map holds unfinished work only: absence is never cached between requests.
 */
export class AcquiringFxSnapshotResolver implements FxSnapshotResolver {
  private readonly inFlight = new Map<string, Promise<FxSnapshotRef | null>>();

  constructor(
    private readonly store: FxSnapshotWritableStore,
    private readonly provider: HistoricalFxProvider,
    private readonly options: AcquiringFxSnapshotResolverOptions,
  ) {
    if (!options || typeof options.reportUnavailable !== 'function') {
      throw new TypeError('reportUnavailable callback is required');
    }
  }

  async find(input: FxSnapshotKey): Promise<FxSnapshotRef | null> {
    const key = normalizeKey(input);
    if (!key) {
      this.options.reportUnavailable({ reason: 'invalid_key' });
      return null;
    }

    // Do this before joining an acquisition so a newly fixed manual snapshot is
    // visible immediately, even if the provider request has not finished yet.
    const existing = await this.store.find(key);
    if (existing) return existing;
    if (key.moneyContractVersion !== MONEY_CONTRACT_VERSION_V2) return null;

    const cacheKey = `${key.baseCurrency}|${key.asOfDate}|${key.moneyContractVersion}`;
    const active = this.inFlight.get(cacheKey);
    if (active) return active;

    const pending = this.acquire(key);
    this.inFlight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(cacheKey) === pending) this.inFlight.delete(cacheKey);
    }
  }

  findById(id: string): Promise<FxSnapshotRef | null> {
    return this.store.findById(id);
  }

  private async acquire(key: NormalizedKey): Promise<FxSnapshotRef | null> {
    let result: HistoricalFxResult;
    try {
      result = await this.provider.lookup(key.baseCurrency, key.asOfDate);
    } catch {
      // Provider exceptions can contain URLs, credentials or response bodies.
      // Store failures remain outside this catch and propagate to the caller.
      return this.afterProviderFailure(key, 'provider_failed');
    }
    if (result.status === 'unavailable') {
      return this.afterProviderFailure(key, result.reason);
    }

    // fixate() returns the winning row after ON CONFLICT DO NOTHING. Returning
    // that row, rather than constructing one from the provider response, keeps
    // concurrent external/manual inserts immutable and observable to callers.
    const fixed = await this.store.fixate(key, result.rate, result.origin);
    if (!fixed) this.options.reportUnavailable({ ...key, reason: 'snapshot_unavailable' });
    return fixed;
  }

  private async afterProviderFailure(
    key: NormalizedKey,
    reason: HistoricalFxUnavailableReason | 'provider_failed',
  ): Promise<FxSnapshotRef | null> {
    // Another process may have fixed this key while HTTP was in flight. Even a
    // failed provider response must not hide that winner. DB failures propagate.
    const existing = await this.store.find(key);
    if (existing) return existing;
    this.options.reportUnavailable({ ...key, reason });
    return null;
  }
}
