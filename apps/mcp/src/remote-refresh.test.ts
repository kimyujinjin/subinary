import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { RemoteAuthStore } from './remote-auth';
import { createRemoteHttpServer } from './remote-http';

const ORIGIN = 'https://finance.example.test';
const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const USER = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const OLD_ACCESS = 'synthetic-old-access-never-expose';
const OLD_COOKIE = 'refresh_token=synthetic-old-refresh-never-expose';
const servers: Server[] = [];
const stores: RemoteAuthStore[] = [];
const me = { user: { id: USER, name: '합성 사용자', email: 'fixture@example.test', createdAt: '2026-10-28T00:00:00.000Z' }, memberships: [{ householdId: HOUSEHOLD, name: '합성 가구', role: 'owner', status: 'active' }] };
const quality = { asOf: '2026-10-28T01:00:00.000Z', scope: { period: 'all_time', transactions: 'visible_non_excluded', sms: 'own_member' }, transactions: { uncategorized: 0, duplicateSuspected: 0, unlinkedCancellations: 0, cardOwnerMismatches: 0 }, sms: { pending: 0, parseFailed: 0, pendingReview: 0, quarantined: 0, ignored: 0, lastReceivedAt: null } };

/** 실제 HTTP를 루프백에만 연결한다. */
async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('합성 서버 주소가 없습니다.');
  return `http://127.0.0.1:${address.port}`;
}

/** 동작 순서를 제어할 수 있는 합성 API를 만든다. */
function backend(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void): Server {
  return createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
}

/** 합성 JSON 응답을 작성한다. */
function json(res: ServerResponse, value: object, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
}

/** OAuth 저장소의 공개 메서드로 원격 토큰을 발급하고 실제 게이트웨이에 연결한다. */
async function setup(api: Server): Promise<{ base: string; gateway: Server; store: RemoteAuthStore; token: string }> {
  const apiUrl = await listen(api);
  const store = new RemoteAuthStore({ databasePath: ':memory:', encryptionKey: randomBytes(32), resource: `${ORIGIN}/mcp`, issuer: ORIGIN, allowedRedirectUris: [CALLBACK] });
  stores.push(store);
  const registered = store.registerClient({ redirect_uris: [CALLBACK], client_name: '합성 Dot' });
  const verifier = randomBytes(32).toString('base64url');
  const pending = store.createAuthorization({ clientId: registered.client_id, redirectUri: CALLBACK, responseType: 'code', codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256', scope: 'finance:read', resource: `${ORIGIN}/mcp` });
  const authorized = store.completeAuthorization(pending.requestId, pending.csrfToken, { accessToken: OLD_ACCESS, refreshCookie: OLD_COOKIE }, { id: USER, name: '합성 사용자' });
  const token = store.exchangeCode({ code: authorized.code, clientId: registered.client_id, redirectUri: CALLBACK, codeVerifier: verifier, resource: `${ORIGIN}/mcp` }).access_token;
  const gateway = createRemoteHttpServer({ publicUrl: ORIGIN, apiUrl, store, secureCookies: false });
  return { base: await listen(gateway), gateway, store, token };
}

/** 고정 Host와 MCP 인증 헤더를 실제 전송한다. */
function call(base: string, token: string, id: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/mcp`, { method: 'POST', headers: { Host: 'finance.example.test', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.once('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'finance_quality', arguments: { householdId: HOUSEHOLD } } }));
  });
}

afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const store of stores.splice(0)) store.close();
});

describe('원격 MCP의 회전형 API 세션 보존', () => {
  it('refresh 성공 직후 me가 503이어도 세션을 저장하고 다음 요청에 새 토큰과 쿠키를 사용한다', async () => {
    let refreshCount = 0;
    let failMe = true;
    let expiredFirstRenewal = false;
    const cookies: string[] = [];
    const authorizations: string[] = [];
    const fixture = await setup(backend((req, res) => {
      if (req.url === '/v1/auth/refresh') {
        cookies.push(req.headers.cookie ?? '');
        refreshCount += 1;
        res.setHeader('Set-Cookie', `refresh_token=renewed-${refreshCount}; HttpOnly; Path=/v1/auth`);
        json(res, { tokens: { accessToken: `renewed-access-${refreshCount}` } }); return;
      }
      if (req.url === '/v1/auth/me') {
        const authorization = req.headers.authorization ?? '';
        authorizations.push(authorization);
        if (authorization === `Bearer ${OLD_ACCESS}` || (expiredFirstRenewal && authorization === 'Bearer renewed-access-1')) { json(res, {}, 401); return; }
        if (failMe) { failMe = false; json(res, { message: OLD_ACCESS }, 503); return; }
        json(res, me); return;
      }
      json(res, quality);
    }));

    const failed = await call(fixture.base, fixture.token, 1);
    expect(failed.status).toBe(502);
    expect(failed.body).not.toContain(OLD_ACCESS);
    expect(failed.body).not.toContain('parseFailed');
    expect(fixture.store.authenticate(fixture.token).session).toEqual({ accessToken: 'renewed-access-1', refreshCookie: 'refresh_token=renewed-1' });

    // 다음 요청에서 토큰과 refresh 쿠키가 모두 저장본에서 복원되는지 확인한다.
    expiredFirstRenewal = true;
    const succeeded = await call(fixture.base, fixture.token, 2);
    expect(succeeded.status).toBe(200);
    expect(succeeded.body).toContain('"parseFailed":0');
    expect(authorizations).toEqual([`Bearer ${OLD_ACCESS}`, 'Bearer renewed-access-1', 'Bearer renewed-access-1', 'Bearer renewed-access-2']);
    expect(cookies).toEqual([OLD_COOKIE, 'refresh_token=renewed-1']);
    expect(fixture.store.authenticate(fixture.token).session).toEqual({ accessToken: 'renewed-access-2', refreshCookie: 'refresh_token=renewed-2' });
  });

  it('같은 grant의 동시 HTTP 호출은 앞선 회전·저장 이후에 새 세션으로 처리된다', async () => {
    let releaseFirst: () => void = () => undefined;
    let firstEntered: () => void = () => undefined;
    let secondArrived: () => void = () => undefined;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
    const arrived = new Promise<void>((resolve) => { secondArrived = resolve; });
    const events: string[] = [];
    let refreshCount = 0;
    const fixture = await setup(backend(async (req, res) => {
      if (req.url === '/v1/auth/refresh') {
        events.push('refresh'); refreshCount += 1;
        res.setHeader('Set-Cookie', 'refresh_token=renewed; HttpOnly; Path=/v1/auth');
        json(res, { tokens: { accessToken: 'renewed-access' } }); return;
      }
      if (req.url === '/v1/auth/me') {
        if (req.headers.authorization === `Bearer ${OLD_ACCESS}`) {
          events.push('me-old'); firstEntered(); await release; json(res, {}, 401); return;
        }
        events.push('me-new'); json(res, me); return;
      }
      events.push('quality'); json(res, quality);
    }));
    let requests = 0;
    fixture.gateway.on('request', () => { requests += 1; if (requests === 2) secondArrived(); });

    const first = call(fixture.base, fixture.token, 1);
    await entered;
    const second = call(fixture.base, fixture.token, 2);
    await arrived;
    expect(events).toEqual(['me-old']);
    releaseFirst();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.every((response) => response.body.includes('"parseFailed":0'))).toBe(true);
    expect(refreshCount).toBe(1);
    expect(events).toEqual(['me-old', 'refresh', 'me-new', 'quality', 'me-new', 'quality']);
    expect(fixture.store.authenticate(fixture.token).session).toEqual({ accessToken: 'renewed-access', refreshCookie: 'refresh_token=renewed' });
  });
});
