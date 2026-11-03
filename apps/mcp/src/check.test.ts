import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinanceQuality } from '@family/contracts';
import { runFinanceCheck } from './check';
import { extractApiNetworkCode } from './api-client';

const directories: string[] = [];
const SECRET = 'fixture-secret-do-not-print';
const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const quality: FinanceQuality = {
  asOf: '2026-10-27T15:30:00.000Z',
  scope: { period: 'all_time', transactions: 'visible_non_excluded', sms: 'own_member' },
  transactions: { uncategorized: 3, duplicateSuspected: 1, unlinkedCancellations: 2, cardOwnerMismatches: 4 },
  sms: { pending: 1, parseFailed: 2, pendingReview: 3, quarantined: 4, ignored: 5, lastReceivedAt: null },
};

/** 비밀번호를 출력하지 않는 소유자 전용 합성 인증 파일을 만든다. */
function credentials(): NodeJS.ProcessEnv {
  const directory = mkdtempSync(join(tmpdir(), 'fma-check-test-'));
  directories.push(directory);
  const path = join(directory, 'credentials.json');
  writeFileSync(path, JSON.stringify({ email: 'fixture@example.com', password: SECRET }), { mode: 0o600 });
  return { FAMILY_CREDENTIALS_FILE: path };
}

/** 실제 클라이언트의 HTTP 순서를 유지하면서 외부 통신만 합성 응답으로 바꾼다. */
function mockApi(payload: object = quality): Array<{ url: URL; method: string }> {
  const requests: Array<{ url: URL; method: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({ url, method: init?.method ?? 'GET' });
    if (url.pathname === '/v1/auth/login') return Response.json({ tokens: { accessToken: SECRET } });
    if (url.pathname === '/v1/auth/me') return Response.json({ memberships: [{ householdId: HOUSEHOLD }] });
    return Response.json(payload);
  }));
  return requests;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('연결된 PC의 읽기 전용 품질 조회 명령', () => {
  it('실제 집계와 범위를 보존하고 로그인 뒤 품질 조회만 한다', async () => {
    const requests = mockApi({ ...quality, rawSms: SECRET, amount: 10000 });
    const result = await runFinanceCheck({ env: credentials() });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({ ok: true, source: 'family-memory-ai-http-api', quality });
    expect(JSON.stringify(result.output)).not.toContain(SECRET);
    expect(JSON.stringify(result.output)).not.toContain('amount');
    expect(requests.map(({ url, method }) => `${method} ${url.pathname}`)).toEqual([
      'POST /v1/auth/login', 'GET /v1/auth/me', 'GET /v1/analytics/quality',
    ]);
    expect(requests[2]?.url.searchParams.get('householdId')).toBe(HOUSEHOLD);
  });

  it('환경 변수로 인증 대상 서버를 다른 주소로 바꿀 수 없다', async () => {
    const requests = mockApi();
    const result = await runFinanceCheck({ env: { ...credentials(), FAMILY_API_URL: 'https://untrusted.invalid' } });
    expect(result.exitCode).toBe(0);
    expect(requests.every(({ url }) => url.origin === 'https://app.subinary.cloud')).toBe(true);
  });

  it('명령 인자를 받으면 파일이나 API를 읽기 전에 거부한다', async () => {
    const requests = mockApi();
    const result = await runFinanceCheck({ args: ['/v1/transactions'], env: {} });
    expect(result).toMatchObject({ exitCode: 2, output: { ok: false, code: 'INVALID_ARGUMENTS' } });
    expect(requests).toHaveLength(0);
  });

  it('다른 사용자가 읽을 수 있는 인증 파일을 거부한다', async () => {
    const env = credentials();
    chmodSync(env.FAMILY_CREDENTIALS_FILE!, 0o644);
    const requests = mockApi();
    const result = await runFinanceCheck({ env });
    expect(result).toMatchObject({ exitCode: 2, output: { ok: false, code: 'CREDENTIALS_UNAVAILABLE' } });
    expect(requests).toHaveLength(0);
  });

  it('없는 인증 파일을 실패로 표시하고 경로나 인증 값을 출력하지 않는다', async () => {
    const result = await runFinanceCheck({ env: { FAMILY_CREDENTIALS_FILE: `/missing/${SECRET}` } });
    expect(result).toMatchObject({ exitCode: 2, output: { ok: false, code: 'CREDENTIALS_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('인증 거부 응답에 포함된 내용을 출력하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => Response.json({ message: SECRET }, { status: 401 })));
    const result = await runFinanceCheck({ env: credentials() });
    expect(result).toMatchObject({ exitCode: 1, output: { ok: false, code: 'ACCESS_DENIED', stage: 'login', proxyConfigured: false } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('네트워크 오류의 원시 메시지를 출력하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => { throw new Error(SECRET); }));
    const result = await runFinanceCheck({ env: credentials() });
    expect(result).toMatchObject({ exitCode: 1, output: { ok: false, code: 'API_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('불완전한 품질 응답을 성공이나 0건으로 바꾸지 않는다', async () => {
    mockApi({ sms: { parseFailed: 0 } });
    const result = await runFinanceCheck({ env: credentials() });
    expect(result).toMatchObject({ exitCode: 1, output: { ok: false, code: 'INVALID_RESPONSE' } });
    expect(result.output).not.toHaveProperty('quality');
  });

  it('응답이 끝나지 않으면 제한 시간에 실패하고 0건을 반환하지 않는다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((): Promise<Response> => new Promise<Response>(() => {})));
    const pending = runFinanceCheck({ env: credentials(), timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result).toMatchObject({ exitCode: 124, output: { ok: false, code: 'TIMEOUT' } });
    expect(result.output).toMatchObject({ stage: 'login', networkCode: 'TIMEOUT' });
    expect(result.output).not.toHaveProperty('quality');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { stage: 'login', path: '/v1/auth/login', original: 'ENOTFOUND', expected: 'ENOTFOUND' },
    { stage: 'household', path: '/v1/auth/me', original: 'EPERM', expected: 'EPERM' },
    { stage: 'quality', path: '/v1/analytics/quality', original: 'ECONNREFUSED', expected: 'ECONNREFUSED' },
    { stage: 'login', path: '/v1/auth/login', original: 'CERT_HAS_EXPIRED', expected: 'TLS' },
    { stage: 'quality', path: '/v1/analytics/quality', original: 'UND_ERR_CONNECT_TIMEOUT', expected: 'TIMEOUT' },
  ])('실패 단계 $stage 와 안전한 원인 $expected 만 남긴다', async ({ stage, path, original, expected }) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname === path) {
        throw new TypeError(SECRET, { cause: new Error(SECRET, { cause: { code: original, address: SECRET } }) });
      }
      if (url.pathname === '/v1/auth/login') return Response.json({ tokens: { accessToken: SECRET } });
      if (url.pathname === '/v1/auth/me') return Response.json({ memberships: [{ householdId: HOUSEHOLD }] });
      return Response.json(quality);
    }));
    const result = await runFinanceCheck({ env: { ...credentials(), HTTPS_PROXY: `https://user:${SECRET}@proxy.invalid` } });
    expect(result).toMatchObject({ exitCode: 1, output: { ok: false, code: 'API_UNAVAILABLE', stage, networkCode: expected, proxyConfigured: true } });
    expect(result.output).toHaveProperty('attemptedAt', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.+Z$/));
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('proxy.invalid');
    expect(result.output).not.toHaveProperty('quality');
  });

  it('로그인 성공 뒤 소속 가구가 없으면 네트워크 실패와 구분한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request): Promise<Response> => {
      if (new URL(String(input)).pathname === '/v1/auth/login') return Response.json({ tokens: { accessToken: SECRET } });
      return Response.json({ memberships: [] });
    }));
    const result = await runFinanceCheck({ env: credentials() });
    expect(result).toMatchObject({ exitCode: 1, output: { ok: false, code: 'HOUSEHOLD_NOT_FOUND', stage: 'household', proxyConfigured: false } });
    expect(result.output).not.toHaveProperty('networkCode');
  });

  it('잘못된 계정 응답은 가구 없음이나 네트워크 실패로 단정하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request): Promise<Response> => {
      if (new URL(String(input)).pathname === '/v1/auth/login') return Response.json({ tokens: { accessToken: SECRET } });
      return Response.json({ message: SECRET });
    }));
    const result = await runFinanceCheck({ env: credentials() });
    expect(result).toMatchObject({ exitCode: 1, output: { ok: false, code: 'INVALID_RESPONSE', stage: 'household' } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'])(
    '프록시 변수 %s 는 설정 유무만 보여 주고 연결을 변경하지 않는다', async (key) => {
      const fetcher = vi.fn(async (): Promise<Response> => { throw new Error(SECRET); });
      vi.stubGlobal('fetch', fetcher);
      const result = await runFinanceCheck({ env: { ...credentials(), [key]: `https://${SECRET}.invalid` } });
      expect(result.output).toMatchObject({ proxyConfigured: true });
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('프록시 제외 목록만 있거나 주소가 빈 값이면 프록시 설정으로 보고하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => { throw new Error(SECRET); }));
    const result = await runFinanceCheck({ env: { ...credentials(), NO_PROXY: SECRET, HTTPS_PROXY: '  ' } });
    expect(result.output).toMatchObject({ proxyConfigured: false });
  });
});

describe('네트워크 진단 원인 추출의 정보 경계', () => {
  it('AggregateError 에서 허용 코드만 추출한다', () => {
    const error = new TypeError(SECRET, { cause: new AggregateError([
      { code: SECRET, address: SECRET }, { code: 'EACCES', address: SECRET },
    ], SECRET) });
    expect(extractApiNetworkCode(error)).toBe('EACCES');
  });

  it('원시 메시지나 임의 코드에는 진단 코드를 만들지 않는다', () => {
    expect(extractApiNetworkCode(new Error('ENOTFOUND'))).toBeUndefined();
    expect(extractApiNetworkCode({ code: SECRET })).toBeUndefined();
    expect(extractApiNetworkCode({ code: '__proto__' })).toBeUndefined();
  });

  it('순환 cause 에서 무한 반복하지 않는다', () => {
    const error: { cause?: unknown; code: string } = { code: SECRET };
    error.cause = error;
    expect(extractApiNetworkCode(error)).toBeUndefined();
  });
});
