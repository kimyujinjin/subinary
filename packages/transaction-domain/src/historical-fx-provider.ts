/**
 * Exact-day ECB daily reference quotes. These are informational reference rates,
 * not transaction-time or card-settlement rates. Missing days stay unresolved.
 *
 * Official series/attributes:
 * https://www.ecb.europa.eu/stats/ecb_statistics/sdmx/html/tutorial.en.html
 * https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
 */
import type { FxSnapshotOrigin } from './fx-snapshot-store.js';
import { fxBaseDate } from './money-math.js';

export const ECB_HISTORICAL_FX_CURRENCIES = [
  'EUR', 'USD', 'JPY', 'GBP', 'CNY', 'HKD', 'AUD', 'CAD', 'SGD', 'CHF',
  'THB', 'PHP', 'MYR', 'NZD', 'IDR',
] as const;

export type HistoricalFxUnavailableReason =
  | 'unsupported_currency' | 'invalid_date' | 'future_date' | 'observation_missing'
  | 'network_error' | 'http_error' | 'response_invalid' | 'invalid_rate'
  | 'timeout' | 'response_too_large' | 'request_limit';

export type HistoricalFxResult =
  | { readonly status: 'available'; readonly rate: string; readonly origin: FxSnapshotOrigin }
  | { readonly status: 'unavailable'; readonly reason: HistoricalFxUnavailableReason };

export interface HistoricalFxProvider {
  lookup(baseCurrency: string, asOfDate: string): Promise<HistoricalFxResult>;
}

export interface EcbHistoricalFxProviderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  /** Tests may shorten the deadline. Production never permits more than 5s. */
  readonly timeoutMs?: number;
}

const SUPPORTED = new Set<string>(ECB_HISTORICAL_FX_CURRENCIES);
const API = 'https://data-api.ecb.europa.eu/service/data/EXR/';
const MAX_BYTES = 256 * 1024;
const MAX_CACHE = 128;
const SUCCESS_CACHE_MS = 6 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 5000;
const MAX_ACTIVE = 2;
const MAX_WAITING = 16;
const REQUIRED_COLUMNS = [
  'FREQ', 'CURRENCY', 'CURRENCY_DENOM', 'EXR_TYPE', 'EXR_SUFFIX',
  'TIME_PERIOD', 'OBS_VALUE', 'OBS_STATUS', 'UNIT', 'UNIT_MULT',
];

class ProviderFailure extends Error {
  constructor(readonly reason: HistoricalFxUnavailableReason) {
    super(`historical_fx_${reason}`);
  }
}

function unavailable(reason: HistoricalFxUnavailableReason): HistoricalFxResult {
  return { status: 'unavailable', reason };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decimal(value: string): { units: bigint; places: number } {
  if (value.length > 80 || !/^\d+(?:\.\d+)?$/.test(value)) throw new ProviderFailure('invalid_rate');
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole + fraction);
  if (units <= 0n) throw new ProviderFailure('invalid_rate');
  return { units, places: fraction.length };
}

/** KRW/EUR divided by base/EUR; no floating point before numeric(24,12) storage. */
export function deriveEcbCrossRate(krwPerEur: string, basePerEur: string): string {
  const krw = decimal(krwPerEur);
  const base = decimal(basePerEur);
  const numerator = krw.units * (10n ** BigInt(base.places + 12));
  const denominator = base.units * (10n ** BigInt(krw.places));
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const scaled = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  // Check after rounding, including carry into the forbidden thirteenth integer digit.
  if (scaled <= 0n || scaled >= 10n ** 24n) throw new ProviderFailure('invalid_rate');
  const digits = scaled.toString().padStart(13, '0');
  return `${digits.slice(0, -12)}.${digits.slice(-12)}`;
}

/** Small RFC-4180 reader with strict quote placement and bounded rows/columns. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  const pushField = () => {
    row.push(field); field = ''; closedQuote = false;
    if (row.length > 64) throw new ProviderFailure('response_invalid');
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
    if (rows.length > 16) throw new ProviderFailure('response_invalid');
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (field !== '' || closedQuote) throw new ProviderFailure('response_invalid');
      quoted = true;
    } else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      pushRow();
    } else {
      if (closedQuote) throw new ProviderFailure('response_invalid');
      field += char;
    }
  }
  if (quoted) throw new ProviderFailure('response_invalid');
  if (field !== '' || closedQuote || row.length !== 0) pushRow();
  return rows;
}

function parseQuotes(text: string, currency: string, date: string): Map<string, string> {
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  if (rows.length === 0) throw new ProviderFailure('observation_missing');
  const header = rows.shift()!;
  if (new Set(header).size !== header.length || REQUIRED_COLUMNS.some((name) => !header.includes(name))) {
    throw new ProviderFailure('response_invalid');
  }
  const wanted = new Set(currency === 'EUR' ? ['KRW'] : ['KRW', currency]);
  const quotes = new Map<string, string>();
  for (const row of rows) {
    if (row.length !== header.length) throw new ProviderFailure('response_invalid');
    const value = (name: string) => row[header.indexOf(name)];
    const code = value('CURRENCY');
    if (value('FREQ') !== 'D' || value('CURRENCY_DENOM') !== 'EUR'
        || value('EXR_TYPE') !== 'SP00' || value('EXR_SUFFIX') !== 'A'
        || value('TIME_PERIOD') !== date || !wanted.has(code) || quotes.has(code)
        || value('OBS_STATUS') !== 'A' || value('UNIT_MULT') !== '0'
        || value('UNIT') !== code) throw new ProviderFailure('response_invalid');
    // DECIMALS is display metadata, not a license to truncate the source value.
    if (header.includes('DECIMALS') && (!/^\d{1,2}$/.test(value('DECIMALS'))
        || Number(value('DECIMALS')) > 18)) throw new ProviderFailure('response_invalid');
    const quote = value('OBS_VALUE');
    if (quote === '' || quote === '.') throw new ProviderFailure('observation_missing');
    decimal(quote);
    quotes.set(code, quote);
  }
  if ([...wanted].some((code) => !quotes.has(code))) throw new ProviderFailure('observation_missing');
  return quotes;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProviderFailure('timeout'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ProviderFailure('timeout'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function limitedText(response: Response, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && BigInt(declared) > BigInt(MAX_BYTES)) {
    void response.body?.cancel().catch(() => undefined);
    throw new ProviderFailure('response_too_large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new ProviderFailure('response_too_large');
      try { text += decoder.decode(chunk.value, { stream: true }); }
      catch { throw new ProviderFailure('response_invalid'); }
    }
    try { return text + decoder.decode(); }
    catch { throw new ProviderFailure('response_invalid'); }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

function copyResult(result: HistoricalFxResult): HistoricalFxResult {
  return result.status === 'available'
    ? { ...result, origin: { ...result.origin, fetchedAt: new Date(result.origin.fetchedAt.getTime()) } }
    : { ...result };
}

interface Waiter { readonly grant: () => void; readonly cancel: () => void }

export class EcbHistoricalFxProvider implements HistoricalFxProvider {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, { until: number; result: HistoricalFxResult }>();
  private readonly inflight = new Map<string, Promise<HistoricalFxResult>>();
  private readonly waiting: Waiter[] = [];
  private active = 0;

  constructor(options: EcbHistoricalFxProviderOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 5000) {
      throw new Error('historical_fx_invalid_timeout');
    }
  }

  async lookup(baseCurrency: string, asOfDate: string): Promise<HistoricalFxResult> {
    const currency = baseCurrency.toUpperCase();
    if (!SUPPORTED.has(currency)) return unavailable('unsupported_currency');
    if (!validDate(asOfDate)) return unavailable('invalid_date');
    const now = this.now();
    if (!Number.isFinite(now.getTime())) return unavailable('invalid_date');
    if (asOfDate > fxBaseDate(now, now)) return unavailable('future_date');
    const key = `${currency}|${asOfDate}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > now.getTime()) return copyResult(cached.result);
    if (cached) this.cache.delete(key);
    const running = this.inflight.get(key);
    if (running) return copyResult(await running);
    if (this.inflight.size >= MAX_ACTIVE + MAX_WAITING) return unavailable('request_limit');
    const promise = this.request(currency, asOfDate);
    this.inflight.set(key, promise);
    try {
      const result = await promise;
      const ttl = result.status === 'available' ? SUCCESS_CACHE_MS : FAILURE_CACHE_MS;
      this.cache.delete(key);
      this.cache.set(key, { until: this.now().getTime() + ttl, result: copyResult(result) });
      while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
      return copyResult(result);
    } finally { this.inflight.delete(key); }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (this.active < MAX_ACTIVE) { this.active += 1; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => { signal.removeEventListener('abort', waiter.cancel); resolve(); },
        cancel: () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new ProviderFailure('timeout'));
        },
      };
      this.waiting.push(waiter);
      signal.addEventListener('abort', waiter.cancel, { once: true });
      if (signal.aborted) waiter.cancel();
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next.grant(); // Reserved slot transfers to this waiter; active is unchanged.
    else this.active -= 1;
  }

  private async request(currency: string, date: string): Promise<HistoricalFxResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let acquired = false;
    try {
      await this.acquire(controller.signal);
      acquired = true;
      const pair = currency === 'EUR' ? 'KRW' : `${currency}+KRW`;
      const url = new URL(`${API}D.${pair}.EUR.SP00.A`);
      url.searchParams.set('startPeriod', date);
      url.searchParams.set('endPeriod', date);
      url.searchParams.set('format', 'csvdata');
      url.searchParams.set('detail', 'full');
      const response = await abortable(this.fetcher(url, {
        headers: { accept: 'text/csv' }, redirect: 'error', signal: controller.signal,
      }), controller.signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return unavailable(response.status === 404 ? 'observation_missing' : 'http_error');
      }
      const quotes = parseQuotes(await limitedText(response, controller.signal), currency, date);
      const baseQuote = currency === 'EUR' ? '1' : quotes.get(currency)!;
      const krwQuote = quotes.get('KRW')!;
      const rate = deriveEcbCrossRate(krwQuote, baseQuote);
      const fetchedAt = new Date(this.now().getTime());
      if (!Number.isFinite(fetchedAt.getTime())) throw new ProviderFailure('response_invalid');
      return {
        status: 'available', rate,
        origin: {
          provider: 'ecb-reference-cross', providerVersion: 'ecb-sdmx-daily-eur-cross-half-up-12-v1',
          providerReference: JSON.stringify({ url: url.toString(), asOfDate: date,
            baseCurrency: currency, quoteCurrency: 'KRW', basePerEur: baseQuote, krwPerEur: krwQuote,
            observationStatus: 'A', unitMultiplier: 0, rounding: 'HALF_UP', scale: 12 }),
          note: 'ECB daily informational reference cross rate; not a transaction-time or card-settlement rate. Exact observation date only.',
          fetchedAt,
        },
      };
    } catch (error) {
      return unavailable(error instanceof ProviderFailure ? error.reason
        : controller.signal.aborted ? 'timeout' : 'network_error');
    } finally {
      clearTimeout(timer);
      if (acquired) this.release();
    }
  }
}
