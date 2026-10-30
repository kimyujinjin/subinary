import { describe, expect, it, vi } from 'vitest';

// Synthetic full-CSV fixtures based on documented SDMX concepts, not a captured
// live ECB response. Live endpoint compatibility is a separate release check.

import {
  deriveEcbCrossRate,
  ECB_HISTORICAL_FX_CURRENCIES,
  EcbHistoricalFxProvider,
  type HistoricalFxResult,
} from './historical-fx-provider.js';

const DATE = '2026-10-22';
const NOW = new Date('2026-10-30T08:00:00Z');
const HEADER = ['FREQ', 'CURRENCY', 'CURRENCY_DENOM', 'EXR_TYPE', 'EXR_SUFFIX',
  'TIME_PERIOD', 'OBS_VALUE', 'OBS_STATUS', 'UNIT', 'UNIT_MULT', 'DECIMALS'];
type Row = Record<string, string>;
const usd = (overrides: Row = {}): Row => ({ FREQ: 'D', CURRENCY: 'USD', CURRENCY_DENOM: 'EUR',
  EXR_TYPE: 'SP00', EXR_SUFFIX: 'A', TIME_PERIOD: DATE, OBS_VALUE: '1.1205',
  OBS_STATUS: 'A', UNIT: 'USD', UNIT_MULT: '0', DECIMALS: '4', ...overrides });
const krw = (overrides: Row = {}): Row => usd({ CURRENCY: 'KRW', UNIT: 'KRW', OBS_VALUE: '1484.25',
  DECIMALS: '2', ...overrides });
const cell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
function csv(rows: Row[] = [usd(), krw()], header = HEADER): string {
  return [header.join(','), ...rows.map((row) => header.map((key) => cell(row[key] ?? '')).join(','))].join('\r\n');
}
const response = (body = csv()) => new Response(body, { headers: { 'content-type': 'text/csv' } });
const available = (result: HistoricalFxResult) => {
  if (result.status !== 'available') throw new Error(`unexpected ${result.reason}`);
  return result;
};
function providerFor(body = csv()) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body));
  return { provider: new EcbHistoricalFxProvider({ fetch: fetcher, now: () => NOW }), fetcher };
}

describe('ECB exact-date historical reference', () => {
  it('derives KRW per USD in the correct direction and preserves exact public provenance', async () => {
    const { provider, fetcher } = providerFor();
    const result = available(await provider.lookup('USD', DATE));
    expect(result.rate).toBe('1324.631860776439');
    expect(result.origin.provider).toBe('ecb-reference-cross');
    expect(result.origin.fetchedAt).toEqual(NOW);
    const provenance = JSON.parse(result.origin.providerReference!);
    expect(provenance).toMatchObject({ asOfDate: DATE, baseCurrency: 'USD', quoteCurrency: 'KRW',
      basePerEur: '1.1205', krwPerEur: '1484.25', scale: 12, rounding: 'HALF_UP', observationStatus: 'A' });
    const [url, options] = fetcher.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe('https://data-api.ecb.europa.eu');
    expect(parsed.pathname).toBe('/service/data/EXR/D.USD+KRW.EUR.SP00.A');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ startPeriod: DATE, endPeriod: DATE,
      format: 'csvdata', detail: 'full' });
    expect(options).toMatchObject({ redirect: 'error', headers: { accept: 'text/csv' } });
    expect(result.origin.note).toContain('not a transaction-time or card-settlement rate');
  });

  it('uses the KRW per EUR row directly for EUR and does not invent an EUR observation', async () => {
    const { provider, fetcher } = providerFor(csv([krw()]));
    const result = available(await provider.lookup('EUR', DATE));
    expect(result.rate).toBe('1484.250000000000');
    expect(String(fetcher.mock.calls[0][0])).toContain('/D.KRW.EUR.SP00.A?');
    expect(JSON.parse(result.origin.providerReference!).basePerEur).toBe('1');
  });

  it('uses the entire decimal source value rather than rounding to display DECIMALS', async () => {
    const { provider } = providerFor(csv([usd({ OBS_VALUE: '1.12050001', DECIMALS: '4' }), krw()]));
    expect(available(await provider.lookup('USD', DATE)).rate)
      .toBe(deriveEcbCrossRate('1484.25', '1.12050001'));
  });

  it('supports only explicitly verified ECB/app currencies; other contract currencies remain unresolved', async () => {
    expect(ECB_HISTORICAL_FX_CURRENCIES).toContain('USD');
    const { provider, fetcher } = providerFor();
    for (const code of ['KRW', 'VND', 'TWD', 'MOP', 'BHD', 'KWD', 'OMR', 'XYZ', ' USD']) {
      expect(await provider.lookup(code, DATE)).toEqual({ status: 'unavailable', reason: 'unsupported_currency' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates calendar dates and future dates using the Seoul day before any HTTP request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(csv([
      usd({ TIME_PERIOD: '2026-10-23' }), krw({ TIME_PERIOD: '2026-10-23' }),
    ])));
    const provider = new EcbHistoricalFxProvider({ fetch: fetcher, now: () => new Date('2026-10-22T15:00:00Z') });
    expect((await provider.lookup('USD', '2026-10-23')).status).toBe('available');
    for (const date of ['2026-10-24', '2026-02-30', '2026-1-01', 'invalid']) {
      expect((await provider.lookup('USD', date)).status).toBe('unavailable');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not fall back across a holiday, weekend, or unpublished current day', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(csv([])));
    const provider = new EcbHistoricalFxProvider({ fetch: fetcher, now: () => NOW });
    for (const date of ['2026-10-24', '2026-01-01', '2026-10-30']) {
      expect(await provider.lookup('USD', date)).toEqual({ status: 'unavailable', reason: 'observation_missing' });
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url] of fetcher.mock.calls) {
      const query = new URL(String(url)).searchParams;
      expect(query.get('startPeriod')).toBe(query.get('endPeriod'));
    }
  });

  it('accepts quoted CSV, escaped quotes, embedded newlines, BOM, and arbitrary column order', async () => {
    const header = [...HEADER].reverse().concat('COMMENT');
    const text = '\uFEFF' + csv([usd({ COMMENT: 'quoted, "metadata"\nsecond line' }), krw()], header) + '\r\n';
    const { provider } = providerFor(text);
    expect(available(await provider.lookup('usd', DATE)).rate).toBe('1324.631860776439');
  });

  it.each([
    ['wrong date', [usd({ TIME_PERIOD: '2026-10-21' }), krw()]],
    ['wrong frequency', [usd({ FREQ: 'M' }), krw()]],
    ['wrong denominator', [usd({ CURRENCY_DENOM: 'USD' }), krw()]],
    ['wrong rate type', [usd({ EXR_TYPE: 'EN00' }), krw()]],
    ['wrong suffix', [usd({ EXR_SUFFIX: 'E' }), krw()]],
    ['wrong currency', [usd({ CURRENCY: 'JPY' }), krw()]],
    ['duplicate observation', [usd(), usd(), krw()]],
    ['provisional status', [usd({ OBS_STATUS: 'P' }), krw()]],
    ['blank status', [usd({ OBS_STATUS: '' }), krw()]],
    ['unit multiplier', [usd({ UNIT_MULT: '3' }), krw()]],
    ['wrong unit', [usd({ UNIT: 'JPY' }), krw()]],
    ['invalid display metadata', [usd({ DECIMALS: '-1' }), krw()]],
  ] as const)('rejects %s rather than guessing its meaning', async (_name, rows) => {
    const { provider } = providerFor(csv([...rows]));
    expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'response_invalid' });
  });

  it('requires normal-status/unit metadata but permits absent display DECIMALS', async () => {
    for (const missing of ['OBS_STATUS', 'UNIT_MULT', 'UNIT']) {
      const { provider } = providerFor(csv([usd(), krw()], HEADER.filter((name) => name !== missing)));
      expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'response_invalid' });
    }
    const { provider } = providerFor(csv([usd(), krw()], HEADER.filter((name) => name !== 'DECIMALS')));
    expect((await provider.lookup('USD', DATE)).status).toBe('available');
  });

  it.each([
    ['duplicate header', csv([usd(), krw()], [...HEADER, 'CURRENCY'])],
    ['truncated row', csv() + '\r\nD,USD'],
    ['unclosed quote', csv() + '\r\n"unterminated'],
    ['characters after quote', csv().replace('1.1205', '"1.1205"bad')],
    ['quote in unquoted field', csv().replace('1.1205', '1.12"05')],
    ['HTML response', '<html>unavailable</html>'],
  ])('rejects malformed CSV: %s', async (_name, text) => {
    const { provider } = providerFor(text);
    expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'response_invalid' });
  });

  it.each(['-1', '0', '1e3', 'NaN', '1'.repeat(81)])('rejects invalid raw quote %s', async (quote) => {
    const { provider } = providerFor(csv([usd({ OBS_VALUE: quote }), krw()]));
    expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'invalid_rate' });
  });

  it('treats missing observations as unavailable, including absent paired currency or 404', async () => {
    for (const body of ['', csv([]), csv([usd()]), csv([usd({ OBS_VALUE: '' }), krw()])]) {
      const { provider } = providerFor(body);
      expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'observation_missing' });
    }
    const provider = new EcbHistoricalFxProvider({ now: () => NOW,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })) });
    expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'observation_missing' });
  });
});

describe('fixed decimal cross-rate math', () => {
  it('rounds exact halves upward, carries, and retains integers beyond binary safe precision', () => {
    expect(deriveEcbCrossRate('1', '2000000000000')).toBe('0.000000000001');
    expect(deriveEcbCrossRate('1.9999999999995', '1')).toBe('2.000000000000');
    expect(deriveEcbCrossRate('9007199254740993', '10000')).toBe('900719925474.099300000000');
  });

  it('checks positive numeric(24,12) bounds after rounding, not before', () => {
    expect(deriveEcbCrossRate('999999999999.999999999999', '1')).toBe('999999999999.999999999999');
    for (const [krwQuote, baseQuote] of [['999999999999.9999999999995', '1'],
      ['1000000000000', '1'], ['1', '3000000000000']]) {
      expect(() => deriveEcbCrossRate(krwQuote, baseQuote)).toThrow('historical_fx_invalid_rate');
    }
  });
});

describe('request bounds and caches', () => {
  it('deduplicates in-flight lookup and caches successful exact keys without exposing mutable cache state', async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const provider = new EcbHistoricalFxProvider({ fetch: fetcher, now: () => NOW });
    const first = provider.lookup('USD', DATE);
    const second = provider.lookup('USD', DATE);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(response());
    const [a, b] = await Promise.all([first, second]);
    available(a).origin.fetchedAt.setUTCFullYear(1999);
    expect(available(b).origin.fetchedAt).toEqual(NOW);
    expect(available(await provider.lookup('USD', DATE)).origin.fetchedAt).toEqual(NOW);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('failure cooldown is short and an unavailable key can recover without process restart', async () => {
    let clock = NOW.getTime();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('private server detail'))
      .mockImplementation(async () => response());
    const provider = new EcbHistoricalFxProvider({ fetch: fetcher, now: () => new Date(clock) });
    expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'network_error' });
    expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'network_error' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 5001;
    expect((await provider.lookup('USD', DATE)).status).toBe('available');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bounds the successful cache to 128 exact keys', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const date = new URL(String(url)).searchParams.get('startPeriod')!;
      return response(csv([usd({ TIME_PERIOD: date }), krw({ TIME_PERIOD: date })]));
    });
    const provider = new EcbHistoricalFxProvider({ fetch: fetcher, now: () => NOW });
    const dates = Array.from({ length: 129 }, (_, i) =>
      new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
    for (const date of dates) expect((await provider.lookup('USD', date)).status).toBe('available');
    expect(fetcher).toHaveBeenCalledTimes(129);
    await provider.lookup('USD', dates[0]);
    expect(fetcher).toHaveBeenCalledTimes(130);
  });

  it('HTTP errors do not use any current-rate fallback', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('untrusted body', { status: 503 }));
    const provider = new EcbHistoricalFxProvider({ fetch: fetcher, now: () => NOW });
    expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'http_error' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('limits declared and streamed bytes before parsing', async () => {
    for (const res of [new Response('', { headers: { 'content-length': String(256 * 1024 + 1) } }),
      new Response('x'.repeat(256 * 1024 + 1))]) {
      const provider = new EcbHistoricalFxProvider({ now: () => NOW,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(res) });
      expect(await provider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'response_too_large' });
    }
  });

  it('times out both fetch and body reads without leaking the underlying error', async () => {
    const waitingFetch = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const fetchProvider = new EcbHistoricalFxProvider({ now: () => NOW, fetch: waitingFetch, timeoutMs: 5 });
    expect(await fetchProvider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'timeout' });
    const body = new ReadableStream<Uint8Array>({ start() {}, cancel() {} });
    const bodyProvider = new EcbHistoricalFxProvider({ now: () => NOW, timeoutMs: 5,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body)) });
    expect(await bodyProvider.lookup('USD', DATE)).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('caps concurrent HTTP calls at two and transfers queued slots after completion or failure', async () => {
    const resolvers: Array<() => void> = [];
    let active = 0; let maxActive = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((url) => new Promise((resolve) => {
      active += 1; maxActive = Math.max(maxActive, active);
      const date = new URL(String(url)).searchParams.get('startPeriod')!;
      resolvers.push(() => { active -= 1; resolve(response(csv([
        usd({ TIME_PERIOD: date }), krw({ TIME_PERIOD: date }),
      ]))); });
    }));
    const provider = new EcbHistoricalFxProvider({ now: () => NOW, fetch: fetcher });
    const pending = ['2026-10-20', '2026-10-21', DATE].map((date) => provider.lookup('USD', date));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    resolvers.shift()!();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    resolvers.splice(0).forEach((resolve) => resolve());
    expect((await Promise.all(pending)).every((result) => result.status === 'available')).toBe(true);
    expect(maxActive).toBe(2);
  });

  it('bounds waiting requests and includes queue time in each request deadline', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const provider = new EcbHistoricalFxProvider({ now: () => NOW, fetch: fetcher, timeoutMs: 10 });
    const pending = Array.from({ length: 19 }, (_, i) => provider.lookup('USD', `2026-09-${String(i + 1).padStart(2, '0')}`));
    const results = await Promise.all(pending);
    expect(results[18]).toEqual({ status: 'unavailable', reason: 'request_limit' });
    expect(results.slice(0, 18).every((result) => result.status === 'unavailable' && result.reason === 'timeout')).toBe(true);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(18);
  });

  it('rejects invalid production deadline options', () => {
    for (const timeoutMs of [0, 5001, 1.5, NaN]) {
      expect(() => new EcbHistoricalFxProvider({ timeoutMs })).toThrow('historical_fx_invalid_timeout');
    }
  });
});
