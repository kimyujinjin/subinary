import type { TransactionFx } from '@family/contracts';
import { schema } from '@family/database';
import { deriveEcbCrossRate, parseFxRate } from '@family/transaction-domain';
import { sql } from 'drizzle-orm';

/** Never select operator identities or free-form notes for the public projection. */
export const transactionFxColumns = {
  id: schema.fxRateSnapshots.id,
  baseCurrency: schema.fxRateSnapshots.baseCurrency,
  quoteCurrency: schema.fxRateSnapshots.quoteCurrency,
  asOfDate: schema.fxRateSnapshots.asOfDate,
  rate: schema.fxRateSnapshots.rate,
  provider: schema.fxRateSnapshots.provider,
  providerVersion: schema.fxRateSnapshots.providerVersion,
  providerReference: schema.fxRateSnapshots.providerReference,
  moneyContractVersion: schema.fxRateSnapshots.moneyContractVersion,
  isManual: sql<boolean>`${schema.fxRateSnapshots.createdBy} is not null`,
};

export type TransactionFxSnapshot = Pick<schema.FxRateSnapshot, 'id' | 'baseCurrency' | 'quoteCurrency'
  | 'asOfDate' | 'rate' | 'provider' | 'providerVersion' | 'providerReference' | 'moneyContractVersion'>
  & { isManual: boolean };

const UNKNOWN: TransactionFx = { basis: 'unknown', asOfDate: null, source: null, rate: null, isReference: null };

function hasEcbDailyProvenance(snapshot: TransactionFxSnapshot): boolean {
  if (snapshot.provider !== 'ecb-reference-cross'
    || snapshot.providerVersion !== 'ecb-sdmx-daily-eur-cross-half-up-12-v1'
    || !snapshot.providerReference || snapshot.providerReference.length > 16_384) return false;
  try {
    const reference: unknown = JSON.parse(snapshot.providerReference);
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return false;
    const r = reference as Record<string, unknown>;
    const pair = snapshot.baseCurrency === 'EUR' ? 'KRW' : `${snapshot.baseCurrency}+KRW`;
    const expected = new URL(`https://data-api.ecb.europa.eu/service/data/EXR/D.${pair}.EUR.SP00.A`);
    expected.searchParams.set('startPeriod', snapshot.asOfDate);
    expected.searchParams.set('endPeriod', snapshot.asOfDate);
    expected.searchParams.set('format', 'csvdata');
    expected.searchParams.set('detail', 'full');
    return r.url === expected.toString() && r.asOfDate === snapshot.asOfDate
      && r.baseCurrency === snapshot.baseCurrency && r.quoteCurrency === 'KRW'
      && typeof r.basePerEur === 'string' && parseFxRate(r.basePerEur) !== null
      && typeof r.krwPerEur === 'string' && parseFxRate(r.krwPerEur) !== null
      && parseFxRate(deriveEcbCrossRate(r.krwPerEur, r.basePerEur)) === parseFxRate(snapshot.rate)
      && (snapshot.baseCurrency !== 'EUR' || parseFxRate(r.basePerEur) === parseFxRate('1'))
      && r.observationStatus === 'A' && r.unitMultiplier === 0 && r.rounding === 'HALF_UP' && r.scale === 12;
  } catch {
    return false;
  }
}

/** Only the immutable snapshot actually bound to this row supplies a date or source. */
export function transactionFx(
  transaction: Pick<schema.CardTransaction, 'originalCurrency' | 'moneyContractVersion' | 'fxRateSnapshotId'>,
  snapshot: TransactionFxSnapshot | null | undefined,
  masked: boolean,
): TransactionFx | null {
  if (masked || !transaction.originalCurrency || transaction.originalCurrency === 'KRW') return null;
  if (transaction.moneyContractVersion !== 2 || !snapshot || snapshot.id !== transaction.fxRateSnapshotId
    || snapshot.moneyContractVersion !== 2 || snapshot.baseCurrency !== transaction.originalCurrency
    || snapshot.quoteCurrency !== 'KRW' || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOfDate)
    || parseFxRate(snapshot.rate) === null) return { ...UNKNOWN };
  const common = { asOfDate: snapshot.asOfDate, rate: snapshot.rate };
  if (snapshot.isManual) return { ...common, basis: 'manual_reference', source: 'manual', isReference: null };
  if (hasEcbDailyProvenance(snapshot)) {
    return { ...common, basis: 'daily_reference', source: 'ecb', isReference: true };
  }
  return { ...common, basis: 'snapshot_reference', source: 'other', isReference: null };
}
