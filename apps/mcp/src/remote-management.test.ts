import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RemoteAuthStore, type OAuthTokenResponse } from './remote-auth';
import { createRemoteHttpServer } from './remote-http';

const ORIGIN = 'https://finance.example.test';
const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const SECRET = 'synthetic-password-never-display';
const users = {
  a: { id: '11111111-1111-4111-8111-111111111111', name: '본인 사용자', email: 'a@example.test', createdAt: '2026-10-28T00:00:00.000Z' },
  b: { id: '22222222-2222-4222-8222-222222222222', name: '다른 사용자', email: 'b@example.test', createdAt: '2026-10-28T00:00:00.000Z' },
};
type UserKey = keyof typeof users;
interface BrowserForm { cookie: string; csrf: string; source: string }
interface ConnectionFixture { grantId: string; tokens: OAuthTokenResponse }
let backend: Server;
let gateway: Server;
let store: RemoteAuthStore;
let base: string;
let loginCalls = 0;
let logoutCalls = 0;
const sessions = new Map<string, UserKey>();

/** 합성 HTTP 서버를 루프백의 임시 포트에서 시작한다. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('합성 서버 주소가 없습니다.');
  return `http://127.0.0.1:${address.port}`;
}

/** 실제 접속은 루프백으로 제한하며 서비스의 고정 Host 검사를 유지한다. */
function send(path: string, init: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = { host: 'finance.example.test' };
    new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
    const request = httpRequest(`${base}${path}`, { method: init.method ?? 'GET', headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('error', reject);
      response.on('end', () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders }));
      });
    });
    request.once('error', reject);
    request.end(init.body?.toString());
  });
}

/** 실제 브라우저의 동일 출처 폼 POST를 재현한다. */
function form(values: Record<string, string>, cookie?: string, origin = ORIGIN): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams(values) };
}

/** HTML에 숨겨진 식별자를 읽으며 계정 데이터나 토큰은 출력하지 않는다. */
function hidden(source: string, name: string): string {
  const result = new RegExp(`name="${name}" value="([^"]+)"`).exec(source)?.[1];
  if (!result) throw new Error(`합성 폼에 ${name} 필드가 없습니다.`);
  return result;
}

/** 전체 OAuth 경로로 합성 계정의 연결을 생성한다. */
async function createConnection(key: UserKey, name: string): Promise<ConnectionFixture> {
  const registration = await send('/mcp/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK], client_name: name }) });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = await registration.json() as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'finance:read', resource: `${ORIGIN}/mcp` });
  const authorization = await send(`/mcp/oauth/authorize?${params}`);
  const source = await authorization.text();
  const cookie = authorization.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('합성 OAuth 브라우저 쿠키가 없습니다.');
  const confirmed = await send('/mcp/oauth/authorize', form({ csrf: hidden(source, 'csrf'), request_id: hidden(source, 'request_id'), email: users[key].email, password: SECRET, decision: 'allow' }, cookie));
  expect(confirmed.status).toBe(303);
  const location = new URL(confirmed.headers.get('location')!);
  const exchanged = await send('/mcp/oauth/token', form({ grant_type: 'authorization_code', client_id: clientId, code: location.searchParams.get('code')!, redirect_uri: CALLBACK, code_verifier: verifier, resource: `${ORIGIN}/mcp` }));
  expect(exchanged.status).toBe(200);
  const tokens = await exchanged.json() as OAuthTokenResponse;
  return { tokens, grantId: store.authenticate(tokens.access_token).grantId };
}

/** 로그인 전 관리 화면의 브라우저 쿠키와 CSRF를 읽는다. */
async function beginManagement(): Promise<BrowserForm> {
  const response = await send('/mcp/connections');
  expect(response.status).toBe(200);
  const source = await response.text();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('합성 관리 쿠키가 없습니다.');
  return { source, cookie, csrf: hidden(source, 'csrf') };
}

/** 관리 로그인 후 새 쿠키로 연결 목록을 다시 읽는다. */
async function loginManagement(key: UserKey): Promise<BrowserForm> {
  const initial = await beginManagement();
  const response = await send('/mcp/connections/login', form({ csrf: initial.csrf, email: users[key].email, password: SECRET }, initial.cookie));
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/mcp/connections');
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('합성 관리 로그인 쿠키가 없습니다.');
  expect(cookie).not.toBe(initial.cookie);
  const listing = await send('/mcp/connections', { headers: { Cookie: cookie } });
  const source = await listing.text();
  expect(source).not.toContain(SECRET);
  return { cookie, csrf: hidden(source, 'csrf'), source };
}

/** 이전 액세스 토큰의 유효 여부를 실제 MCP 요청으로 확인한다. */
function listTools(token: string): Promise<Response> {
  return send('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
}

beforeEach(async () => {
  loginCalls = 0; logoutCalls = 0; sessions.clear();
  backend = createServer((req, res) => {
    void (async () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/auth/login') {
        loginCalls += 1;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { email?: string; password?: string };
        const key: UserKey | undefined = input.email === users.a.email ? 'a' : input.email === users.b.email ? 'b' : undefined;
        if (!key || input.password !== SECRET) { res.writeHead(401); res.end(JSON.stringify({ message: `${SECRET}: 입력한 비밀번호 ${input.password ?? ''}` })); return; }
        const token = `synthetic-${key}-${loginCalls}`;
        sessions.set(token, key);
        res.setHeader('Set-Cookie', `refresh_token=refresh-${token}; HttpOnly; Path=/v1/auth`);
        res.end(JSON.stringify({ user: users[key], tokens: { accessToken: token, tokenType: 'Bearer', expiresInSec: 900 } })); return;
      }
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (req.url === '/v1/auth/logout') { logoutCalls += 1; sessions.delete(token); res.end('{"success":true}'); return; }
      const key = sessions.get(token);
      if (!key) { res.writeHead(401); res.end('{}'); return; }
      if (req.url === '/v1/auth/me') {
        res.end(JSON.stringify({ user: users[key], memberships: [{ householdId: '33333333-3333-4333-8333-333333333333', name: '합성 가구', role: 'owner', status: 'active' }] })); return;
      }
      res.writeHead(404); res.end('{}');
    })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  const apiUrl = await listen(backend);
  store = new RemoteAuthStore({ databasePath: ':memory:', encryptionKey: randomBytes(32), resource: `${ORIGIN}/mcp`, issuer: ORIGIN, allowedRedirectUris: [CALLBACK] });
  gateway = createRemoteHttpServer({ publicUrl: ORIGIN, apiUrl, store, secureCookies: false });
  base = await listen(gateway);
});

afterEach(async () => {
  for (const server of [gateway, backend]) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  store.close();
});

describe('원격 금융 도구 연결 관리', () => {
  it('로그인→본인 연결 목록→철회 후 이전 액세스 토큰을 거부한다', async () => {
    const own = await createConnection('a', '본인 Dot');
    const other = await createConnection('b', '다른 사람 Dot');
    const manager = await loginManagement('a');
    expect(manager.source).toContain('본인 Dot');
    expect(manager.source).toContain(own.grantId);
    expect(manager.source).not.toContain('다른 사람 Dot');
    expect(manager.source).not.toContain(other.grantId);
    expect((await listTools(own.tokens.access_token)).status).toBe(200);
    const revoked = await send('/mcp/connections/revoke', form({ csrf: manager.csrf, grant_id: own.grantId }, manager.cookie));
    expect(revoked.status).toBe(303);
    expect((await listTools(own.tokens.access_token)).status).toBe(401);
    expect((await listTools(other.tokens.access_token)).status).toBe(200);
    const listing = await send('/mcp/connections', { headers: { Cookie: manager.cookie } });
    expect(await listing.text()).toContain('현재 활성화된 연결이 없습니다.');
    expect(logoutCalls).toBe(2);
  });

  it('다른 사용자 grant ID를 보내도 연결이나 이전 토큰은 철회되지 않는다', async () => {
    const other = await createConnection('b', '다른 사람 Dot');
    const manager = await loginManagement('a');
    const attempted = await send('/mcp/connections/revoke', form({ csrf: manager.csrf, grant_id: other.grantId }, manager.cookie));
    expect(attempted.status).toBe(303);
    expect(store.listGrants(users.b.id)[0]?.revokedAt).toBeNull();
    expect((await listTools(other.tokens.access_token)).status).toBe(200);
    expect(logoutCalls).toBe(1);
  });

  it('관리 로그인에는 정확한 쿠키·CSRF·동일 Origin이 모두 필요하다', async () => {
    const initial = await beginManagement();
    const values = { csrf: initial.csrf, email: users.a.email, password: SECRET };
    expect((await send('/mcp/connections/login', form(values))).status).toBe(403);
    expect((await send('/mcp/connections/login', form(values, 'fma_mcp_manage=forged'))).status).toBe(403);
    expect((await send('/mcp/connections/login', form({ ...values, csrf: 'invalid' }, initial.cookie))).status).toBe(403);
    expect((await send('/mcp/connections/login', form(values, initial.cookie, 'https://chatgpt.com'))).status).toBe(403);
    const missingOrigin = form(values, initial.cookie);
    missingOrigin.headers = { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: initial.cookie };
    expect((await send('/mcp/connections/login', missingOrigin)).status).toBe(403);
    expect(loginCalls).toBe(0);
    expect((await send('/mcp/connections/login', form(values, initial.cookie))).status).toBe(303);
    expect(loginCalls).toBe(1);
  });

  it('로그인 실패 안내에 비밀번호·API 원문을 노출하지 않고 같은 화면에서 재시도할 수 있다', async () => {
    const initial = await beginManagement();
    const denied = await send('/mcp/connections/login', form({ csrf: initial.csrf, email: users.a.email, password: 'invalid-sensitive-password' }, initial.cookie));
    expect(denied.status).toBe(401);
    const message = await denied.text();
    expect(message).toContain('이메일과 비밀번호를 확인');
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('invalid-sensitive-password');
    expect((await send('/mcp/connections/login', form({ csrf: initial.csrf, email: users.a.email, password: SECRET }, initial.cookie))).status).toBe(303);
  });

  it('CSRF·쿠키·Origin이 맞지 않는 철회 요청은 본인 연결도 바꾸지 않는다', async () => {
    const own = await createConnection('a', '본인 Dot');
    const manager = await loginManagement('a');
    const values = { csrf: manager.csrf, grant_id: own.grantId };
    for (const request of [form(values), form({ ...values, csrf: 'invalid' }, manager.cookie), form(values, manager.cookie, 'https://chatgpt.com')]) {
      expect((await send('/mcp/connections/revoke', request)).status).toBe(403);
    }
    expect(store.listGrants(users.a.id)[0]?.revokedAt).toBeNull();
    expect((await listTools(own.tokens.access_token)).status).toBe(200);
    expect(logoutCalls).toBe(1);
  });

  it('관리 로그아웃은 브라우저 세션만 끝내고 기존 Dot 연결은 유지한다', async () => {
    const own = await createConnection('a', '본인 Dot');
    const manager = await loginManagement('a');
    const loggedOut = await send('/mcp/connections/logout', form({ csrf: manager.csrf }, manager.cookie));
    expect(loggedOut.status).toBe(303);
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await send('/mcp/connections/revoke', form({ csrf: manager.csrf, grant_id: own.grantId }, manager.cookie))).status).toBe(403);
    expect((await listTools(own.tokens.access_token)).status).toBe(200);
  });
});
