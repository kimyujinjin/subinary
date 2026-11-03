import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { MeResponse } from '@family/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { RemoteAuthStore, type UpstreamSession } from './remote-auth';
import { GrantQueue } from './remote-http';
import { maintainRemoteSessions } from './remote-session-maintenance';

const ORIGIN = 'https://finance.example.test';
const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const OLD_SESSION: UpstreamSession = {
  accessToken: 'synthetic-old-access-never-expose',
  refreshCookie: 'refresh_token=synthetic-old-refresh-never-expose',
};
const NEW_SESSION: UpstreamSession = {
  accessToken: 'synthetic-renewed-access-never-expose',
  refreshCookie: 'refresh_token=synthetic-renewed-refresh-never-expose',
};
const stores: RemoteAuthStore[] = [];
const servers: Server[] = [];

/** 외부 서비스나 운영 세션을 사용하지 않는 메모리 인증 저장소다. */
function fixture(): RemoteAuthStore {
  const store = new RemoteAuthStore({ databasePath: ':memory:', encryptionKey: randomBytes(32),
    resource: `${ORIGIN}/mcp`, issuer: ORIGIN, allowedRedirectUris: [CALLBACK] });
  stores.push(store);
  return store;
}

/** 실제 동의와 코드 교환으로 유지보수할 연결을 만들며 조회 시각은 기록하지 않는다. */
function connect(store: RemoteAuthStore, session: UpstreamSession = OLD_SESSION, userId = USER): { grantId: string; accessToken: string } {
  const client = store.registerClient({ redirect_uris: [CALLBACK], client_name: '합성 Dot' });
  const verifier = randomBytes(32).toString('base64url');
  const pending = store.createAuthorization({ clientId: client.client_id, redirectUri: CALLBACK,
    responseType: 'code', codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256', scope: 'finance:read', resource: `${ORIGIN}/mcp` });
  const authorization = store.completeAuthorization(pending.requestId, pending.csrfToken, session, { id: userId, name: '합성 사용자' });
  const token = store.exchangeCode({ code: authorization.code, clientId: client.client_id, redirectUri: CALLBACK,
    codeVerifier: verifier, resource: `${ORIGIN}/mcp` });
  const grant = store.listGrants(userId).find((item) => item.clientId === client.client_id);
  if (!grant) throw new Error('검증할 연결이 없습니다.');
  return { grantId: grant.id, accessToken: token.access_token };
}

/** 계약 검증을 통과하는 현재 계정 응답이다. */
function me(userId = USER): MeResponse {
  return { user: { id: userId, name: '합성 사용자', email: 'fixture@example.test', createdAt: '2026-10-28T00:00:00.000Z' }, memberships: [] };
}

/** JSON 응답을 합성 서버에 기록한다. */
function json(res: ServerResponse, value: object, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

/** 실제 fetch가 루프백에서만 요청하도록 합성 API를 연다. */
async function backend(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void): Promise<string> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('합성 서버 주소가 없습니다.');
  return `http://127.0.0.1:${address.port}`;
}

/** 임의 대기 시간 없이 동시 요청의 진입과 재개를 제어한다. */
function gate(): { entered: Promise<void>; enter: () => void; released: Promise<void>; release: () => void } {
  let enter: () => void = () => undefined;
  let release: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return { entered, enter, released, release };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const store of stores.splice(0)) store.close();
});

describe('무기한 원격 연결의 내부 세션 유지보수', () => {
  it('만료된 API access를 갱신하고 회전된 세션을 저장하며 사용자 조회 시각은 바꾸지 않는다', async () => {
    const store = fixture();
    const grant = connect(store);
    const cookies: string[] = [];
    const apiUrl = await backend((req, res) => {
      if (req.url === '/v1/auth/refresh') {
        cookies.push(req.headers.cookie ?? '');
        res.setHeader('Set-Cookie', `${NEW_SESSION.refreshCookie}; HttpOnly; Path=/v1/auth`);
        json(res, { tokens: { accessToken: NEW_SESSION.accessToken } }); return;
      }
      if (req.headers.authorization === `Bearer ${OLD_SESSION.accessToken}`) { json(res, {}, 401); return; }
      json(res, me());
    });

    const result = await maintainRemoteSessions({ store, apiUrl, queue: new GrantQueue() });
    expect(result).toEqual({ checked: 1, revoked: 0, failed: 0, skipped: 0 });
    expect(cookies).toEqual([OLD_SESSION.refreshCookie]);
    expect(store.getGrantForMaintenance(grant.grantId).session).toEqual(NEW_SESSION);
    expect(store.listGrants(USER)[0]?.lastUsedAt).toBeNull();
    expect(Object.values(result).every((value) => typeof value === 'number')).toBe(true);
  });

  it.each(['refresh 거절', '계정 불일치'])('%s이면 연결을 철회하고 토큰과 세션을 되살리지 않는다', async (failure) => {
    const store = fixture();
    const grant = connect(store);
    const apiUrl = await backend((_req, res) => {
      if (failure === 'refresh 거절') { json(res, { message: OLD_SESSION.accessToken }, 401); return; }
      json(res, me(OTHER_USER));
    });

    const result = await maintainRemoteSessions({ store, apiUrl, queue: new GrantQueue() });
    expect(result).toMatchObject({ checked: 0, revoked: 1, failed: 0 });
    expect(store.listActivePersistentGrantIds()).toEqual([]);
    expect(() => store.getGrantForMaintenance(grant.grantId)).toThrow();
    expect(() => store.authenticate(grant.accessToken)).toThrow();
    expect(JSON.stringify(result)).not.toContain(OLD_SESSION.accessToken);
  });

  it('refresh 직후 me가 503이어도 회전된 쿠키를 저장하여 다음 실행에서 사용한다', async () => {
    const store = fixture();
    const grant = connect(store);
    let failMe = true;
    let refreshes = 0;
    const authorizations: string[] = [];
    const apiUrl = await backend((req, res) => {
      if (req.url === '/v1/auth/refresh') {
        refreshes += 1;
        res.setHeader('Set-Cookie', `${NEW_SESSION.refreshCookie}; HttpOnly; Path=/v1/auth`);
        json(res, { tokens: { accessToken: NEW_SESSION.accessToken } }); return;
      }
      const authorization = req.headers.authorization ?? '';
      authorizations.push(authorization);
      if (authorization === `Bearer ${OLD_SESSION.accessToken}`) { json(res, {}, 401); return; }
      if (failMe) { json(res, { message: OLD_SESSION.refreshCookie }, 503); return; }
      json(res, me());
    });
    const queue = new GrantQueue();

    expect(await maintainRemoteSessions({ store, apiUrl, queue })).toMatchObject({ checked: 0, failed: 1, revoked: 0 });
    expect(store.getGrantForMaintenance(grant.grantId).session).toEqual(NEW_SESSION);
    failMe = false;
    expect(await maintainRemoteSessions({ store, apiUrl, queue })).toMatchObject({ checked: 1, failed: 0, revoked: 0 });
    expect(refreshes).toBe(1);
    expect(authorizations).toEqual([`Bearer ${OLD_SESSION.accessToken}`, `Bearer ${NEW_SESSION.accessToken}`, `Bearer ${NEW_SESSION.accessToken}`]);
    expect(store.listGrants(USER)[0]?.lastUsedAt).toBeNull();
  });

  it.each([503, 200])('한 연결의 %i 오류 응답이 있어도 다른 연결은 계속 확인한다', async (status) => {
    const store = fixture();
    const failed = connect(store);
    const healthy = connect(store, NEW_SESSION, OTHER_USER);
    const apiUrl = await backend((req, res) => {
      if (req.headers.authorization === `Bearer ${OLD_SESSION.accessToken}`) {
        json(res, { message: OLD_SESSION.accessToken }, status); return;
      }
      json(res, me(OTHER_USER));
    });

    const result = await maintainRemoteSessions({ store, apiUrl, queue: new GrantQueue() });
    expect(result).toMatchObject({ checked: 1, failed: 1, revoked: 0 });
    expect(store.getGrantForMaintenance(failed.grantId).session).toEqual(OLD_SESSION);
    expect(store.getGrantForMaintenance(healthy.grantId).session).toEqual(NEW_SESSION);
    expect(store.listActivePersistentGrantIds()).toHaveLength(2);
  });

  it('큐를 기다리는 동안 해제된 연결은 다시 읽지 않고 API에도 보내지 않는다', async () => {
    const store = fixture();
    const grant = connect(store);
    let calls = 0;
    const apiUrl = await backend((_req, res) => { calls += 1; json(res, me()); });
    const queue = new GrantQueue();
    const blocked = gate();
    const previous = queue.run(grant.grantId, async () => { blocked.enter(); await blocked.released; });
    await blocked.entered;
    const maintenance = maintainRemoteSessions({ store, apiUrl, queue });
    store.revokeGrantForUser(grant.grantId, USER);
    blocked.release();
    await previous;

    expect(await maintenance).toMatchObject({ checked: 0, skipped: 1, failed: 0 });
    expect(calls).toBe(0);
    expect(store.listActivePersistentGrantIds()).toEqual([]);
  });

  it('동일 큐를 공유한 동시 실행은 앞선 세션 저장 후 조회하여 refresh를 한 번만 소비한다', async () => {
    const store = fixture();
    const grant = connect(store);
    const blocked = gate();
    const events: string[] = [];
    let refreshes = 0;
    const apiUrl = await backend(async (req, res) => {
      if (req.url === '/v1/auth/refresh') {
        refreshes += 1; events.push('refresh');
        res.setHeader('Set-Cookie', `${NEW_SESSION.refreshCookie}; HttpOnly; Path=/v1/auth`);
        json(res, { tokens: { accessToken: NEW_SESSION.accessToken } }); return;
      }
      if (req.headers.authorization === `Bearer ${OLD_SESSION.accessToken}`) {
        events.push('old'); blocked.enter(); await blocked.released; json(res, {}, 401); return;
      }
      events.push('new'); json(res, me());
    });
    const queue = new GrantQueue();
    const first = maintainRemoteSessions({ store, apiUrl, queue });
    await blocked.entered;
    const second = maintainRemoteSessions({ store, apiUrl, queue });
    expect(events).toEqual(['old']);
    blocked.release();
    const results = await Promise.all([first, second]);

    expect(results.map((result) => result.checked)).toEqual([1, 1]);
    expect(refreshes).toBe(1);
    expect(events).toEqual(['old', 'refresh', 'new', 'new']);
    expect(store.getGrantForMaintenance(grant.grantId).session).toEqual(NEW_SESSION);
  });

  it('종료 요청 뒤에는 진행 중인 연결 확인을 마치고 다음 연결을 시작하지 않는다', async () => {
    const store = fixture();
    connect(store);
    connect(store, NEW_SESSION, OTHER_USER);
    let stopped = false;
    let calls = 0;
    const apiUrl = await backend((req, res) => {
      calls += 1;
      stopped = true;
      json(res, me(req.headers.authorization === `Bearer ${OLD_SESSION.accessToken}` ? USER : OTHER_USER));
    });

    const result = await maintainRemoteSessions({ store, apiUrl, queue: new GrantQueue(), shouldStop: () => stopped });
    expect(result.checked).toBe(1);
    expect(calls).toBe(1);
    expect(store.listActivePersistentGrantIds()).toHaveLength(2);
    const stoppedResult = await maintainRemoteSessions({ store, apiUrl, queue: new GrantQueue(), shouldStop: () => true });
    expect(stoppedResult.checked).toBe(0);
    expect(calls).toBe(1);
  });
});
