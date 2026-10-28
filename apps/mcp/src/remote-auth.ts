import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCOPE = 'finance:read' as const;
const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
// 기존 SQLite NOT NULL 스키마를 유지하며 연결·refresh의 무기한 유효성을 나타낸다.
const NO_EXPIRATION = 0;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const MAX_CLIENTS = 1_000;

/** 원격 MCP 전용 저장소 설정이다. 암호화키는 DB와 별도 보관한다. */
export interface RemoteAuthConfig {
  databasePath: string;
  encryptionKey: Buffer;
  resource: string;
  issuer: string;
  allowedRedirectUris: readonly string[];
  now?: () => number;
}

/** 가계부 API 세션은 게이트웨이 내부에서만 사용하고 암호화해 보관한다. */
export interface UpstreamSession {
  accessToken: string;
  refreshCookie: string;
}

/** 로그인 계정의 식별자와 동의 화면에 표시할 이름이다. */
export interface RemoteProfile {
  id: string;
  name: string;
}

/** 외부에 반환할 수 있는 고정 OAuth 오류만 담는다. */
export class OAuthError extends Error {
  constructor(public readonly error: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

/** 동적 등록 시 허용하는 공개 클라이언트 정보다. */
export interface RegisterClientInput {
  redirect_uris: readonly string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
}

/** 클라이언트 비밀키 없이 PKCE를 사용하는 등록 결과다. */
export interface RegisteredClient {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none';
  grant_types: ['authorization_code', 'refresh_token'];
  response_types: ['code'];
  scope: typeof SCOPE;
}

/** 인증 시작 요청이다. 주소·권한·PKCE는 로그인 전에 모두 검사한다. */
export interface CreateAuthorizationInput {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string;
  state?: string;
}

/** 로그인·동의 처리에 필요한 비밀정보 없는 요청 메타데이터다. */
export interface AuthorizationDetails {
  requestId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scope: typeof SCOPE;
  resource: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresAt: number;
}

/** Dot에는 가계부 세션 대신 MCP 범위의 불투명 토큰만 반환한다. */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: typeof SCOPE;
}

/** 인증된 요청의 grant와 서버 내부 API 세션이다. HTTP 응답에 직렬화하지 않는다. */
export interface AuthenticatedGrant {
  grantId: string;
  profile: RemoteProfile;
  session: UpstreamSession;
}

/** 연결 관리 화면에 제공할 비밀정보 없는 메타데이터다. expiresAt이 null이면 고정 만료가 없다. */
export interface GrantSummary {
  id: string;
  clientId: string;
  clientName: string;
  profile: RemoteProfile;
  scope: typeof SCOPE;
  resource: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

interface ClientRow { id: string; name: string; redirects: string; created_at: number }
interface RequestRow {
  id: string; csrf_hash: string; client_id: string; redirect_uri: string;
  code_challenge: string; scope: string; resource: string; state: string;
  expires_at: number; consumed_at: number | null;
}
interface GrantRow {
  id: string; client_id: string; user_id: string; user_name: string; session: string | null;
  scope: string; resource: string; created_at: number; last_used_at: number | null;
  expires_at: number; revoked_at: number | null;
}
interface CodeRow {
  hash: string; grant_id: string; client_id: string; redirect_uri: string;
  code_challenge: string; resource: string; expires_at: number; consumed_at: number | null;
}
interface TokenRow {
  hash: string; grant_id: string; kind: 'access' | 'refresh';
  expires_at: number; consumed_at: number | null;
}

/** 새 연결·refresh의 무기한 값과 기존 데이터의 유한 만료를 함께 판정한다. */
function hasExpired(expiresAt: number, now: number): boolean {
  return expiresAt !== NO_EXPIRATION && expiresAt <= now;
}

/** 원문 토큰은 DB에 쓰지 않고 SHA-256으로만 조회한다. */
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 일정한 길이의 해시를 시간 차이 없이 비교한다. */
function equalHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

/** CSPRNG 256비트 값을 URL 안전 문자로 발급한다. */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** URL 정규화로 allowlist가 넓어지지 않도록 원문과 정확히 비교한다. */
function isSafeUrl(value: string, allowLoopback: boolean): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash &&
      (url.protocol === 'https:' || (allowLoopback && url.protocol === 'http:' &&
        ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)));
  } catch {
    return false;
  }
}

/** API 세션의 제어문자와 과도한 크기를 막고 비밀번호 필드는 저장하지 않는다. */
function validSession(session: UpstreamSession): boolean {
  return typeof session?.accessToken === 'string' && session.accessToken.length > 0 &&
    session.accessToken.length <= 16_384 && typeof session.refreshCookie === 'string' &&
    session.refreshCookie.length > 0 && session.refreshCookie.length <= 8_192 &&
    !/[\r\n\0]/.test(session.accessToken + session.refreshCookie);
}

/**
 * 원격 MCP 전용 OAuth 저장소다. 로컬 로그인 파일이나 기존 API 서명키를 읽지 않는다.
 * SQLite 트랜잭션이 코드·refresh의 단일 소비를 보장하고 API 세션은 AES-GCM으로 암호화한다.
 */
export class RemoteAuthStore {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  private readonly now: () => number;
  private readonly resource: string;
  private readonly issuer: string;
  private readonly redirects: ReadonlySet<string>;

  constructor(config: RemoteAuthConfig) {
    if (!Buffer.isBuffer(config.encryptionKey) || config.encryptionKey.length !== 32 ||
        !isSafeUrl(config.resource, true) || !isSafeUrl(config.issuer, true) ||
        !Array.isArray(config.allowedRedirectUris) || config.allowedRedirectUris.length === 0 ||
        config.allowedRedirectUris.some((uri) => !isSafeUrl(uri, true))) {
      throw new OAuthError('server_error', 500, '원격 인증 설정이 올바르지 않습니다.');
    }
    this.key = Buffer.from(config.encryptionKey);
    this.now = config.now ?? Date.now;
    this.resource = config.resource;
    this.issuer = config.issuer;
    this.redirects = new Set(config.allowedRedirectUris);
    this.prepareFile(config.databasePath);
    this.db = new DatabaseSync(config.databasePath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authorization_requests (
        id TEXT PRIMARY KEY, csrf_hash TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES clients(id),
        redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, scope TEXT NOT NULL,
        resource TEXT NOT NULL, state TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS grants (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id),
        user_id TEXT NOT NULL, user_name TEXT NOT NULL, session TEXT,
        scope TEXT NOT NULL, resource TEXT NOT NULL, created_at INTEGER NOT NULL,
        last_used_at INTEGER, expires_at INTEGER NOT NULL, revoked_at INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authorization_codes (
        hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES grants(id),
        client_id TEXT NOT NULL REFERENCES clients(id), redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL, resource TEXT NOT NULL,
        expires_at INTEGER NOT NULL, consumed_at INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS tokens (
        hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES grants(id),
        kind TEXT NOT NULL CHECK(kind IN ('access','refresh')), expires_at INTEGER NOT NULL, consumed_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS grants_user_idx ON grants(user_id);
      CREATE INDEX IF NOT EXISTS tokens_grant_idx ON tokens(grant_id);
    `);
  }

  /** 명시적으로 허용한 정확한 반환 주소를 사용하는 공개 OAuth 클라이언트만 등록한다. */
  registerClient(input: RegisterClientInput): RegisteredClient {
    if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0 ||
        input.redirect_uris.length > 10 || input.redirect_uris.some((uri) => typeof uri !== 'string' || !this.redirects.has(uri)) ||
        (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== 'none')) {
      throw new OAuthError('invalid_client_metadata', 400, '허용된 반환 주소와 공개 클라이언트 방식을 지정하세요.');
    }
    const name = input.client_name ?? '연결된 AI 도구';
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) {
      throw new OAuthError('invalid_client_metadata', 400, '클라이언트 이름이 올바르지 않습니다.');
    }
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM clients').get() as { count: number };
    if (count.count >= MAX_CLIENTS) throw new OAuthError('temporarily_unavailable', 503, '새 연결 등록 한도에 도달했습니다.');
    const clientId = randomToken();
    const issuedAt = this.now();
    const redirects = [...new Set(input.redirect_uris)];
    this.db.prepare('INSERT INTO clients(id,name,redirects,created_at) VALUES(?,?,?,?)')
      .run(clientId, name.trim(), JSON.stringify(redirects), issuedAt);
    return { client_id: clientId, client_id_issued_at: Math.floor(issuedAt / 1_000), client_name: name.trim(),
      redirect_uris: redirects, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], scope: SCOPE };
  }

  /** 로그인 전에 OAuth 입력을 검사하고 10분 유효한 CSRF 결합 요청을 만든다. */
  createAuthorization(input: CreateAuthorizationInput): { requestId: string; csrfToken: string; clientName: string } {
    const client = this.client(input.clientId);
    const redirects: unknown = JSON.parse(client.redirects);
    if (!Array.isArray(redirects) || !redirects.includes(input.redirectUri) || !this.redirects.has(input.redirectUri)) {
      throw new OAuthError('invalid_request', 400, '등록된 반환 주소와 일치하지 않습니다.');
    }
    if (input.responseType !== 'code') throw new OAuthError('unsupported_response_type', 400, '인증 코드 방식만 지원합니다.');
    this.requireResource(input.resource);
    if (input.scope !== SCOPE) throw new OAuthError('invalid_scope', 400, '가계부 조회 권한만 연결할 수 있습니다.');
    if (input.codeChallengeMethod !== 'S256' || typeof input.codeChallenge !== 'string' || !TOKEN_PATTERN.test(input.codeChallenge)) {
      throw new OAuthError('invalid_request', 400, 'S256 PKCE 검증 값이 필요합니다.');
    }
    if (input.state !== undefined && (typeof input.state !== 'string' || input.state.length > 2_048 || /[\x00-\x1f\x7f]/.test(input.state))) {
      throw new OAuthError('invalid_request', 400, '인증 요청 상태가 올바르지 않습니다.');
    }
    const requestId = randomToken();
    const csrfToken = randomToken();
    this.db.prepare(`INSERT INTO authorization_requests
      (id,csrf_hash,client_id,redirect_uri,code_challenge,scope,resource,state,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(hash(requestId), hash(csrfToken), input.clientId, input.redirectUri,
      input.codeChallenge, SCOPE, this.resource, input.state ?? '', this.now() + REQUEST_TTL_MS);
    return { requestId, csrfToken, clientName: client.name };
  }

  /** 요청과 브라우저 CSRF가 함께 유효할 때만 동의 화면용 데이터를 반환한다. */
  getAuthorization(requestId: string, csrfToken: string): AuthorizationDetails {
    const row = this.request(requestId, csrfToken);
    return { requestId, clientId: row.client_id, clientName: this.client(row.client_id).name,
      redirectUri: row.redirect_uri, scope: SCOPE, resource: row.resource, state: row.state,
      codeChallenge: row.code_challenge, codeChallengeMethod: 'S256', expiresAt: row.expires_at };
  }

  /** 사용자가 직접 로그인하고 동의한 계정 세션에만 일회용 코드를 발급한다. */
  completeAuthorization(requestId: string, csrfToken: string, session: UpstreamSession, profile: RemoteProfile):
      { redirectUri: string; code: string; state: string } {
    this.requireSession(session);
    if (typeof profile?.id !== 'string' || profile.id.length === 0 || profile.id.length > 256 ||
        typeof profile.name !== 'string' || profile.name.length > 256) {
      throw new OAuthError('server_error', 502, '로그인 계정 정보를 확인하지 못했습니다.');
    }
    return this.atomic(() => {
      const row = this.request(requestId, csrfToken);
      const now = this.now();
      const grantId = randomUUID();
      const code = randomToken();
      this.db.prepare(`INSERT INTO grants
        (id,client_id,user_id,user_name,session,scope,resource,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(grantId, row.client_id, profile.id, profile.name,
        this.seal(grantId, session), SCOPE, this.resource, now, NO_EXPIRATION);
      this.db.prepare(`INSERT INTO authorization_codes
        (hash,grant_id,client_id,redirect_uri,code_challenge,resource,expires_at) VALUES(?,?,?,?,?,?,?)`)
        .run(hash(code), grantId, row.client_id, row.redirect_uri, row.code_challenge, this.resource, now + CODE_TTL_MS);
      this.db.prepare('UPDATE authorization_requests SET consumed_at=? WHERE id=?').run(now, row.id);
      return { redirectUri: row.redirect_uri, code, state: row.state };
    });
  }

  /** 거절된 요청은 재사용할 수 없으며 신뢰한 반환 주소만 반환한다. */
  denyAuthorization(requestId: string, csrfToken: string): { redirectUri: string; state: string } {
    return this.atomic(() => {
      const row = this.request(requestId, csrfToken);
      this.db.prepare('UPDATE authorization_requests SET consumed_at=? WHERE id=?').run(this.now(), row.id);
      return { redirectUri: row.redirect_uri, state: row.state };
    });
  }

  /** PKCE·클라이언트·반환 주소·리소스가 일치하는 코드를 한 번만 소비한다. */
  exchangeCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string }): OAuthTokenResponse {
    this.client(input.clientId);
    this.requireResource(input.resource);
    if (typeof input.codeVerifier !== 'string' || !VERIFIER_PATTERN.test(input.codeVerifier) ||
        typeof input.code !== 'string' || !TOKEN_PATTERN.test(input.code)) throw this.invalidGrant();
    const result = this.atomic((): OAuthTokenResponse | null => {
      const code = this.db.prepare('SELECT * FROM authorization_codes WHERE hash=?').get(hash(input.code)) as CodeRow | undefined;
      if (!code || code.client_id !== input.clientId || code.redirect_uri !== input.redirectUri ||
          code.resource !== this.resource || code.expires_at <= this.now()) throw this.invalidGrant();
      const challenge = createHash('sha256').update(input.codeVerifier).digest('base64url');
      if (!equalHash(hash(challenge), hash(code.code_challenge))) throw this.invalidGrant();
      if (code.consumed_at !== null) {
        this.revoke(code.grant_id);
        return null;
      }
      const grant = this.activeGrant(code.grant_id);
      this.db.prepare('UPDATE authorization_codes SET consumed_at=? WHERE hash=?').run(this.now(), code.hash);
      return this.issueTokens(grant);
    });
    if (result === null) throw this.invalidGrant();
    return result;
  }

  /** refresh를 원자적으로 회전하고 소비된 토큰의 재사용은 해당 연결만 철회한다. */
  refresh(input: { refreshToken: string; clientId: string; resource: string }): OAuthTokenResponse {
    this.client(input.clientId);
    this.requireResource(input.resource);
    if (typeof input.refreshToken !== 'string' || !TOKEN_PATTERN.test(input.refreshToken)) throw this.invalidGrant();
    const result = this.atomic((): OAuthTokenResponse | null => {
      const token = this.db.prepare('SELECT * FROM tokens WHERE hash=? AND kind=?').get(hash(input.refreshToken), 'refresh') as TokenRow | undefined;
      if (!token || hasExpired(token.expires_at, this.now())) throw this.invalidGrant();
      const grant = this.activeGrant(token.grant_id);
      if (grant.client_id !== input.clientId || grant.resource !== input.resource) throw this.invalidGrant();
      if (token.consumed_at !== null) {
        this.revoke(grant.id);
        return null;
      }
      this.db.prepare('UPDATE tokens SET consumed_at=? WHERE hash=?').run(this.now(), token.hash);
      return this.issueTokens(grant);
    });
    if (result === null) throw this.invalidGrant();
    return result;
  }

  /** 매 MCP 요청에서 토큰 종류·만료·리소스·grant 철회를 확인한다. */
  authenticate(token: string): AuthenticatedGrant {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw this.invalidToken();
    const row = this.db.prepare('SELECT * FROM tokens WHERE hash=? AND kind=?').get(hash(token), 'access') as TokenRow | undefined;
    if (!row || row.consumed_at !== null || row.expires_at <= this.now()) throw this.invalidToken();
    let grant: GrantRow;
    try { grant = this.activeGrant(row.grant_id); } catch { throw this.invalidToken(); }
    const session = this.unseal(grant);
    this.db.prepare('UPDATE grants SET last_used_at=? WHERE id=?').run(this.now(), grant.id);
    return { grantId: grant.id, profile: { id: grant.user_id, name: grant.user_name }, session };
  }

  /** 서버의 세션 유지 작업에 필요한 활성 무기한 연결 ID만 반환한다. 토큰·세션은 노출하지 않는다. */
  listActivePersistentGrantIds(): string[] {
    const rows = this.db.prepare(`SELECT id FROM grants WHERE expires_at=? AND revoked_at IS NULL
      AND session IS NOT NULL AND resource=? AND scope=? ORDER BY created_at,id`)
      .all(NO_EXPIRATION, this.resource, SCOPE) as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** 서버 내부 유지 작업만 사용하는 세션이다. 토큰을 발급하거나 사용자 최종 사용 시각을 바꾸지 않는다. */
  getGrantForMaintenance(grantId: string): AuthenticatedGrant {
    const grant = this.activeGrant(grantId);
    if (grant.expires_at !== NO_EXPIRATION) throw this.invalidGrant();
    return { grantId: grant.id, profile: { id: grant.user_id, name: grant.user_name }, session: this.unseal(grant) };
  }

  /** 가계부 API refresh 결과를 해당 연결의 암호화 세션에만 반영한다. */
  updateSession(grantId: string, session: UpstreamSession): void {
    this.requireSession(session);
    this.atomic(() => {
      this.activeGrant(grantId);
      this.db.prepare('UPDATE grants SET session=? WHERE id=? AND revoked_at IS NULL').run(this.seal(grantId, session), grantId);
    });
  }

  /** 클라이언트 자신의 토큰으로만 연결을 철회하며 알 수 없는 토큰은 멱등 처리한다. */
  revokeToken(token: string, clientId: string): UpstreamSession | null {
    this.client(clientId);
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    return this.atomic(() => {
      const row = this.db.prepare('SELECT * FROM tokens WHERE hash=?').get(hash(token)) as TokenRow | undefined;
      if (!row) return null;
      const grant = this.db.prepare('SELECT * FROM grants WHERE id=? AND client_id=?').get(row.grant_id, clientId) as GrantRow | undefined;
      if (!grant || grant.revoked_at !== null) return null;
      const session = this.unseal(grant);
      this.revoke(grant.id);
      return session;
    });
  }

  /** 해당 로그인 계정의 연결만 나열하고 토큰·쿠키는 포함하지 않는다. */
  listGrants(userId: string): GrantSummary[] {
    const rows = this.db.prepare(`SELECT g.*, c.name AS client_name FROM grants g
      JOIN clients c ON c.id=g.client_id WHERE g.user_id=? ORDER BY g.created_at DESC`).all(userId) as unknown as Array<GrantRow & { client_name: string }>;
    return rows.map((row) => ({ id: row.id, clientId: row.client_id, clientName: row.client_name,
      profile: { id: row.user_id, name: row.user_name }, scope: SCOPE, resource: row.resource,
      createdAt: row.created_at, lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at === NO_EXPIRATION ? null : row.expires_at, revokedAt: row.revoked_at }));
  }

  /** 본인 소유 연결만 철회하고 API 로그아웃에 쓸 내부 세션을 한 번 반환한다. */
  revokeGrantForUser(grantId: string, userId: string): UpstreamSession | null {
    return this.atomic(() => {
      const row = this.db.prepare('SELECT * FROM grants WHERE id=? AND user_id=?').get(grantId, userId) as GrantRow | undefined;
      if (!row || row.revoked_at !== null) return null;
      const session = this.unseal(row);
      this.revoke(grantId);
      return session;
    });
  }

  /** 저장소를 종료하고 메모리에 복제한 암호화키를 지운다. */
  close(): void {
    this.db.close();
    this.key.fill(0);
  }

  private prepareFile(path: string): void {
    if (path === ':memory:') return;
    if (!isAbsolute(path)) throw new OAuthError('server_error', 500, '인증 저장소는 절대 경로여야 합니다.');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const directory = lstatSync(dirname(path));
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
      throw new OAuthError('server_error', 500, '인증 저장소 디렉터리는 소유자만 접근할 수 있어야 합니다.');
    }
    try { closeSync(openSync(path, 'wx', 0o600)); } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    }
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0 ||
        (process.getuid !== undefined && file.uid !== process.getuid())) {
      throw new OAuthError('server_error', 500, '인증 저장소 파일 권한을 확인하세요.');
    }
  }

  private client(clientId: string): ClientRow {
    if (typeof clientId !== 'string' || !TOKEN_PATTERN.test(clientId)) throw new OAuthError('invalid_client', 401, '등록된 연결을 확인하지 못했습니다.');
    const row = this.db.prepare('SELECT * FROM clients WHERE id=?').get(clientId) as ClientRow | undefined;
    if (!row) throw new OAuthError('invalid_client', 401, '등록된 연결을 확인하지 못했습니다.');
    return row;
  }

  private request(requestId: string, csrfToken: string): RequestRow {
    if (typeof requestId !== 'string' || !TOKEN_PATTERN.test(requestId) || typeof csrfToken !== 'string' || !TOKEN_PATTERN.test(csrfToken)) {
      throw new OAuthError('invalid_request', 400, '연결 요청이 만료되었거나 유효하지 않습니다.');
    }
    const row = this.db.prepare('SELECT * FROM authorization_requests WHERE id=?').get(hash(requestId)) as RequestRow | undefined;
    if (!row || row.consumed_at !== null || row.expires_at <= this.now() || !equalHash(row.csrf_hash, hash(csrfToken)) ||
        row.resource !== this.resource || row.scope !== SCOPE || !this.redirects.has(row.redirect_uri)) {
      throw new OAuthError('invalid_request', 400, '연결 요청이 만료되었거나 유효하지 않습니다.');
    }
    return row;
  }

  private activeGrant(grantId: string): GrantRow {
    const row = this.db.prepare('SELECT * FROM grants WHERE id=?').get(grantId) as GrantRow | undefined;
    if (!row || row.revoked_at !== null || hasExpired(row.expires_at, this.now()) || row.session === null ||
        row.resource !== this.resource || row.scope !== SCOPE) throw this.invalidGrant();
    return row;
  }

  private issueTokens(grant: GrantRow): OAuthTokenResponse {
    const now = this.now();
    const accessExpiresAt = grant.expires_at === NO_EXPIRATION
      ? now + ACCESS_TTL_MS : Math.min(now + ACCESS_TTL_MS, grant.expires_at);
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const insert = this.db.prepare('INSERT INTO tokens(hash,grant_id,kind,expires_at) VALUES(?,?,?,?)');
    insert.run(hash(accessToken), grant.id, 'access', accessExpiresAt);
    insert.run(hash(refreshToken), grant.id, 'refresh', grant.expires_at);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: Math.floor((accessExpiresAt - now) / 1_000),
      refresh_token: refreshToken, scope: SCOPE };
  }

  private revoke(grantId: string): void {
    this.db.prepare('UPDATE grants SET revoked_at=COALESCE(revoked_at,?),session=NULL WHERE id=?').run(this.now(), grantId);
  }

  private seal(grantId: string, session: UpstreamSession): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`family-mcp-session:v1:${grantId}:${this.issuer}:${this.resource}`));
    const data = Buffer.concat([cipher.update(JSON.stringify({ accessToken: session.accessToken, refreshCookie: session.refreshCookie }), 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') });
  }

  private unseal(grant: GrantRow): UpstreamSession {
    try {
      if (grant.session === null) throw new Error('missing');
      const value: unknown = JSON.parse(grant.session);
      if (typeof value !== 'object' || value === null) throw new Error('invalid');
      const sealed = value as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (sealed.v !== 1 || typeof sealed.iv !== 'string' || typeof sealed.tag !== 'string' || typeof sealed.data !== 'string') throw new Error('invalid');
      const iv = Buffer.from(sealed.iv, 'base64url');
      const tag = Buffer.from(sealed.tag, 'base64url');
      if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid');
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(`family-mcp-session:v1:${grant.id}:${this.issuer}:${this.resource}`));
      decipher.setAuthTag(tag);
      const decoded: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64url')), decipher.final()]).toString('utf8'));
      const session = decoded as UpstreamSession;
      if (!validSession(session)) throw new Error('invalid');
      return { accessToken: session.accessToken, refreshCookie: session.refreshCookie };
    } catch {
      throw new OAuthError('server_error', 503, '저장된 연결 정보를 확인하지 못했습니다.');
    }
  }

  private requireResource(resource: string): void {
    if (resource !== this.resource) throw new OAuthError('invalid_target', 400, '가계부 MCP 주소와 일치하지 않습니다.');
  }

  private requireSession(session: UpstreamSession): void {
    if (!validSession(session)) throw new OAuthError('server_error', 502, '로그인 세션 응답을 확인하지 못했습니다.');
  }

  private invalidGrant(): OAuthError {
    return new OAuthError('invalid_grant', 400, '인증이 만료되었거나 유효하지 않습니다. 다시 연결해 주세요.');
  }

  private invalidToken(): OAuthError {
    return new OAuthError('invalid_token', 401, '가계부 연결을 확인하지 못했습니다. 다시 로그인해 주세요.');
  }

  /** 소비 실패를 롤백하되 재사용에 의한 철회는 콜백의 정상 반환으로 커밋한다. */
  private atomic<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
