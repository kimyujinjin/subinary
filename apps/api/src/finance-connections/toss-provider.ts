/**
 * Stateless, bounded adapter for the official Toss Securities OpenAPI 1.2.28.
 * No trading routes, retries, token cache, credentials retained on the client,
 * or financial-data logging. The service owns consent, membership, account
 * selection, durable token issuance authority, and encrypted persistence.
 */
const ORIGIN = 'https://openapi.tossinvest.com';
const MAX_BYTES = 1_048_576;
const MAX_ROWS = 10_000;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const LAST_RETRY_INSTANT = Date.parse('9999-12-31T23:59:59.999Z');

/** RFC 9110 §10.2.3: delay-seconds or HTTP-date, never reflect the raw header. */
function retryAfterSeconds(raw: string | null, now: number): number | null {
  if (raw === null) return null;
  const value = raw.trim();
  const remaining = Math.max(0, Math.ceil((LAST_RETRY_INSTANT - now) / 1_000));
  if (/^\d+$/.test(value)) {
    const digits = value.replace(/^0+/, '') || '0';
    // No RFC upper bound exists. Do not silently shorten a huge wait to 60s/1d.
    return digits.length > 12 ? remaining : Math.min(Number(digits), remaining);
  }
  if (value.length > 128) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const imf = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  const old = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  const asc = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) ( \d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(value);
  const parts = imf ?? old ?? (asc ? [asc[0], asc[2], asc[1], asc[6], asc[3], asc[4], asc[5]] : null);
  if (!parts) return null;
  const day = Number(parts[1]), month = months.indexOf(parts[2]!), hour = Number(parts[4]), minute = Number(parts[5]), second = Number(parts[6]);
  let year = Number(parts[3]);
  if (old) year += Math.floor(new Date(now).getUTCFullYear() / 100) * 100;
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  const build = (y: number) => {
    const date = new Date(0); date.setUTCFullYear(y, month, day); date.setUTCHours(hour, minute, Math.min(second, 59), 0); return date;
  };
  let date = build(year);
  if (old) {
    const cutoff = new Date(now); cutoff.setUTCFullYear(cutoff.getUTCFullYear() + 50);
    if (date.getTime() > cutoff.getTime()) { year -= 100; date = build(year); }
  }
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  // Leap-second notation cannot make the wait shorter than the represented date.
  const target = Math.min(LAST_RETRY_INSTANT, date.getTime() + (second === 60 ? 1_000 : 0));
  return Math.max(0, Math.ceil((target - now) / 1_000));
}

export type ProviderErrorCode = 'provider_unavailable' | 'provider_denied' | 'token_expired'
  | 'rate_limited' | 'invalid_response' | 'token_uncertain';

/** Only allowlisted metadata. Never attach the upstream exception or body. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
    readonly issuanceUncertain = false,
  ) {
    super(`Toss provider: ${code}`);
    this.name = 'ProviderError';
  }
}

export interface TossAccount {
  /** Exact int64 as text; keep inside the service's encrypted account choices. */
  accountKey: string;
  /** Unknown future enum values are preserved, never treated as BROKERAGE. */
  type: string;
  label: string;
  last4: string | null;
}
export interface TossHolding {
  symbol: string;
  name: string;
  currency: 'KRW' | 'USD';
  quantity: string;
  marketValue: string;
  afterCostValue: string;
}
export interface TossHoldings {
  totals: Array<{ currency: 'KRW' | 'USD'; marketValue: string; afterCostValue: string }>;
  items: TossHolding[];
  /** Time this app observed the response, not a bank valuation timestamp. */
  observedAt: string;
  valuationAt: null;
}
export interface TossProviderOptions {
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
}

type ObjectValue = Record<string, unknown>;
type Price = { krw: string; usd: string | null };
const invalid = (): never => { throw new ProviderError('invalid_response'); };
function object(value: unknown): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as ObjectValue;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > max
    || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value;
}
function decimal(value: unknown): string {
  if (typeof value !== 'string' || value.length > 30 || !DECIMAL.test(value)) return invalid();
  return value; // Never convert financial decimals to IEEE-754 Number.
}
function fields(value: unknown, keys: string[]): void {
  const source = object(value);
  for (const key of keys) decimal(source[key]);
}
function price(value: unknown): Price {
  const source = object(value);
  return { krw: decimal(source.krw), usd: source.usd == null ? null : decimal(source.usd) };
}
function accountKey(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return invalid();
    value = String(value);
  }
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)
    || BigInt(value) > 9_223_372_036_854_775_807n) return invalid();
  return value;
}
function secret(value: unknown, max: number): string {
  const result = text(value, max);
  if (/\s/.test(result)) return invalid();
  return result;
}

/**
 * Preserve numeric accountSeq lexemes before JSON.parse can round int64s.
 * Scan quoted strings, never replace their contents. All other syntax is left
 * to JSON.parse, including malformed numeric literals (e.g. a leading zero).
 * This works on supported Node versions without JSON.parse source-context.
 */
function providerJson(raw: string): unknown {
  try {
    let output = '', copiedUntil = 0;
    for (let index = 0; index < raw.length; index++) {
      if (raw[index] !== '"') continue;
      const start = index;
      index++;
      for (; index < raw.length; index++) {
        if (raw[index] === '\\') { index++; continue; }
        if (raw[index] === '"') break;
      }
      if (index >= raw.length) return invalid();
      const quoted = raw.slice(start, index + 1);
      if (JSON.parse(quoted) !== 'accountSeq') continue;
      let next = index + 1;
      while (/\s/.test(raw[next] ?? '') && next < raw.length) next++;
      if (raw[next] !== ':') continue;
      next++;
      while (/\s/.test(raw[next] ?? '') && next < raw.length) next++;
      const numberStart = next;
      if (!/[0-9-]/.test(raw[next] ?? '')) continue;
      while (next < raw.length && !/[\s,}\]]/.test(raw[next]!)) next++;
      const lexeme = raw.slice(numberStart, next);
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(lexeme)) continue;
      output += raw.slice(copiedUntil, numberStart) + JSON.stringify(lexeme);
      copiedUntil = next;
      index = next - 1;
    }
    return JSON.parse(output + raw.slice(copiedUntil));
  } catch { return invalid(); }
}

function parseAccounts(value: unknown): TossAccount[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) return invalid();
  const seen = new Set<string>();
  return value.map(raw => {
    const row = object(raw);
    const fullAccount = text(row.accountNo, 128);
    const key = accountKey(row.accountSeq);
    if (seen.has(key)) return invalid();
    seen.add(key);
    const type = text(row.accountType, 64);
    const last4 = /([0-9]{4})$/.exec(fullAccount)?.[1] ?? null;
    // Full accountNo is deliberately absent from the returned representation.
    return { accountKey: key, type, last4,
      label: `${type === 'BROKERAGE' ? '종합매매 계좌' : '지원하지 않는 계좌'}${last4 ? ` · ${last4}` : ''}` };
  });
}

function parseHoldings(value: unknown, observedAt: string): TossHoldings {
  const source = object(value);
  const market = object(source.marketValue);
  const marketAmount = price(market.amount), afterCost = price(market.amountAfterCost);
  // Validate the contracted financial response before retaining its narrow view.
  price(source.totalPurchaseAmount);
  const profit = object(source.profitLoss), daily = object(source.dailyProfitLoss);
  price(profit.amount); price(profit.amountAfterCost);
  decimal(profit.rate); decimal(profit.rateAfterCost);
  price(daily.amount); decimal(daily.rate);
  if (!Array.isArray(source.items) || source.items.length > MAX_ROWS) return invalid();
  const seen = new Set<string>();
  const items = source.items.map((raw): TossHolding => {
    const item = object(raw), symbol = text(item.symbol, 128), name = text(item.name, 512);
    const marketCountry = text(item.marketCountry, 32), currency = text(item.currency, 32);
    // Unknown coverage must fail closed, never silently turn into KRW or USD.
    if (!((marketCountry === 'KR' && currency === 'KRW') || (marketCountry === 'US' && currency === 'USD'))) return invalid();
    const identity = JSON.stringify([marketCountry, currency, symbol]);
    if (seen.has(identity)) return invalid();
    seen.add(identity);
    fields(item, ['quantity', 'lastPrice', 'averagePurchasePrice']);
    const value = object(item.marketValue), cost = object(item.cost);
    fields(value, ['purchaseAmount', 'amount', 'amountAfterCost']);
    fields(item.profitLoss, ['amount', 'amountAfterCost', 'rate', 'rateAfterCost']);
    fields(item.dailyProfitLoss, ['amount', 'rate']);
    decimal(cost.commission);
    if (cost.tax != null) decimal(cost.tax);
    return { symbol, name, currency: currency as 'KRW' | 'USD', quantity: decimal(item.quantity),
      marketValue: decimal(value.amount), afterCostValue: decimal(value.amountAfterCost) };
  });
  if ((marketAmount.usd === null) !== (afterCost.usd === null)
    || (items.some(item => item.currency === 'USD') && marketAmount.usd === null)) return invalid();
  const totals: TossHoldings['totals'] = [
    { currency: 'KRW', marketValue: marketAmount.krw, afterCostValue: afterCost.krw },
  ];
  // Null/absent USD means no USD total. Never fabricate an observed zero value.
  if (marketAmount.usd !== null && afterCost.usd !== null) {
    totals.push({ currency: 'USD', marketValue: marketAmount.usd, afterCostValue: afterCost.usd });
  }
  return { totals, items, observedAt, valuationAt: null };
}

/** Register with Nest using a factory; options are test dependencies, not secrets. */
export class TossProviderClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(options: TossProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (typeof this.fetchImpl !== 'function' || typeof this.now !== 'function'
      || !Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) invalid();
  }

  private async request(path: '/oauth2/token' | '/api/v1/accounts' | '/api/v1/holdings', init: RequestInit): Promise<unknown> {
    const isToken = path === '/oauth2/token';
    if (!((isToken && init.method === 'POST')
      || ((path === '/api/v1/accounts' || path === '/api/v1/holdings') && init.method === 'GET'))) invalid();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const requestInit: RequestInit & { readonly cache: 'no-store' } = {
        ...init, redirect: 'error', cache: 'no-store', signal: controller.signal,
      };
      const response = await this.fetchImpl(ORIGIN + path, requestInit);
      // Defense in depth for alternate fetch transports; native fetch rejects redirects.
      if (response.redirected || (response.url && response.url !== ORIGIN + path)) {
        await response.body?.cancel().catch(() => {});
        invalid();
      }
      if (!response.ok) {
        const retry = retryAfterSeconds(response.headers.get('retry-after'), this.now());
        const code: ProviderErrorCode = response.status === 401 ? 'token_expired'
          : response.status === 429 ? 'rate_limited'
            : [400, 403].includes(response.status) ? 'provider_denied' : 'provider_unavailable';
        // Error responses can echo secrets. Never consume their body, even as JSON.
        await response.body?.cancel().catch(() => {});
        throw new ProviderError(code, response.status, retry,
          isToken && ![400, 401, 403, 404, 429].includes(response.status));
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel().catch(() => {});
        invalid();
      }
      const declaredLength = response.headers.get('content-length');
      if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BYTES) {
        await response.body?.cancel().catch(() => {});
        invalid();
      }
      const reader = response.body?.getReader();
      if (!reader) return invalid();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let size = 0, raw = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) invalid();
          try { raw += decoder.decode(value, { stream: true }); } catch { invalid(); }
        }
        try { raw += decoder.decode(); } catch { invalid(); }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return providerJson(raw);
    } catch (error) {
      if (error instanceof ProviderError) {
        if (isToken && error.status === null && !error.issuanceUncertain) {
          throw new ProviderError(error.code, null, error.retryAfterSeconds, true);
        }
        throw error;
      }
      // Both timeout and transport failure are uncertain after token submission.
      throw new ProviderError('provider_unavailable', null, null, isToken);
    } finally { clearTimeout(timer); }
  }

  async issueToken(clientId: string, clientSecret: string): Promise<{ accessToken: string; expiresAt: Date }> {
    secret(clientId, 512); secret(clientSecret, 4096);
    const startedAt = this.now();
    const raw = await this.request('/oauth2/token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    });
    try {
      const result = object(raw);
      const accessToken = secret(result.access_token, 32_768), expiresIn = result.expires_in;
      if (result.token_type !== 'Bearer' || typeof expiresIn !== 'number' || !Number.isSafeInteger(expiresIn)
        || expiresIn < 1 || expiresIn > 31_536_000) return invalid();
      const expiresAt = new Date(startedAt + expiresIn * 1000);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= this.now()) invalid();
      return { accessToken, expiresAt };
    } catch {
      // A malformed success can still mean the provider issued a real token.
      throw new ProviderError('invalid_response', null, null, true);
    }
  }

  private async get(path: '/api/v1/accounts' | '/api/v1/holdings', token: string, selected?: string): Promise<unknown> {
    secret(token, 32_768);
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    if (selected !== undefined) headers['X-Tossinvest-Account'] = accountKey(selected);
    const response = object(await this.request(path, { method: 'GET', headers }));
    if (!Object.hasOwn(response, 'result') || Object.hasOwn(response, 'error')) return invalid();
    return response.result;
  }

  async listAccounts(token: string): Promise<TossAccount[]> {
    return parseAccounts(await this.get('/api/v1/accounts', token));
  }

  /** Caller must first validate the selection against this owner's provider list. */
  async holdings(token: string, selected: string): Promise<TossHoldings> {
    return parseHoldings(await this.get('/api/v1/holdings', token, selected), new Date(this.now()).toISOString());
  }
}
