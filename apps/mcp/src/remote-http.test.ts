import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RemoteAuthStore, type OAuthTokenResponse } from './remote-auth';
import { createRemoteHttpServer, GrantQueue } from './remote-http';

const ORIGIN = 'https://finance.example.test';
const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const USER = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const upstreamToken = 'synthetic-upstream-token-never-expose';
const upstreamRefresh = 'refresh_token=synthetic-refresh-never-expose';
const user = { id: USER, name: '합성 사용자', email: 'fixture@example.test', createdAt: '2026-10-28T00:00:00.000Z' };
let store: RemoteAuthStore;
let gateway: Server;
let backend: Server;
let base: string;
let loginCount = 0;
let upstreamFailure = false;
let upstreamAuthExpired = false;

/** 실제 네트워크 테스트는 합성 서버의 루프백 주소만 사용한다. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('테스트 주소가 없습니다.');
  return `http://127.0.0.1:${address.port}`;
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = { host: 'finance.example.test' };
    new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
    const request = httpRequest(`${base}${path}`, { method: init.method ?? 'GET', headers }, (response) => {
      const chunks: Buffer[] = []; response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders }));
      });
    });
    request.once('error', reject); request.end(init.body?.toString());
  });
}

function form(values: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: new URLSearchParams(values) };
}

/** OAuth 로그인 전 화면의 숨김 필드와 브라우저 결합 쿠키를 추출한다. */
async function startAuthorization(): Promise<{ clientId: string; verifier: string; csrf: string; requestId: string; cookie: string }> {
  const registration = await send('/mcp/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK], client_name: 'ChatGPT', token_endpoint_auth_method: 'none' }) });
  expect(registration.status).toBe(201);
  const client = await registration.json() as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'finance:read', resource: `${ORIGIN}/mcp`, state: 'synthetic-state' });
  const response = await send(`/mcp/oauth/authorize?${params}`);
  expect(response.status).toBe(200);
  const source = await response.text();
  expect(source).toContain('정해진 만료일이 없으며 직접 해제할 때까지 유지');
  expect(source).not.toContain('최대 30일');
  const csrf = /name="csrf" value="([^"]+)"/.exec(source)?.[1];
  const requestId = /name="request_id" value="([^"]+)"/.exec(source)?.[1];
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!csrf || !requestId || !cookie) throw new Error('합성 로그인 요청 생성 실패');
  return { clientId: client.client_id, verifier, csrf, requestId, cookie };
}

async function authorize(): Promise<OAuthTokenResponse & { clientId: string }> {
  const pending = await startAuthorization();
  const request = form({ csrf: pending.csrf, request_id: pending.requestId, email: user.email, password: 'synthetic-password', decision: 'allow' });
  const response = await send('/mcp/oauth/authorize', { ...request, headers: { ...request.headers, Cookie: pending.cookie } });
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get('location')!);
  expect(location.origin + location.pathname).toBe(CALLBACK);
  expect(location.searchParams.get('iss')).toBe(ORIGIN);
  expect(location.searchParams.get('state')).toBe('synthetic-state');
  const token = await send('/mcp/oauth/token', form({ grant_type: 'authorization_code', client_id: pending.clientId, code: location.searchParams.get('code')!, redirect_uri: CALLBACK, code_verifier: pending.verifier, resource: `${ORIGIN}/mcp` }));
  expect(token.status).toBe(200);
  const output = await token.text();
  expect(output).not.toContain(upstreamToken); expect(output).not.toContain('synthetic-password');
  return { ...JSON.parse(output) as OAuthTokenResponse, clientId: pending.clientId };
}

async function mcp(token: string, method: string, params?: object): Promise<Response> {
  return send('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }) });
}

beforeEach(async () => {
  loginCount = 0; upstreamFailure = false; upstreamAuthExpired = false;
  backend = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/auth/login') {
      loginCount += 1;
      res.setHeader('Set-Cookie', `${upstreamRefresh}; HttpOnly; Path=/v1/auth`);
      res.end(JSON.stringify({ user, tokens: { accessToken: upstreamToken, tokenType: 'Bearer', expiresInSec: 900 } })); return;
    }
    if (req.url === '/v1/auth/logout') { res.end('{"success":true}'); return; }
    if (upstreamAuthExpired) { res.writeHead(401); res.end('{"message":"synthetic-session-expired"}'); return; }
    if (req.headers.authorization !== `Bearer ${upstreamToken}`) { res.writeHead(401); res.end('{}'); return; }
    if (req.url === '/v1/auth/me') {
      res.end(JSON.stringify({ user, memberships: [{ householdId: HOUSEHOLD, name: '합성 가구', role: 'owner', status: 'active' }] })); return;
    }
    if (upstreamFailure) { res.writeHead(500); res.end(JSON.stringify({ message: upstreamToken })); return; }
    res.end(JSON.stringify({ asOf: '2026-10-28T01:00:00.000Z', scope: { period: 'all_time', transactions: 'visible_non_excluded', sms: 'own_member' }, transactions: { uncategorized: 1, duplicateSuspected: 0, unlinkedCancellations: 0, cardOwnerMismatches: 0 }, sms: { pending: 0, parseFailed: 0, pendingReview: 0, quarantined: 0, ignored: 0, lastReceivedAt: null } }));
  });
  const apiUrl = await listen(backend);
  store = new RemoteAuthStore({ databasePath: ':memory:', encryptionKey: randomBytes(32), resource: `${ORIGIN}/mcp`, issuer: ORIGIN, allowedRedirectUris: [CALLBACK] });
  gateway = createRemoteHttpServer({ publicUrl: ORIGIN, apiUrl, store, secureCookies: false });
  base = await listen(gateway);
});

afterEach(async () => {
  for (const server of [gateway, backend]) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  store.close();
});

describe('원격 금융 MCP HTTP 인증 통합', () => {
  it('익명 요청에 discovery challenge만 반환하고 메타데이터는 공개한다', async () => {
    const unauthorized = await send('/mcp', { method: 'POST' });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
    const resource = await send('/.well-known/oauth-protected-resource/mcp');
    expect(await resource.json()).toMatchObject({ resource: `${ORIGIN}/mcp`, scopes_supported: ['finance:read'] });
    const auth = await send('/.well-known/oauth-authorization-server');
    expect(await auth.json()).toMatchObject({ code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true });
  });

  it('DCR→브라우저 로그인→PKCE→initialize/list/quality→철회 전체 흐름을 통과한다', async () => {
    const token = await authorize();
    const initialize = await mcp(token.access_token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
    expect(initialize.status).toBe(200);
    const list = await mcp(token.access_token, 'tools/list');
    const listed = await list.json() as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools).toHaveLength(10);
    expect(listed.result.tools.some((tool) => /apply|revert|classify|memory/.test(tool.name))).toBe(false);
    const quality = await mcp(token.access_token, 'tools/call', { name: 'finance_quality', arguments: {} });
    const result = await quality.text();
    expect(result).toContain('"parseFailed":0'); expect(result).not.toContain(upstreamToken);
    expect(loginCount).toBe(1);
    expect((await send('/mcp/oauth/revoke', form({ client_id: token.clientId, token: token.access_token }))).status).toBe(200);
    expect((await mcp(token.access_token, 'tools/list')).status).toBe(401);
  });

  it('허용되지 않은 callback을 로그인 전에 거부한다', async () => {
    const response = await send('/mcp/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example.test/steal'] }) });
    expect(response.status).toBe(400); expect(loginCount).toBe(0);
  });

  it('CSRF·브라우저 쿠키·Origin이 맞아야 로그인 시도를 한다', async () => {
    const pending = await startAuthorization();
    const values = { csrf: pending.csrf, request_id: pending.requestId, email: user.email, password: 'synthetic-password', decision: 'allow' };
    expect((await send('/mcp/oauth/authorize', form(values))).status).toBe(403);
    const request = form(values);
    expect((await send('/mcp/oauth/authorize', { ...request, headers: { ...request.headers, Cookie: pending.cookie, Origin: 'https://evil.example.test' } })).status).toBe(403);
    const badCsrf = form({ ...values, csrf: 'incorrect' });
    expect((await send('/mcp/oauth/authorize', { ...badCsrf, headers: { ...badCsrf.headers, Cookie: pending.cookie } })).status).toBe(400);
    expect(loginCount).toBe(0);
  });

  it('취소 redirect도 issuer와 state를 전달하고 로그인하지 않는다', async () => {
    const pending = await startAuthorization();
    const request = form({ csrf: pending.csrf, request_id: pending.requestId, decision: 'deny' });
    const response = await send('/mcp/oauth/authorize', { ...request, headers: { ...request.headers, Cookie: pending.cookie } });
    const url = new URL(response.headers.get('location')!);
    expect(url.searchParams.get('iss')).toBe(ORIGIN); expect(url.searchParams.get('error')).toBe('access_denied'); expect(loginCount).toBe(0);
  });

  it('원격 토큰을 갱신하고 재사용하면 연결 전체가 철회된다', async () => {
    const token = await authorize();
    const request = form({ grant_type: 'refresh_token', client_id: token.clientId, refresh_token: token.refresh_token, resource: `${ORIGIN}/mcp` });
    const renewed = await send('/mcp/oauth/token', request);
    const next = await renewed.json() as OAuthTokenResponse;
    expect(renewed.status).toBe(200);
    expect((await send('/mcp/oauth/token', request)).status).toBe(400);
    expect((await mcp(next.access_token, 'tools/list')).status).toBe(401);
  });

  it('Host·Origin·본문 크기·잘못된 JSON을 거부한다', async () => {
    expect((await send('/mcp/health', { headers: { Host: 'evil.example.test' } })).status).toBe(421);
    expect((await send('/mcp/health', { headers: { Origin: 'null' } })).status).toBe(403);
    expect((await send('/mcp/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(20_000) })).status).toBe(413);
    expect((await send('/mcp/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400);
  });

  it('API 실패를 0건으로 바꾸거나 원시 비밀정보를 반환하지 않는다', async () => {
    const token = await authorize(); upstreamFailure = true;
    const response = await mcp(token.access_token, 'tools/call', { name: 'finance_quality', arguments: {} });
    const result = await response.text();
    expect(result).toContain('"isError":true'); expect(result).not.toContain(upstreamToken); expect(result).not.toContain('parseFailed');
  });

  it('상위 API 세션이 만료되면 연결을 철회하고 재인증 challenge를 반환한다', async () => {
    const token = await authorize(); upstreamAuthExpired = true;
    const response = await mcp(token.access_token, 'tools/call', { name: 'finance_quality', arguments: {} });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
    expect((await mcp(token.access_token, 'tools/list')).status).toBe(401);
  });

  it('가짜 로그인 경로는 실행하지 않고 OAuth 폼은 정확한 callback만 허용한다', async () => {
    const response = await send('/mcp/connections/another/login', form({ email: user.email, password: 'synthetic-password' }));
    expect(response.status).toBe(404); expect(loginCount).toBe(0);
    const page = await send('/mcp/connections');
    expect(page.headers.get('content-security-policy')).toContain(`form-action 'self' ${CALLBACK};`);
    expect(page.headers.get('content-security-policy')).not.toContain('form-action *');
  });

  it('동일 연결의 작업만 직렬화하며 오류 뒤에도 다음 작업을 수행한다', async () => {
    const queue = new GrantQueue(); const order: string[] = [];
    let resolve: () => void = () => undefined;
    const gate = new Promise<void>((done) => { resolve = done; });
    const a = queue.run('a', async () => { order.push('a-start'); await gate; order.push('a-end'); throw new Error('fixture'); });
    const rejected = expect(a).rejects.toThrow('fixture');
    const b = queue.run('a', async () => { order.push('a-next'); });
    await queue.run('b', async () => { order.push('b'); });
    resolve(); await rejected; await b;
    expect(order).toEqual(['a-start', 'b', 'a-end', 'a-next']);
  });
});
