import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FinanceQuality } from '@family/contracts';

import { ApiError, FamilyApiClient, type FamilyApiSessionSnapshot } from './api-client';
import { handleFinanceMcp } from './remote-transport';

const HOUSEHOLD_A = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_B = '22222222-2222-4222-8222-222222222222';
const SECRET = 'fixture-secret-never-return';
const servers: Server[] = [];
const clients: Client[] = [];
const quality: FinanceQuality = {
  asOf: '2026-10-28T01:00:00.000Z',
  scope: { period: 'all_time', transactions: 'visible_non_excluded', sms: 'own_member' },
  transactions: { uncategorized: 3, duplicateSuspected: 1, unlinkedCancellations: 2, cardOwnerMismatches: 0 },
  sms: { pending: 0, parseFailed: 2, pendingReview: 0, quarantined: 0, ignored: 2, lastReceivedAt: null },
};
type BackendHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/** 합성 API와 MCP만 루프백의 임시 포트에서 실행한다. */
async function listen(handler: BackendHandler): Promise<string> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('테스트 서버 주소를 확인하지 못했습니다.');
  return `http://127.0.0.1:${address.port}`;
}

/** 테스트 응답을 JSON으로 반환한다. */
function json(res: ServerResponse, body: object, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** 인증 경계는 합성 식별자로 대체하고 실제 HTTP 전송과 SDK 수명주기를 사용한다. */
async function gateway(apiUrl: string): Promise<{ url: string; snapshots: FamilyApiSessionSnapshot[] }> {
  const snapshots: FamilyApiSessionSnapshot[] = [];
  const url = await listen(async (req, res) => {
    const user = req.headers['x-test-user'] === 'b' ? 'b' : 'a';
    const api = FamilyApiClient.fromSession({ apiUrl, accessToken: `token-${user}`, refreshCookie: `refresh_token=refresh-${user}` });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const source = Buffer.concat(chunks).toString('utf8');
    const body: unknown = source ? JSON.parse(source) as unknown : undefined;
    await handleFinanceMcp(req, res, body, api);
    snapshots.push(api.getSessionSnapshot());
  });
  return { url: `${url}/mcp`, snapshots };
}

/** 실제 SDK HTTP 클라이언트로 initialize와 initialized 알림을 교환한다. */
async function connect(url: string, user: 'a' | 'b' = 'a'): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name: 'remote-finance-test', version: '1.0.0' });
  clients.push(client);
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { 'x-test-user': user } } });
  await client.connect(transport);
  return { client, transport };
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

describe('금융 원격 MCP 전송', () => {
  it('실제 HTTP로 초기화·10개 조회 도구 발견·품질 조회가 되고 세션 ID는 만들지 않는다', async () => {
    const paths: string[] = [];
    const apiUrl = await listen((req, res) => {
      paths.push(req.url ?? '');
      expect(req.headers.cookie).toBeUndefined();
      if (req.url === '/v1/auth/me') return json(res, { memberships: [{ householdId: HOUSEHOLD_A }] });
      json(res, quality);
    });
    const { url } = await gateway(apiUrl);
    const { client, transport } = await connect(url);
    expect(transport.sessionId).toBeUndefined();
    expect(client.getServerVersion()?.name).toBe('family-finance');
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(10);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.some((tool) => /memory|classify|apply|revert/.test(tool.name))).toBe(false);
    const response = await client.callTool({ name: 'finance_quality', arguments: {} });
    expect(response.structuredContent).toEqual({ data: quality });
    expect(paths).toEqual(['/v1/auth/me', `/v1/analytics/quality?householdId=${HOUSEHOLD_A}`]);
  });

  it('동시 사용자 요청의 가구·토큰·조회 결과가 섞이지 않는다', async () => {
    const apiUrl = await listen((req, res) => {
      const isB = req.headers.authorization === 'Bearer token-b';
      const household = isB ? HOUSEHOLD_B : HOUSEHOLD_A;
      if (req.url === '/v1/auth/me') return json(res, { memberships: [{ householdId: household }] });
      expect(new URL(req.url ?? '/', 'http://fixture').searchParams.get('householdId')).toBe(household);
      json(res, { ...quality, sms: { ...quality.sms, parseFailed: isB ? 7 : 2 } });
    });
    const { url } = await gateway(apiUrl);
    const [a, b] = await Promise.all([connect(url, 'a'), connect(url, 'b')]);
    const [resultA, resultB] = await Promise.all([
      a.client.callTool({ name: 'finance_quality', arguments: {} }),
      b.client.callTool({ name: 'finance_quality', arguments: {} }),
    ]);
    expect(resultA.structuredContent).toMatchObject({ data: { sms: { parseFailed: 2 } } });
    expect(resultB.structuredContent).toMatchObject({ data: { sms: { parseFailed: 7 } } });
  });

  it('실패를 0건으로 표시하지 않고 서버의 민감 오류 본문을 노출하지 않는다', async () => {
    const apiUrl = await listen((_req, res) => json(res, { message: SECRET }, 500));
    const { url } = await gateway(apiUrl);
    const { client } = await connect(url);
    const response = await client.callTool({ name: 'finance_quality', arguments: { householdId: HOUSEHOLD_A } });
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain(SECRET);
  });

  it('등록되지 않은 쓰기 도구와 잘못된 인자를 API에 전달하지 않는다', async () => {
    let calls = 0;
    const apiUrl = await listen((_req, res) => { calls += 1; json(res, {}); });
    const { url } = await gateway(apiUrl);
    const { client } = await connect(url);
    expect((await client.callTool({ name: 'finance_recategorize_apply', arguments: {} })).isError).toBe(true);
    expect((await client.callTool({ name: 'finance_transactions', arguments: { limit: 101 } })).isError).toBe(true);
    expect(calls).toBe(0);
  });

  it('GET·DELETE는 405로 거부하고 잘못된 MCP 메시지는 400으로 처리한다', async () => {
    const { url } = await gateway('http://127.0.0.1:1');
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(url, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ invalid: true }) });
    expect(response.status).toBe(400);
  });
});

describe('원격 MCP의 요청별 API 세션', () => {
  it('비밀번호 로그인 없이 세션을 사용하고 스냅샷은 독립 복사본이다', async () => {
    const client = FamilyApiClient.fromSession({ apiUrl: 'https://family.invalid/', accessToken: SECRET, refreshCookie: 'refresh_token=fixture-refresh' });
    await expect(client.login()).rejects.toThrow('비밀번호 로그인을 사용할 수 없습니다');
    const snapshot = client.getSessionSnapshot();
    snapshot.accessToken = 'changed';
    expect(client.getSessionSnapshot().accessToken).toBe(SECRET);
  });

  it('원격 설정의 잘못된 주소·토큰·쿠키·제한 시간은 값 노출 없이 거부한다', () => {
    const valid = { apiUrl: 'https://family.invalid', accessToken: SECRET, refreshCookie: 'refresh_token=fixture-refresh' };
    for (const override of [
      { apiUrl: `https://${SECRET}@family.invalid` }, { apiUrl: 'file:///tmp/fixture' },
      { accessToken: `${SECRET}\r\nInjected: true` }, { refreshCookie: `other=${SECRET}` },
      { refreshCookie: `refresh_token=${SECRET}; second=value` }, { timeoutMs: 0 },
    ]) {
      try { FamilyApiClient.fromSession({ ...valid, ...override }); throw new Error('검증이 누락됐습니다.'); }
      catch (error: unknown) { expect(String(error)).not.toContain(SECRET); expect(String(error)).not.toContain('검증이 누락'); }
    }
  });

  it('동시 만료 응답은 refresh를 한 번 수행하고 회전된 세션을 보존한다', async () => {
    let refreshCalls = 0;
    const apiUrl = await listen((req, res) => {
      if (req.url === '/v1/auth/refresh') {
        refreshCalls += 1;
        expect(req.headers.cookie).toBe('refresh_token=old-refresh');
        res.setHeader('Set-Cookie', ['refresh_token=new-refresh; HttpOnly; Path=/v1/auth', 'unrelated=ignore; Path=/']);
        return json(res, { tokens: { accessToken: 'new-access' } });
      }
      if (req.headers.authorization === 'Bearer old-access') return json(res, { message: 'expired' }, 401);
      expect(req.headers.authorization).toBe('Bearer new-access');
      return json(res, { memberships: [{ householdId: HOUSEHOLD_A }] });
    });
    const client = FamilyApiClient.fromSession({ apiUrl, accessToken: 'old-access', refreshCookie: 'refresh_token=old-refresh' });
    await Promise.all([client.me(), client.me(), client.me()]);
    expect(refreshCalls).toBe(1);
    expect(client.getSessionSnapshot()).toEqual({ accessToken: 'new-access', refreshCookie: 'refresh_token=new-refresh' });
  });

  it('refresh 거부를 재로그인으로 우회하지 않고 인증 오류를 반환한다', async () => {
    const paths: string[] = [];
    const apiUrl = await listen((req, res) => { paths.push(req.url ?? ''); json(res, { message: SECRET }, 401); });
    const client = FamilyApiClient.fromSession({ apiUrl, accessToken: SECRET, refreshCookie: 'refresh_token=fixture-refresh' });
    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(paths).toEqual(['/v1/auth/me', '/v1/auth/refresh']);
  });

  it('응답 제한 시간을 지키고 원시 오류나 깨진 JSON 내용을 출력하지 않는다', async () => {
    const apiUrl = await listen((_req, _res) => undefined);
    const client = FamilyApiClient.fromSession({ apiUrl, accessToken: SECRET, refreshCookie: 'refresh_token=fixture-refresh', timeoutMs: 20 });
    await expect(client.me()).rejects.toMatchObject({ status: 0, networkCode: 'TIMEOUT' });
    const brokenUrl = await listen((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(SECRET); });
    const broken = FamilyApiClient.fromSession({ apiUrl: brokenUrl, accessToken: SECRET, refreshCookie: 'refresh_token=fixture-refresh' });
    await expect(broken.me()).rejects.toBeInstanceOf(ApiError);
    await expect(broken.me()).rejects.not.toThrow(SECRET);
  });

  it('API의 리디렉션을 따라 인증 정보를 다른 경로로 전달하지 않는다', async () => {
    let redirectedCalls = 0;
    const apiUrl = await listen((req, res) => {
      if (req.url === '/redirected') { redirectedCalls += 1; return json(res, {}); }
      res.writeHead(302, { Location: '/redirected' }); res.end();
    });
    const client = FamilyApiClient.fromSession({ apiUrl, accessToken: SECRET, refreshCookie: 'refresh_token=fixture-refresh' });
    await expect(client.me()).rejects.toMatchObject({ status: 0 });
    expect(redirectedCalls).toBe(0);
  });
});
