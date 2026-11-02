import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, TossProviderClient } from './toss-provider';

// All credentials, account numbers, and holdings in this file are synthetic.
// No test invokes the default network transport.
const NOW = Date.parse('2026-11-02T00:00:00Z');
const TOKEN = 'synthetic-bearer-token';
const CLIENT = 'synthetic-client';
const SECRET = 'synthetic-client-secret';
const ORIGIN = 'https://openapi.tossinvest.com';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const rawJson = (value: string) => new Response(value, { headers: { 'content-type': 'application/json; charset=utf-8' } });
function setup(...responses: Array<Response | Error>) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetchImpl.mockRejectedValueOnce(response);
    else fetchImpl.mockResolvedValueOnce(response);
  }
  return { fetchImpl, client: new TossProviderClient({ fetchImpl, now: () => NOW }) };
}
function item(currency: 'KRW' | 'USD' = 'KRW') {
  const marketCountry = currency === 'KRW' ? 'KR' : 'US';
  return {
    symbol: currency === 'KRW' ? '000001' : 'SYNTH', name: '합성 테스트 종목', marketCountry, currency,
    quantity: '0.1234567890123456789012345678', lastPrice: '10', averagePurchasePrice: '9',
    marketValue: { purchaseAmount: '9', amount: '10.000000000000000000000000001', amountAfterCost: '9.99' },
    profitLoss: { amount: '1', amountAfterCost: '0.99', rate: '0.1', rateAfterCost: '0.099' },
    dailyProfitLoss: { amount: '-0.01', rate: '-0.001' }, cost: { commission: '0.01', tax: null },
  };
}
function overview(items: ReturnType<typeof item>[] = []) {
  const prices = { krw: '0', usd: null as string | null };
  return {
    totalPurchaseAmount: { ...prices },
    marketValue: { amount: { ...prices }, amountAfterCost: { ...prices } },
    profitLoss: { amount: { ...prices }, amountAfterCost: { ...prices }, rate: '0', rateAfterCost: '0' },
    dailyProfitLoss: { amount: { ...prices }, rate: '0' }, items,
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('Toss official read-only provider transport', () => {
  it('has exactly the token/accounts/holdings routes, fixed host and no redirects/cache', async () => {
    const { client, fetchImpl } = setup(
      json({ access_token: TOKEN, token_type: 'Bearer', expires_in: 3600 }),
      json({ result: [{ accountNo: '000011112222', accountSeq: 7, accountType: 'BROKERAGE' }] }),
      json({ result: overview() }),
    );
    await expect(client.issueToken(CLIENT, SECRET)).resolves.toEqual({ accessToken: TOKEN, expiresAt: new Date(NOW + 3_600_000) });
    await client.listAccounts(TOKEN);
    await client.holdings(TOKEN, '7');
    expect(fetchImpl.mock.calls.map(call => [call[0], call[1]?.method])).toEqual([
      [ORIGIN + '/oauth2/token', 'POST'], [ORIGIN + '/api/v1/accounts', 'GET'], [ORIGIN + '/api/v1/holdings', 'GET'],
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({ redirect: 'error', cache: 'no-store' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    const tokenRequest = fetchImpl.mock.calls[0]![1]!;
    expect(String(tokenRequest.body)).toBe(new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT, client_secret: SECRET }).toString());
    expect(fetchImpl.mock.calls[1]![1]?.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TOKEN}` });
    expect(fetchImpl.mock.calls[2]![1]?.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, 'X-Tossinvest-Account': '7' });
    // No credentials or tokens have become instance fields or cached clients.
    const retained = JSON.stringify(Object.values(client));
    expect(retained).not.toContain(TOKEN);
    expect(retained).not.toContain(CLIENT);
    expect(retained).not.toContain(SECRET);
  });

  it.each(['', 'bad\nheader', ' leading', 'space value'])('rejects invalid credentials before network (%s)', async value => {
    const { client, fetchImpl } = setup();
    await expect(client.issueToken(value, SECRET)).rejects.toMatchObject({ code: 'invalid_response', issuanceUncertain: false });
    await expect(client.issueToken(CLIENT, value)).rejects.toMatchObject({ code: 'invalid_response', issuanceUncertain: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects oversized credentials and invalid timeout options without network', async () => {
    const { client, fetchImpl } = setup();
    await expect(client.issueToken('x'.repeat(513), SECRET)).rejects.toBeInstanceOf(ProviderError);
    await expect(client.issueToken(CLIENT, 'x'.repeat(4097))).rejects.toBeInstanceOf(ProviderError);
    for (const timeoutMs of [0, -1, 30_001, 0.5, NaN]) {
      expect(() => new TossProviderClient({ fetchImpl, timeoutMs })).toThrow(ProviderError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['https://evil.invalid', '1\r\nInjected: yes', '0', '-1', '1e3', '9223372036854775808'])('rejects unsafe account selection (%s)', async selected => {
    const { client, fetchImpl } = setup();
    await expect(client.holdings(TOKEN, selected)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not consume an upstream error body or expose its content', async () => {
    const bodyRead = vi.fn(), canceled = vi.fn();
    const response = new Response(new ReadableStream({
      pull: bodyRead, cancel: canceled,
    }, { highWaterMark: 0 }), { status: 403, headers: { 'content-type': 'application/json' } });
    const { client } = setup(response);
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ code: 'provider_denied', status: 403, issuanceUncertain: false });
    expect(bodyRead).not.toHaveBeenCalled();
    expect(canceled).toHaveBeenCalledOnce();
  });

  it.each([
    [400, 'provider_denied'], [401, 'token_expired'], [403, 'provider_denied'],
    [404, 'provider_unavailable'], [429, 'rate_limited'], [500, 'provider_unavailable'],
  ])('maps HTTP %i to allowlisted error metadata and never reissues/retries', async (status, code) => {
    const response = new Response('sensitive upstream body must never escape', { status: Number(status), headers: { 'retry-after': '17' } });
    const { client, fetchImpl } = setup(response);
    const error = await client.listAccounts(TOKEN).catch(error => error as ProviderError);
    expect(error).toMatchObject({ code, status, retryAfterSeconds: 17, issuanceUncertain: false });
    expect(String(error)).not.toContain('sensitive upstream');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('discards untrusted retry metadata rather than reflecting it', async () => {
    const { client } = setup(new Response('', { status: 429, headers: { 'retry-after': 'private upstream value' } }));
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: null });
  });
  it.each([
    ['120', 120], ['0', 0], ['000120', 120], ['1000000', 1_000_000],
    ['Mon, 02 Nov 2026 00:02:00 GMT', 120],
    ['Monday, 02-Nov-26 00:02:00 GMT', 120],
    ['Mon Nov  2 00:02:00 2026', 120],
    ['Sun, 06 Nov 1994 08:49:37 GMT', 0],
    ['1.5', null], ['-1', null], ['Tue, 31 Feb 2026 00:02:00 GMT', null],
  ])('parses Retry-After %s without discarding a valid wait', async (header, expected) => {
    const { client, fetchImpl } = setup(new Response('', { status: 429, headers: { 'retry-after': String(header) } }));
    await expect(client.holdings(TOKEN, '7')).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: expected });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('keeps oversized delays fail-closed instead of shortening them to the normal refresh period', async () => {
    const { client } = setup(new Response('', { status: 429, headers: { 'retry-after': '9'.repeat(64) } }));
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ retryAfterSeconds:
      Math.ceil((Date.parse('9999-12-31T23:59:59.999Z') - NOW) / 1_000) });
  });
  it('uses the RFC850 fifty-year rule instead of a fixed 1950/2000 pivot', async () => {
    const { client } = setup(new Response('', { status: 429, headers: { 'retry-after': 'Sunday, 02-Nov-70 00:02:00 GMT' } }));
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ retryAfterSeconds: (Date.parse('2070-11-02T00:02:00Z') - NOW) / 1_000 });
    const past = setup(new Response('', { status: 429, headers: { 'retry-after': 'Sunday, 02-Nov-80 00:02:00 GMT' } }));
    await expect(past.client.listAccounts(TOKEN)).rejects.toMatchObject({ retryAfterSeconds: 0 });
  });
  it('rounds an HTTP-date wait upward when the response arrives between seconds', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': 'Mon, 02 Nov 2026 00:02:00 GMT' } }));
    const client = new TossProviderClient({ fetchImpl, now: () => NOW + 500 });
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ retryAfterSeconds: 120 });
  });

  it('marks transport failures after token submission uncertain without retry or raw cause', async () => {
    const { client, fetchImpl } = setup(new Error(`transport included ${SECRET}`));
    const error = await client.issueToken(CLIENT, SECRET).catch(error => error as ProviderError);
    expect(error).toMatchObject({ code: 'provider_unavailable', issuanceUncertain: true });
    expect(String(error)).not.toContain(SECRET);
    expect(Object.hasOwn(error, 'cause')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([408, 500, 502, 503])('marks token HTTP %i uncertain', async status => {
    const { client, fetchImpl } = setup(new Response('', { status }));
    await expect(client.issueToken(CLIENT, SECRET)).rejects.toMatchObject({ issuanceUncertain: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 429])('keeps explicit token HTTP %i rejection distinguishable from an unknown issuance', async status => {
    const { client, fetchImpl } = setup(new Response('', { status }));
    await expect(client.issueToken(CLIENT, SECRET)).rejects.toMatchObject({ issuanceUncertain: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    null, [], {}, { access_token: TOKEN, token_type: 'bearer', expires_in: 30 },
    { access_token: TOKEN, token_type: 'Bearer', expires_in: '30' },
    { access_token: TOKEN, token_type: 'Bearer', expires_in: 0 },
    { access_token: TOKEN, token_type: 'Bearer', expires_in: 0.5 },
    { access_token: TOKEN, token_type: 'Bearer', expires_in: 31_536_001 },
    { access_token: 'token with whitespace', token_type: 'Bearer', expires_in: 30 },
  ])('treats a malformed success as uncertain issuance', async value => {
    const { client, fetchImpl } = setup(json(value));
    await expect(client.issueToken(CLIENT, SECRET)).rejects.toMatchObject({ code: 'invalid_response', issuanceUncertain: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('expires from request start, refusing a token already expired on receipt', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: TOKEN, token_type: 'Bearer', expires_in: 1 }));
    const now = vi.fn().mockReturnValueOnce(NOW).mockReturnValueOnce(NOW + 1000);
    const client = new TossProviderClient({ fetchImpl, now });
    await expect(client.issueToken(CLIENT, SECRET)).rejects.toMatchObject({ issuanceUncertain: true });
  });

  it('aborts on deadline and marks token outcome uncertain', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = new TossProviderClient({ fetchImpl, now: () => NOW, timeoutMs: 20 });
    const assertion = expect(client.issueToken(CLIENT, SECRET)).rejects.toMatchObject({ code: 'provider_unavailable', issuanceUncertain: true });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects a redirected or mismatched response even from an alternate transport', async () => {
    const response = json({ result: [] });
    Object.defineProperty(response, 'url', { value: 'https://evil.invalid/accounts' });
    const { client } = setup(response);
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([
    () => new Response('{"result":[]}', { headers: { 'content-type': 'text/html' } }),
    () => rawJson('{invalid json'),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    () => new Response(null, { headers: { 'content-type': 'application/json' } }),
    () => new Response('small', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } }),
    () => rawJson(' '.repeat(1_048_577)),
  ])('rejects malformed, missing and oversized bodies', async response => {
    const { client } = setup(response());
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('Toss account and financial contract mapping', () => {
  it('preserves the complete int64 source value without requiring JSON source-context support', async () => {
    const { client } = setup(rawJson('{"result":[{"accountNo":"000011112222","accountSeq":9223372036854775807,"accountType":"BROKERAGE"}]}'));
    await expect(client.listAccounts(TOKEN)).resolves.toEqual([
      { accountKey: '9223372036854775807', type: 'BROKERAGE', label: '종합매매 계좌 · 2222', last4: '2222' },
    ]);
  });

  it('handles escaped property names without modifying quoted string contents', async () => {
    const { client } = setup(rawJson('{"result":[{"accountNo":"masked","\\u0061ccountSeq":9223372036854775807,"accountType":"FUTURE_KIND"}]}'));
    await expect(client.listAccounts(TOKEN)).resolves.toEqual([
      { accountKey: '9223372036854775807', type: 'FUTURE_KIND', label: '지원하지 않는 계좌', last4: null },
    ]);
  });

  it.each(['01', '0', '-1', '1e3', '1.0', '9223372036854775808', '123bad'])('does not round, repair or accept invalid account literal %s', async literal => {
    const { client } = setup(rawJson(`{"result":[{"accountNo":"000011112222","accountSeq":${literal},"accountType":"BROKERAGE"}]}`));
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('discards full account numbers and supports an empty account result', async () => {
    const { client } = setup(json({ result: [{ accountNo: '000011112222', accountSeq: '1', accountType: 'BROKERAGE' }] }), json({ result: [] }));
    expect(JSON.stringify(await client.listAccounts(TOKEN))).not.toContain('000011112222');
    await expect(client.listAccounts(TOKEN)).resolves.toEqual([]);
  });

  it.each([
    { result: [{ accountNo: '1234', accountSeq: 1, accountType: 'BROKERAGE' }, { accountNo: '5678', accountSeq: 1, accountType: 'BROKERAGE' }] },
    { result: [{ accountSeq: 1, accountType: 'BROKERAGE' }] },
    { result: [], error: null }, { error: { message: 'must not appear' } },
    { result: Array.from({ length: 10_001 }, (_, index) => ({ accountNo: '1234', accountSeq: index + 1, accountType: 'BROKERAGE' })) },
  ])('rejects ambiguous, invalid, excessive and error account responses', async response => {
    const { client } = setup(json(response));
    await expect(client.listAccounts(TOKEN)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('keeps KRW/USD totals distinct and decimal precision intact without inventing valuation time', async () => {
    const value = overview([item('KRW'), item('USD')]);
    value.marketValue.amount = { krw: '9007199254740993.123456789', usd: '12.345678901234567890123456789' };
    value.marketValue.amountAfterCost = { krw: '9007199254740993.123456780', usd: '12.345678901234567890123456780' };
    const { client } = setup(json({ result: value }));
    const result = await client.holdings(TOKEN, '1');
    expect(result).toEqual({
      totals: [
        { currency: 'KRW', marketValue: value.marketValue.amount.krw, afterCostValue: value.marketValue.amountAfterCost.krw },
        { currency: 'USD', marketValue: value.marketValue.amount.usd, afterCostValue: value.marketValue.amountAfterCost.usd },
      ],
      items: value.items.map(value => ({ symbol: value.symbol, name: value.name, currency: value.currency,
        quantity: value.quantity, marketValue: value.marketValue.amount, afterCostValue: value.marketValue.amountAfterCost })),
      observedAt: new Date(NOW).toISOString(), valuationAt: null,
    });
  });

  it('retains a successful empty portfolio, and omits missing USD rather than manufacturing zero', async () => {
    const value = overview();
    const { client } = setup(json({ result: value }));
    await expect(client.holdings(TOKEN, '1')).resolves.toEqual({
      totals: [{ currency: 'KRW', marketValue: '0', afterCostValue: '0' }],
      items: [], observedAt: new Date(NOW).toISOString(), valuationAt: null,
    });
  });

  it.each(['amount', 'amountAfterCost'] as const)('rejects inconsistent missing USD totals (%s)', async field => {
    const value = overview([item('USD')]);
    value.marketValue[field].usd = '10';
    const { client } = setup(json({ result: value }));
    await expect(client.holdings(TOKEN, '1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([
    (value: ReturnType<typeof overview>) => { value.items[0]!.currency = 'EUR' as never; },
    (value: ReturnType<typeof overview>) => { value.items[0]!.marketCountry = 'US'; },
    (value: ReturnType<typeof overview>) => { value.items[0]!.quantity = '1e3'; },
    (value: ReturnType<typeof overview>) => { value.items[0]!.quantity = 1 as never; },
    (value: ReturnType<typeof overview>) => { value.items[0]!.marketValue.amount = ' 1'; },
    (value: ReturnType<typeof overview>) => { value.items[0]!.marketValue.amount = '1'.repeat(31); },
    (value: ReturnType<typeof overview>) => { value.items[0]!.cost.commission = 'not-money'; },
    (value: ReturnType<typeof overview>) => { value.items.push({ ...value.items[0]! }); },
    (value: ReturnType<typeof overview>) => { delete (value as Partial<typeof value>).profitLoss; },
  ])('fails the entire snapshot on unknown coverage, imprecise values, duplicates or missing fields', async mutate => {
    const value = overview([item()]);
    mutate(value);
    const { client } = setup(json({ result: value }));
    await expect(client.holdings(TOKEN, '1')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
