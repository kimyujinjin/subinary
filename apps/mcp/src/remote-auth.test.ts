import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OAuthError, RemoteAuthStore, type CreateAuthorizationInput,
  type OAuthTokenResponse, type RegisteredClient, type RemoteAuthConfig,
} from './remote-auth';

const RESOURCE = 'https://family.example/mcp';
const ISSUER = 'https://family.example';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const OTHER_REDIRECT = 'http://127.0.0.1:54321/callback';
const KEY = randomBytes(32);
const VERIFIER = 'a'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const API_ACCESS = 'upstream-access-secret';
const API_REFRESH = 'refresh_token=upstream-refresh-secret';
const SESSION = { accessToken: API_ACCESS, refreshCookie: API_REFRESH };
const PROFILE = { id: 'user-one', name: '본인' };
const stores: RemoteAuthStore[] = [];
const directories: string[] = [];

/** 외부 API나 운영 인증을 쓰지 않는 격리 SQLite 저장소를 만든다. */
function fixture(overrides: Partial<RemoteAuthConfig> = {}): {
  store: RemoteAuthStore; config: RemoteAuthConfig; advance: (ms: number) => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'fma-remote-auth-'));
  directories.push(dir);
  let now = Date.UTC(2026, 9, 28);
  const config: RemoteAuthConfig = { databasePath: join(dir, 'auth.sqlite'), encryptionKey: KEY,
    resource: RESOURCE, issuer: ISSUER, allowedRedirectUris: [REDIRECT, OTHER_REDIRECT], now: () => now, ...overrides };
  const store = new RemoteAuthStore(config);
  stores.push(store);
  return { store, config, advance: (ms) => { now += ms; } };
}

/** 공개 클라이언트를 등록하고 표준 인증 입력을 준비한다. */
function authorization(store: RemoteAuthStore, overrides: Partial<CreateAuthorizationInput> = {}): {
  client: RegisteredClient; input: CreateAuthorizationInput; requestId: string; csrfToken: string;
} {
  const client = store.registerClient({ redirect_uris: [REDIRECT, OTHER_REDIRECT], client_name: 'Dot' });
  const input = { clientId: client.client_id, redirectUri: REDIRECT, responseType: 'code',
    codeChallenge: CHALLENGE, codeChallengeMethod: 'S256', scope: 'finance:read', resource: RESOURCE, state: 'opaque-state', ...overrides };
  return { client, input, ...store.createAuthorization(input) };
}

/** 동의 및 코드 교환을 통과한 합성 연결을 발급한다. */
function connected(store: RemoteAuthStore, profile = PROFILE): {
  tokens: OAuthTokenResponse; client: RegisteredClient; code: string;
} {
  const auth = authorization(store);
  const done = store.completeAuthorization(auth.requestId, auth.csrfToken, SESSION, profile);
  const tokens = store.exchangeCode({ code: done.code, clientId: auth.client.client_id, redirectUri: REDIRECT,
    codeVerifier: VERIFIER, resource: RESOURCE });
  return { tokens, client: auth.client, code: done.code };
}

/** 오류 본문에 토큰이나 내부 예외가 섞이지 않는지 함께 확인한다. */
function expectOAuth(action: () => unknown, error: string, status?: number): void {
  try {
    action();
    expect.fail('OAuth 오류가 필요합니다.');
  } catch (caught: unknown) {
    expect(caught).toBeInstanceOf(OAuthError);
    const failure = caught as OAuthError;
    expect(failure.error).toBe(error);
    if (status !== undefined) expect(failure.statusCode).toBe(status);
    expect(failure.message).not.toContain(API_ACCESS);
    expect(failure.message).not.toContain(API_REFRESH);
  }
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.close(); } catch { /* 이미 닫힌 재시작 검증 저장소는 정리만 마친다. */ }
  }
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('원격 MCP OAuth 저장소', () => {
  it('사용자가 동의한 세션으로만 코드와 별도 조회 토큰을 발급한다', () => {
    const { store, config } = fixture();
    const auth = authorization(store);
    expect(auth.client).toMatchObject({ token_endpoint_auth_method: 'none', scope: 'finance:read' });
    expect(store.getAuthorization(auth.requestId, auth.csrfToken)).toMatchObject({ clientName: 'Dot', state: 'opaque-state', resource: RESOURCE });
    const done = store.completeAuthorization(auth.requestId, auth.csrfToken, SESSION, PROFILE);
    expect(done.redirectUri).toBe(REDIRECT);
    const token = store.exchangeCode({ code: done.code, clientId: auth.client.client_id,
      redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE });
    expect(token).toMatchObject({ token_type: 'Bearer', scope: 'finance:read', expires_in: 3_600 });
    const actor = store.authenticate(token.access_token);
    expect(actor.profile).toEqual(PROFILE);
    expect(actor.session).toEqual(SESSION);
    expectOAuth(() => store.authenticate(token.refresh_token), 'invalid_token', 401);
    expectOAuth(() => store.authenticate(API_ACCESS), 'invalid_token', 401);
    const db = new DatabaseSync(config.databasePath);
    expect(db.prepare('SELECT expires_at FROM grants WHERE id=?').get(actor.grantId)?.expires_at).toBe(0);
    expect(db.prepare("SELECT expires_at FROM tokens WHERE grant_id=? AND kind='refresh'").get(actor.grantId)?.expires_at).toBe(0);
    const dump = JSON.stringify(['grants', 'tokens', 'authorization_codes', 'authorization_requests'].map((table) => db.prepare(`SELECT * FROM ${table}`).all()));
    db.close();
    for (const secret of [API_ACCESS, API_REFRESH, token.access_token, token.refresh_token, done.code, auth.csrfToken, auth.requestId]) {
      expect(dump).not.toContain(secret);
    }
    expect(JSON.stringify(store.listGrants(PROFILE.id))).not.toContain(API_ACCESS);
    expect(store.listGrants(PROFILE.id)[0]?.expiresAt).toBeNull();
    expect(store.listGrants('another-user')).toEqual([]);
    expect(statSync(config.databasePath).mode & 0o777).toBe(0o600);
  });

  it('저장소를 다시 열어도 연결을 유지하고 API 세션 갱신은 암호화한다', () => {
    const { store, config } = fixture();
    const { tokens } = connected(store);
    const actor = store.authenticate(tokens.access_token);
    store.updateSession(actor.grantId, { accessToken: 'replacement-access', refreshCookie: 'refresh_token=replacement-refresh' });
    store.close();
    const reopened = new RemoteAuthStore(config);
    stores.push(reopened);
    expect(reopened.authenticate(tokens.access_token).session.accessToken).toBe('replacement-access');
    expect(readFileSync(config.databasePath).toString()).not.toContain('replacement-access');
  });

  it('내부 유지 작업은 활성 무기한 연결만 읽고 사용자 사용 시각과 토큰을 바꾸지 않는다', () => {
    const { store, config, advance } = fixture();
    const persistent = connected(store);
    const finite = connected(store);
    const revoked = connected(store);
    const grants = store.listGrants(PROFILE.id);
    const persistentGrant = grants.find((grant) => grant.clientId === persistent.client.client_id);
    const finiteGrant = grants.find((grant) => grant.clientId === finite.client.client_id);
    const revokedGrant = grants.find((grant) => grant.clientId === revoked.client.client_id);
    if (!persistentGrant || !finiteGrant || !revokedGrant) throw new Error('검증할 연결이 필요합니다.');
    store.revokeGrantForUser(revokedGrant.id, PROFILE.id);
    const db = new DatabaseSync(config.databasePath);
    db.prepare('UPDATE grants SET expires_at=? WHERE id=?').run(finiteGrant.createdAt + 30 * 24 * 60 * 60_000, finiteGrant.id);
    const tokensBefore = db.prepare('SELECT * FROM tokens ORDER BY hash').all();
    advance(60 * 60_000);
    expect(store.listActivePersistentGrantIds()).toEqual([persistentGrant.id]);
    expect(store.getGrantForMaintenance(persistentGrant.id)).toEqual({ grantId: persistentGrant.id, profile: PROFILE, session: SESSION });
    expect(store.listGrants(PROFILE.id).find((grant) => grant.id === persistentGrant.id)?.lastUsedAt).toBeNull();
    expect(db.prepare('SELECT * FROM tokens ORDER BY hash').all()).toEqual(tokensBefore);
    db.close();
    expectOAuth(() => store.getGrantForMaintenance(finiteGrant.id), 'invalid_grant');
    expectOAuth(() => store.getGrantForMaintenance(revokedGrant.id), 'invalid_grant');
    expectOAuth(() => store.getGrantForMaintenance('unknown'), 'invalid_grant');
  });

  it.each([
    { redirect_uris: ['https://chatgpt.com.attacker.invalid/connector_platform_oauth_redirect'] },
    { redirect_uris: [`${REDIRECT}?next=evil`] },
    { redirect_uris: [`${REDIRECT}#fragment`] },
    { redirect_uris: [] },
    { redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post' },
    { redirect_uris: [REDIRECT], client_name: '<name>\nsecret' },
  ])('등록된 정확한 반환 주소와 공개 클라이언트만 허용한다: %j', (input) => {
    const { store } = fixture();
    expectOAuth(() => store.registerClient(input), 'invalid_client_metadata', 400);
  });

  it.each([
    { input: { resource: `${RESOURCE}/` }, error: 'invalid_target' },
    { input: { scope: 'finance:read finance:write' }, error: 'invalid_scope' },
    { input: { scope: '' }, error: 'invalid_scope' },
    { input: { responseType: 'token' }, error: 'unsupported_response_type' },
    { input: { codeChallengeMethod: 'plain' }, error: 'invalid_request' },
    { input: { codeChallenge: 'short' }, error: 'invalid_request' },
    { input: { redirectUri: 'https://attacker.invalid/callback' }, error: 'invalid_request' },
    { input: { state: 'x'.repeat(2_049) }, error: 'invalid_request' },
  ])('로그인 전에 권한·대상·PKCE를 검사한다: $error', ({ input, error }) => {
    const { store } = fixture();
    expectOAuth(() => authorization(store, input), error, 400);
  });

  it('브라우저 CSRF가 다르거나 10분 지난 요청으로 로그인·동의를 완료할 수 없다', () => {
    const { store, advance } = fixture();
    const auth = authorization(store);
    expectOAuth(() => store.getAuthorization(auth.requestId, randomBytes(32).toString('base64url')), 'invalid_request');
    expectOAuth(() => store.completeAuthorization(auth.requestId, '', SESSION, PROFILE), 'invalid_request');
    advance(10 * 60_000);
    expectOAuth(() => store.getAuthorization(auth.requestId, auth.csrfToken), 'invalid_request');
    expectOAuth(() => store.completeAuthorization(auth.requestId, auth.csrfToken, SESSION, PROFILE), 'invalid_request');
    expect(store.listGrants(PROFILE.id)).toEqual([]);
  });

  it('거절한 요청이나 완료한 요청을 다시 승인할 수 없다', () => {
    const { store } = fixture();
    const denied = authorization(store);
    expect(store.denyAuthorization(denied.requestId, denied.csrfToken)).toEqual({ redirectUri: REDIRECT, state: 'opaque-state' });
    expectOAuth(() => store.completeAuthorization(denied.requestId, denied.csrfToken, SESSION, PROFILE), 'invalid_request');
    const accepted = authorization(store);
    store.completeAuthorization(accepted.requestId, accepted.csrfToken, SESSION, PROFILE);
    expectOAuth(() => store.completeAuthorization(accepted.requestId, accepted.csrfToken, SESSION, PROFILE), 'invalid_request');
  });

  it('잘못된 PKCE·client·redirect·resource는 코드를 소비하지 않는다', () => {
    const { store } = fixture();
    const auth = authorization(store);
    const code = store.completeAuthorization(auth.requestId, auth.csrfToken, SESSION, PROFILE).code;
    const other = store.registerClient({ redirect_uris: [REDIRECT] });
    const input = { code, clientId: auth.client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE };
    expectOAuth(() => store.exchangeCode({ ...input, codeVerifier: 'b'.repeat(64) }), 'invalid_grant');
    expectOAuth(() => store.exchangeCode({ ...input, clientId: other.client_id }), 'invalid_grant');
    expectOAuth(() => store.exchangeCode({ ...input, redirectUri: OTHER_REDIRECT }), 'invalid_grant');
    expectOAuth(() => store.exchangeCode({ ...input, resource: ISSUER }), 'invalid_target');
    expect(store.authenticate(store.exchangeCode(input).access_token).profile).toEqual(PROFILE);
  });

  it('코드는 5분 뒤 만료되고 재사용은 해당 연결의 발급 토큰을 철회한다', () => {
    const { store, advance } = fixture();
    const auth = authorization(store);
    const code = store.completeAuthorization(auth.requestId, auth.csrfToken, SESSION, PROFILE).code;
    advance(5 * 60_000);
    expectOAuth(() => store.exchangeCode({ code, clientId: auth.client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE }), 'invalid_grant');
    const a = connected(store);
    const b = connected(store);
    expectOAuth(() => store.exchangeCode({ code: a.code, clientId: a.client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE }), 'invalid_grant');
    expectOAuth(() => store.authenticate(a.tokens.access_token), 'invalid_token');
    expect(store.authenticate(b.tokens.access_token).profile).toEqual(PROFILE);
  });

  it('API 세션 형식 오류로는 요청을 소비하거나 비밀 필드를 저장하지 않는다', () => {
    const { store } = fixture();
    const auth = authorization(store);
    expectOAuth(() => store.completeAuthorization(auth.requestId, auth.csrfToken, { ...SESSION, refreshCookie: 'unsafe\r\ncookie' }, PROFILE), 'server_error');
    expectOAuth(() => store.completeAuthorization(auth.requestId, auth.csrfToken, SESSION, { id: '', name: '' }), 'server_error');
    expect(store.getAuthorization(auth.requestId, auth.csrfToken).clientId).toBe(auth.client.client_id);
  });

  it('access 만료 후 refresh를 회전하고 재사용이면 그 연결만 끊는다', () => {
    const { store, advance } = fixture();
    const a = connected(store);
    const b = connected(store);
    advance(60 * 60_000);
    expectOAuth(() => store.authenticate(a.tokens.access_token), 'invalid_token');
    const refreshed = store.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE });
    expect(refreshed.refresh_token).not.toBe(a.tokens.refresh_token);
    expect(store.authenticate(refreshed.access_token).profile).toEqual(PROFILE);
    expectOAuth(() => store.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE }), 'invalid_grant');
    expectOAuth(() => store.authenticate(refreshed.access_token), 'invalid_token');
    expectOAuth(() => store.refresh({ refreshToken: refreshed.refresh_token, clientId: a.client.client_id, resource: RESOURCE }), 'invalid_grant');
    expect(store.refresh({ refreshToken: b.tokens.refresh_token, clientId: b.client.client_id, resource: RESOURCE }).access_token).toBeTruthy();
  });

  it('다른 클라이언트·다른 resource·access 토큰으로는 refresh를 소비할 수 없다', () => {
    const { store } = fixture();
    const a = connected(store);
    const b = connected(store);
    const input = { refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE };
    expectOAuth(() => store.refresh({ ...input, clientId: b.client.client_id }), 'invalid_grant');
    expectOAuth(() => store.refresh({ ...input, resource: `${RESOURCE}/other` }), 'invalid_target');
    expectOAuth(() => store.refresh({ ...input, refreshToken: a.tokens.access_token }), 'invalid_grant');
    expect(store.refresh(input).scope).toBe('finance:read');
  });

  it('새 연결은 30일과 여러 해가 지나도 재시작 후 refresh로 조회를 계속한다', () => {
    const { store, config, advance } = fixture();
    const a = connected(store);
    advance(31 * 24 * 60 * 60_000);
    expectOAuth(() => store.authenticate(a.tokens.access_token), 'invalid_token');
    const afterMonth = store.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE });
    expect(afterMonth.expires_in).toBe(3_600);
    expect(store.authenticate(afterMonth.access_token).session).toEqual(SESSION);
    advance(10 * 365 * 24 * 60 * 60_000);
    store.close();
    const reopened = new RemoteAuthStore(config);
    stores.push(reopened);
    expectOAuth(() => reopened.authenticate(afterMonth.access_token), 'invalid_token');
    const afterYears = reopened.refresh({ refreshToken: afterMonth.refresh_token, clientId: a.client.client_id, resource: RESOURCE });
    expect(afterYears.expires_in).toBe(3_600);
    expect(reopened.authenticate(afterYears.access_token).profile).toEqual(PROFILE);
    expect(reopened.listGrants(PROFILE.id)[0]?.expiresAt).toBeNull();
    advance(60 * 60_000);
    expectOAuth(() => reopened.authenticate(afterYears.access_token), 'invalid_token');
  });

  it('무기한 refresh도 장기간 뒤 소비된 토큰을 재사용하면 해당 연결만 철회한다', () => {
    const { store, advance } = fixture();
    const a = connected(store);
    const b = connected(store);
    const refreshed = store.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE });
    advance(365 * 24 * 60 * 60_000);
    const afterYear = store.refresh({ refreshToken: refreshed.refresh_token, clientId: a.client.client_id, resource: RESOURCE });
    expectOAuth(() => store.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE }), 'invalid_grant');
    expectOAuth(() => store.authenticate(afterYear.access_token), 'invalid_token');
    expectOAuth(() => store.refresh({ refreshToken: afterYear.refresh_token, clientId: a.client.client_id, resource: RESOURCE }), 'invalid_grant');
    const unaffected = store.refresh({ refreshToken: b.tokens.refresh_token, clientId: b.client.client_id, resource: RESOURCE });
    expect(store.authenticate(unaffected.access_token).profile).toEqual(PROFILE);
  });

  it('장기간 유지된 무기한 연결도 사용자가 해제하면 access와 refresh를 즉시 거부한다', () => {
    const { store, advance } = fixture();
    const a = connected(store);
    const grantId = store.authenticate(a.tokens.access_token).grantId;
    advance(365 * 24 * 60 * 60_000);
    const refreshed = store.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE });
    expect(store.revokeGrantForUser(grantId, PROFILE.id)).toEqual(SESSION);
    expectOAuth(() => store.authenticate(refreshed.access_token), 'invalid_token');
    expectOAuth(() => store.refresh({ refreshToken: refreshed.refresh_token, clientId: a.client.client_id, resource: RESOURCE }), 'invalid_grant');
    expect(store.listGrants(PROFILE.id)[0]).toMatchObject({ expiresAt: null, revokedAt: expect.any(Number) });
  });

  it('기존 유한 만료 연결은 재시작과 refresh 회전에도 최초 30일 기한을 유지한다', () => {
    const { store, config, advance } = fixture();
    const a = connected(store);
    const grant = store.listGrants(PROFILE.id)[0];
    expect(grant).toBeDefined();
    if (!grant) throw new Error('검증할 연결이 필요합니다.');
    const expiresAt = grant.createdAt + 30 * 24 * 60 * 60_000;
    const db = new DatabaseSync(config.databasePath);
    db.prepare('UPDATE grants SET expires_at=? WHERE id=?').run(expiresAt, grant.id);
    db.prepare("UPDATE tokens SET expires_at=? WHERE grant_id=? AND kind='refresh'").run(expiresAt, grant.id);
    db.close();
    store.close();
    const reopened = new RemoteAuthStore(config);
    stores.push(reopened);
    expect(reopened.listGrants(PROFILE.id)[0]?.expiresAt).toBe(expiresAt);
    advance(30 * 24 * 60 * 60_000 - 30_000);
    const nearEnd = reopened.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE });
    expect(nearEnd.expires_in).toBe(30);
    expect(reopened.authenticate(nearEnd.access_token).profile).toEqual(PROFILE);
    advance(30_000);
    expectOAuth(() => reopened.authenticate(nearEnd.access_token), 'invalid_token');
    expectOAuth(() => reopened.refresh({ refreshToken: nearEnd.refresh_token, clientId: a.client.client_id, resource: RESOURCE }), 'invalid_grant');
    expectOAuth(() => reopened.updateSession(grant.id, SESSION), 'invalid_grant');
  });

  it('기존 유한 만료 refresh는 연결이 무기한이어도 자체 기한에 만료된다', () => {
    const { store, config, advance } = fixture();
    const a = connected(store);
    const grant = store.listGrants(PROFILE.id)[0];
    expect(grant).toBeDefined();
    if (!grant) throw new Error('검증할 연결이 필요합니다.');
    const db = new DatabaseSync(config.databasePath);
    db.prepare("UPDATE tokens SET expires_at=? WHERE grant_id=? AND kind='refresh'").run(grant.createdAt + 30_000, grant.id);
    db.close();
    advance(30_000);
    expectOAuth(() => store.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE }), 'invalid_grant');
    expect(store.authenticate(a.tokens.access_token).profile).toEqual(PROFILE);
  });

  it('다른 계정이나 클라이언트는 연결 철회·목록 조회에 관여할 수 없다', () => {
    const { store } = fixture();
    const a = connected(store);
    const b = connected(store, { id: 'spouse', name: '배우자' });
    const actor = store.authenticate(a.tokens.access_token);
    expect(store.listGrants('spouse')).toHaveLength(1);
    expect(store.listGrants('spouse')[0]?.profile.id).toBe('spouse');
    expect(store.revokeGrantForUser(actor.grantId, 'spouse')).toBeNull();
    expect(store.revokeToken(a.tokens.refresh_token, b.client.client_id)).toBeNull();
    expect(store.authenticate(a.tokens.access_token).profile).toEqual(PROFILE);
    expect(store.revokeGrantForUser(actor.grantId, PROFILE.id)).toEqual(SESSION);
    expect(store.revokeGrantForUser(actor.grantId, PROFILE.id)).toBeNull();
    expectOAuth(() => store.authenticate(a.tokens.access_token), 'invalid_token');
    expectOAuth(() => store.updateSession(actor.grantId, SESSION), 'invalid_grant');
    expect(store.authenticate(b.tokens.access_token).profile.id).toBe('spouse');
  });

  it('토큰 철회는 연결을 즉시 끊고 API 로그아웃용 세션을 한 번만 반환한다', () => {
    const { store } = fixture();
    const a = connected(store);
    expect(store.revokeToken('unknown', a.client.client_id)).toBeNull();
    expect(store.revokeToken(a.tokens.refresh_token, a.client.client_id)).toEqual(SESSION);
    expect(store.revokeToken(a.tokens.access_token, a.client.client_id)).toBeNull();
    expectOAuth(() => store.authenticate(a.tokens.access_token), 'invalid_token');
    expectOAuth(() => store.refresh({ refreshToken: a.tokens.refresh_token, clientId: a.client.client_id, resource: RESOURCE }), 'invalid_grant');
  });

  it('토큰 발급 중 저장 오류가 나면 코드 소비를 원자적으로 롤백한다', () => {
    const { store, config } = fixture();
    const auth = authorization(store);
    const code = store.completeAuthorization(auth.requestId, auth.csrfToken, SESSION, PROFILE).code;
    const db = new DatabaseSync(config.databasePath);
    db.exec("CREATE TRIGGER test_failure BEFORE INSERT ON tokens BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    const input = { code, clientId: auth.client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE };
    expect(() => store.exchangeCode(input)).toThrow();
    expect(db.prepare('SELECT consumed_at FROM authorization_codes').get()?.consumed_at).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM tokens').get()?.count).toBe(0);
    db.exec('DROP TRIGGER test_failure');
    db.close();
    expect(store.authenticate(store.exchangeCode(input).access_token).profile).toEqual(PROFILE);
  });

  it('다른 grant의 암호문을 교체하거나 잘못된 키를 쓰면 복호화를 거부한다', () => {
    const { store, config } = fixture();
    const a = connected(store);
    const b = connected(store);
    const first = store.authenticate(a.tokens.access_token);
    const second = store.authenticate(b.tokens.access_token);
    const db = new DatabaseSync(config.databasePath);
    db.prepare('UPDATE grants SET session=(SELECT session FROM grants WHERE id=?) WHERE id=?').run(first.grantId, second.grantId);
    db.close();
    expectOAuth(() => store.authenticate(b.tokens.access_token), 'server_error', 503);
    store.close();
    const wrongKey = new RemoteAuthStore({ ...config, encryptionKey: randomBytes(32) });
    stores.push(wrongKey);
    expectOAuth(() => wrongKey.authenticate(a.tokens.access_token), 'server_error', 503);
  });

  it('SQLite 연결이 두 개여도 같은 코드를 중복 교환할 수 없다', () => {
    const { store, config } = fixture();
    const auth = authorization(store);
    const code = store.completeAuthorization(auth.requestId, auth.csrfToken, SESSION, PROFILE).code;
    const second = new RemoteAuthStore(config);
    stores.push(second);
    const input = { code, clientId: auth.client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE };
    const issued = store.exchangeCode(input);
    expectOAuth(() => second.exchangeCode(input), 'invalid_grant');
    expectOAuth(() => store.authenticate(issued.access_token), 'invalid_token');
  });

  it('취약한 파일 권한이나 심볼릭 링크 저장소를 거부한다', () => {
    const { store, config } = fixture();
    store.close();
    chmodSync(config.databasePath, 0o644);
    expectOAuth(() => new RemoteAuthStore(config), 'server_error');
    chmodSync(config.databasePath, 0o600);
    const link = join(dirname(config.databasePath), 'link.sqlite');
    symlinkSync(config.databasePath, link);
    expectOAuth(() => new RemoteAuthStore({ ...config, databasePath: link }), 'server_error');
  });

  it('빈 키·잘못된 issuer·평문 외부 callback 설정을 거부한다', () => {
    const base = { databasePath: ':memory:', encryptionKey: KEY, resource: RESOURCE, issuer: ISSUER, allowedRedirectUris: [REDIRECT] };
    expectOAuth(() => new RemoteAuthStore({ ...base, encryptionKey: Buffer.alloc(31) }), 'server_error');
    expectOAuth(() => new RemoteAuthStore({ ...base, issuer: 'http://untrusted.invalid' }), 'server_error');
    expectOAuth(() => new RemoteAuthStore({ ...base, allowedRedirectUris: ['http://untrusted.invalid/callback'] }), 'server_error');
  });
});
