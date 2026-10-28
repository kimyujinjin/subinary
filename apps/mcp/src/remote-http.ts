import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { authResultSchema, meResponseSchema } from '@family/contracts';

import { ApiError, FamilyApiClient } from './api-client';
import { OAuthError, RemoteAuthStore } from './remote-auth';
import { handleFinanceMcp } from './remote-transport';

/** 원격 서비스의 공개 주소와 내부 API 주소는 운영자가 고정한다. */
export interface RemoteHttpOptions {
  publicUrl: string;
  apiUrl: string;
  store: RemoteAuthStore;
  /** 테스트용 HTTP 쿠키만 허용하며 운영에서는 항상 Secure를 사용한다. */
  secureCookies?: boolean;
  /** Cloudflare→Caddy 전용 내부망에서 Caddy가 덮어쓴 IP 헤더만 신뢰한다. */
  trustProxyClientIp?: boolean;
}

interface BrowserSession {
  csrf: string;
  expiresAt: number;
  userId?: string;
  name?: string;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** 같은 연결의 API refresh 회전을 직렬화한다. 다른 사용자는 기다리지 않는다. */
export class GrantQueue {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly sizes = new Map<string, number>();

  async run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const size = this.sizes.get(key) ?? 0;
    if (size >= 8) throw new HttpError(429, 'slow_down', '조회가 진행 중입니다. 잠시 후 다시 시도하세요.');
    this.sizes.set(key, size + 1);
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.queues.set(key, current);
    await previous;
    try { return await action(); }
    finally {
      release();
      const remaining = (this.sizes.get(key) ?? 1) - 1;
      if (remaining === 0) this.sizes.delete(key); else this.sizes.set(key, remaining);
      if (this.queues.get(key) === current) this.queues.delete(key);
    }
  }
}

/** 원시 인증 정보가 응답·로그·외부 리소스에 노출되지 않도록 HTML을 이스케이프한다. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 가족 가계부</title><style>
  :root{font-family:system-ui,-apple-system,sans-serif;color:#20242a;background:#f5f6f8;color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:48px 20px}main{max-width:480px;margin:auto;background:#fff;border:1px solid #e2e5e9;border-radius:20px;padding:32px}small,.muted{color:#626c78}h1{font-size:26px;letter-spacing:-.7px;line-height:1.35;margin:20px 0 12px}p,li{line-height:1.65}label{display:block;font-size:14px;font-weight:600;margin:20px 0 8px}input{width:100%;border:1px solid #bcc4ce;border-radius:9px;padding:12px;font:inherit}button{font:inherit;font-weight:600;width:100%;padding:13px;border:0;border-radius:10px;background:#2054d3;color:white;cursor:pointer;margin-top:20px}.secondary{background:#eef1f5;color:#344050;margin-top:10px}a{color:#2054d3}ul{padding-left:21px}.note{padding:16px;background:#f1f5fc;border-radius:12px;font-size:14px}.error{padding:12px;background:#fff0f0;color:#9e2434;border-radius:10px}article{padding:16px 0;border-bottom:1px solid #e2e5e9}footer{margin-top:24px;font-size:13px}code{overflow-wrap:anywhere}@media(max-width:480px){body{padding:20px 12px}main{padding:24px 20px}}
  </style><main><small>FAMILY FINANCE</small><h1>${escapeHtml(title)}</h1>${body}<footer><a href="/mcp/connect">연결 안내</a> · <a href="/mcp/connections">연결 관리</a></footer></main></html>`;
}

function securityHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect; frame-ancestors 'none'; base-uri 'none'");
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function html(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page(title, body));
}

function redirect(res: ServerResponse, url: string): void { res.writeHead(303, { Location: url }); res.end(); }

function field(params: URLSearchParams, key: string): string {
  const values = params.getAll(key);
  if (values.length > 1) throw new HttpError(400, 'invalid_request', '중복된 요청 값은 허용하지 않습니다.');
  return values[0] ?? '';
}

async function body(req: IncomingMessage, limit = 65_536): Promise<string> {
  if (Number(req.headers['content-length'] ?? 0) > limit) throw new HttpError(413, 'invalid_request', '요청이 너무 큽니다.');
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    length += bytes.length;
    if (length > limit) throw new HttpError(413, 'invalid_request', '요청이 너무 큽니다.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function cookie(req: IncomingMessage, name: string): string {
  const values = (req.headers.cookie ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : '';
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function credentialsForm(action: string, csrf: string, requestId = '', consent = false): string {
  return `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="request_id" value="${escapeHtml(requestId)}"><label for="email">가계부 이메일</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="320"><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200"><button name="decision" value="allow">${consent ? '로그인하고 읽기 연결 허용' : '로그인하고 연결 확인'}</button>${consent ? '<button class="secondary" name="decision" value="deny" formnovalidate>취소</button>' : ''}</form>`;
}

/** OAuth 연결과 금융 조회만 노출한다. DB 직접 조회 및 모델 API 호출은 하지 않는다. */
export function createRemoteHttpServer(options: RemoteHttpOptions): Server {
  const origin = new URL(options.publicUrl).origin;
  const host = new URL(origin).host;
  const resource = `${origin}/mcp`;
  const store = options.store;
  const queues = new GrantQueue();
  const browserSessions = new Map<string, BrowserSession>();
  const rates = new Map<string, { count: number; expiresAt: number }>();
  const secure = options.secureCookies !== false;

  function setCookie(res: ServerResponse, name: string, value: string, seconds = 600): void {
    res.setHeader('Set-Cookie', `${name}=${value}; Path=/mcp; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
  }

  function browserPost(req: IncomingMessage): void {
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') {
      throw new HttpError(403, 'invalid_request', '같은 가계부 화면에서 요청해 주세요.');
    }
  }

  function rateLimit(req: IncomingMessage, path: string): void {
    const now = Date.now();
    for (const [key, value] of rates) if (value.expiresAt <= now) rates.delete(key);
    const proxyIp = req.headers['x-family-mcp-client-ip'];
    const clientIp = options.trustProxyClientIp && typeof proxyIp === 'string' && isIP(proxyIp) !== 0
      ? proxyIp : req.socket.remoteAddress ?? 'unknown';
    const key = `${path}:${clientIp}`;
    if (!rates.has(key) && rates.size >= 2000) throw new HttpError(429, 'slow_down', '잠시 후 다시 시도하세요.');
    const value = rates.get(key) ?? { count: 0, expiresAt: now + 60_000 };
    value.count += 1; rates.set(key, value);
    const maximum = path.includes('authorize') || path.includes('connections') ? 20 : 120;
    if (value.count > maximum) throw new HttpError(429, 'slow_down', '요청이 많습니다. 1분 후 다시 시도하세요.');
  }

  async function login(email: string, password: string): Promise<{ client: FamilyApiClient; user: { id: string; name: string } }> {
    if (email.length > 320 || password.length > 200 || !email || !password) throw new HttpError(400, 'invalid_request', '이메일과 비밀번호를 입력해 주세요.');
    let response: Response;
    try {
      response = await fetch(`${options.apiUrl}/v1/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
    } catch { throw new HttpError(502, 'temporarily_unavailable', '가계부 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'); }
    if (!response.ok) throw new HttpError(response.status === 401 ? 401 : 502, 'access_denied', '로그인을 확인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.');
    const data = authResultSchema.parse(await response.json());
    const refreshCookie = response.headers.getSetCookie().map((value) => value.split(';')[0]!).find((value) => value.startsWith('refresh_token='));
    if (!refreshCookie) throw new HttpError(502, 'temporarily_unavailable', '가계부 로그인 세션을 확인하지 못했습니다.');
    const client = FamilyApiClient.fromSession({ apiUrl: options.apiUrl, accessToken: data.tokens.accessToken, refreshCookie, timeoutMs: 15_000 });
    try {
      const me = meResponseSchema.parse(await client.me());
      if (me.memberships.length === 0) throw new HttpError(403, 'access_denied', '이 계정에 연결된 가구가 없습니다. 가계부에서 가구를 먼저 연결해 주세요.');
      return { client, user: { id: me.user.id, name: me.user.name } };
    } catch (error) { await logout(client.getSessionSnapshot()); throw error; }
  }

  async function logout(session: { accessToken: string; refreshCookie: string }): Promise<void> {
    try {
      await fetch(`${options.apiUrl}/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, Cookie: session.refreshCookie }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    } catch { /* 연결 철회는 먼저 완료한다. API 장애 중 세션은 자체 만료를 따른다. */ }
  }

  function connectionSession(req: IncomingMessage, csrf?: string): BrowserSession {
    const value = browserSessions.get(cookie(req, 'fma_mcp_manage'));
    if (!value || value.expiresAt <= Date.now() || (csrf !== undefined && !equalSecret(value.csrf, csrf))) {
      throw new HttpError(403, 'invalid_request', '화면이 만료되었습니다. 연결 관리에서 다시 로그인해 주세요.');
    }
    return value;
  }

  function sendConnections(res: ServerResponse, session: BrowserSession): void {
    const grants = store.listGrants(session.userId!);
    const items = grants.filter((grant) => grant.revokedAt === null && grant.expiresAt > Date.now()).map((grant) => `<article><strong>${escapeHtml(grant.clientName)}</strong><p class="muted">금융 내역 읽기 연결</p><form method="post" action="/mcp/connections/revoke"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="grant_id" value="${escapeHtml(grant.id)}"><button class="secondary">이 연결 해제</button></form></article>`).join('');
    html(res, 200, '연결된 금융 도구', `<p>${escapeHtml(session.name ?? '')} 님의 연결입니다.</p>${items || '<p class="note">현재 활성화된 연결이 없습니다.</p>'}<form method="post" action="/mcp/connections/logout"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><button class="secondary">관리 화면 로그아웃</button></form>`);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    securityHeaders(res);
    if (req.headers.host !== host) throw new HttpError(421, 'invalid_request', '허용되지 않은 서버 주소입니다.');
    const url = new URL(req.url ?? '/', origin);
    if (url.origin !== origin) throw new HttpError(400, 'invalid_request', '잘못된 요청 주소입니다.');
    const path = url.pathname;
    const requestOrigin = req.headers.origin;
    if (requestOrigin !== undefined && requestOrigin !== origin && requestOrigin !== 'https://chatgpt.com') throw new HttpError(403, 'invalid_request', '허용되지 않은 요청 출처입니다.');
    if (requestOrigin) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Accept' }); res.end(); return;
    }
    if (req.method === 'GET' && path === '/mcp/health') { json(res, 200, { ok: true, mode: 'finance-readonly' }); return; }
    if (req.method === 'GET' && (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp')) {
      json(res, 200, { resource, authorization_servers: [origin], scopes_supported: ['finance:read'], bearer_methods_supported: ['header'], resource_name: '가족 가계부', resource_documentation: `${origin}/mcp/connect` }); return;
    }
    if (req.method === 'GET' && path === '/.well-known/oauth-authorization-server') {
      json(res, 200, { issuer: origin, authorization_endpoint: `${origin}/mcp/oauth/authorize`, token_endpoint: `${origin}/mcp/oauth/token`, registration_endpoint: `${origin}/mcp/oauth/register`, revocation_endpoint: `${origin}/mcp/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['finance:read'], authorization_response_iss_parameter_supported: true }); return;
    }
    if (req.method === 'GET' && path === '/mcp/connect') {
      html(res, 200, 'Dot에 가계부 연결', `<p>Dot에서 카드 사용액, 남은 용돈, 수집 상태를 바로 물어보세요.</p><ol><li>ChatGPT의 <strong>플러그인 → + → 사용자 지정 MCP 서버 추가</strong>를 엽니다.</li><li>이름은 <strong>가족 가계부</strong>, 서버 주소는 아래 주소를 입력합니다.</li><li>OAuth 인증으로 만들고 설치한 뒤, 가계부 계정으로 로그인해 연결합니다.</li></ol><p class="note"><code>${escapeHtml(resource)}</code></p><p>연결 후 Dot에 “가족 가계부로 이번 달 두 카드 합산 용돈과 파싱 실패 건수를 알려줘”라고 요청하세요.</p><p class="muted">금융 조회 9개 도구만 제공합니다. 비밀번호는 저장하지 않으며, 로그인 세션은 이 가계부 서버에 암호화해 보관합니다. 연결 관리에서 언제든 해제할 수 있습니다.</p>`); return;
    }
    const limitedPaths = new Set(['/mcp', '/mcp/oauth/register', '/mcp/oauth/authorize', '/mcp/oauth/token', '/mcp/oauth/revoke', '/mcp/connections/login', '/mcp/connections/revoke', '/mcp/connections/logout']);
    if (limitedPaths.has(path) && (req.method === 'POST' || path === '/mcp/oauth/authorize')) rateLimit(req, path);
    if (req.method === 'POST' && path === '/mcp/oauth/register') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'invalid_request', 'JSON 요청이 필요합니다.');
      const input: unknown = JSON.parse(await body(req, 16_384));
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_client_metadata', '클라이언트 정보가 올바르지 않습니다.');
      json(res, 201, store.registerClient(input as Parameters<RemoteAuthStore['registerClient']>[0])); return;
    }
    if (req.method === 'GET' && path === '/mcp/oauth/authorize') {
      const pending = store.createAuthorization({ clientId: field(url.searchParams, 'client_id'), redirectUri: field(url.searchParams, 'redirect_uri'), responseType: field(url.searchParams, 'response_type'), codeChallenge: field(url.searchParams, 'code_challenge'), codeChallengeMethod: field(url.searchParams, 'code_challenge_method'), scope: field(url.searchParams, 'scope'), resource: field(url.searchParams, 'resource'), state: field(url.searchParams, 'state') });
      setCookie(res, 'fma_mcp_authorize', pending.requestId);
      html(res, 200, '가계부 읽기 연결', `<p><strong>${escapeHtml(pending.clientName)}</strong>에 이 계정으로 볼 수 있는 가구의 금융 내역 조회를 허용합니다.</p><div class="note">카드 거래 · 월 지출 · 예산과 남은 용돈 · 정기지출 · 문자 수집 상태<br>금액 수정, 분류 변경, 삭제 권한은 포함하지 않습니다.</div>${credentialsForm('/mcp/oauth/authorize', pending.csrfToken, pending.requestId, true)}<p class="muted">비밀번호는 로그인 확인에만 사용합니다. 연결은 최대 30일 동안 유지되며 언제든 해제할 수 있습니다.</p>`); return;
    }
    if (req.method === 'POST' && path === '/mcp/oauth/authorize') {
      browserPost(req);
      const values = new URLSearchParams(await body(req, 16_384));
      const requestId = field(values, 'request_id'); const csrf = field(values, 'csrf');
      if (!requestId || !equalSecret(cookie(req, 'fma_mcp_authorize'), requestId)) throw new HttpError(403, 'invalid_request', '연결 요청을 시작한 브라우저에서 다시 시도해 주세요.');
      store.getAuthorization(requestId, csrf);
      if (field(values, 'decision') === 'deny') {
        const denied = store.denyAuthorization(requestId, csrf);
        const location = new URL(denied.redirectUri); location.searchParams.set('error', 'access_denied'); location.searchParams.set('state', denied.state); location.searchParams.set('iss', origin);
        setCookie(res, 'fma_mcp_authorize', '', 0); redirect(res, location.toString()); return;
      }
      if (field(values, 'decision') !== 'allow') throw new HttpError(400, 'invalid_request', '연결 허용 여부를 선택해 주세요.');
      let authenticated: Awaited<ReturnType<typeof login>>;
      try { authenticated = await login(field(values, 'email'), field(values, 'password')); }
      catch (error) {
        const message = error instanceof HttpError ? error.message : '로그인을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
        html(res, error instanceof HttpError ? error.status : 502, '로그인 확인', `<p class="error">${escapeHtml(message)}</p>${credentialsForm('/mcp/oauth/authorize', csrf, requestId, true)}`); return;
      }
      try {
        const authorized = store.completeAuthorization(requestId, csrf, authenticated.client.getSessionSnapshot(), authenticated.user);
        const location = new URL(authorized.redirectUri); location.searchParams.set('code', authorized.code); location.searchParams.set('state', authorized.state); location.searchParams.set('iss', origin);
        setCookie(res, 'fma_mcp_authorize', '', 0); redirect(res, location.toString()); return;
      } catch (error) { await logout(authenticated.client.getSessionSnapshot()); throw error; }
    }
    if (req.method === 'POST' && (path === '/mcp/oauth/token' || path === '/mcp/oauth/revoke')) {
      if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) throw new HttpError(415, 'invalid_request', '폼 형식 요청이 필요합니다.');
      const values = new URLSearchParams(await body(req, 16_384));
      if (req.headers.authorization || field(values, 'client_secret')) throw new HttpError(400, 'invalid_client', 'PKCE 공개 클라이언트 인증을 사용해 주세요.');
      const clientId = field(values, 'client_id');
      if (path.endsWith('/revoke')) {
        const session = store.revokeToken(field(values, 'token'), clientId); if (session) await logout(session);
        json(res, 200, {}); return;
      }
      const grantType = field(values, 'grant_type');
      const tokens = grantType === 'authorization_code'
        ? store.exchangeCode({ clientId, code: field(values, 'code'), redirectUri: field(values, 'redirect_uri'), codeVerifier: field(values, 'code_verifier'), resource: field(values, 'resource') })
        : grantType === 'refresh_token' ? store.refresh({ clientId, refreshToken: field(values, 'refresh_token'), resource: field(values, 'resource') }) : undefined;
      if (!tokens) throw new HttpError(400, 'unsupported_grant_type', '지원하지 않는 인증 방식입니다.');
      json(res, 200, tokens); return;
    }
    if (req.method === 'GET' && path === '/mcp/connections') {
      for (const [id, session] of browserSessions) if (session.expiresAt <= Date.now()) browserSessions.delete(id);
      const existing = browserSessions.get(cookie(req, 'fma_mcp_manage'));
      if (existing?.userId && existing.expiresAt > Date.now()) { sendConnections(res, existing); return; }
      if (browserSessions.size >= 500) throw new HttpError(429, 'slow_down', '잠시 후 다시 시도하세요.');
      const id = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url');
      browserSessions.set(id, { csrf, expiresAt: Date.now() + 600_000 }); setCookie(res, 'fma_mcp_manage', id);
      html(res, 200, '금융 도구 연결 관리', `<p>가계부 계정으로 로그인하면 연결 목록을 확인하고 해제할 수 있습니다.</p>${credentialsForm('/mcp/connections/login', csrf)}`); return;
    }
    if (req.method === 'POST' && ['/mcp/connections/login', '/mcp/connections/revoke', '/mcp/connections/logout'].includes(path)) {
      browserPost(req); const values = new URLSearchParams(await body(req, 16_384));
      const session = connectionSession(req, field(values, 'csrf'));
      if (path.endsWith('/login')) {
        let result: Awaited<ReturnType<typeof login>>;
        try { result = await login(field(values, 'email'), field(values, 'password')); }
        catch (error) {
          const message = error instanceof HttpError ? error.message : '로그인을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
          html(res, error instanceof HttpError ? error.status : 502, '금융 도구 연결 관리', `<p class="error">${escapeHtml(message)}</p>${credentialsForm('/mcp/connections/login', session.csrf)}`); return;
        }
        await logout(result.client.getSessionSnapshot());
        browserSessions.delete(cookie(req, 'fma_mcp_manage'));
        const id = randomBytes(32).toString('base64url');
        browserSessions.set(id, { csrf: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 600_000, userId: result.user.id, name: result.user.name });
        setCookie(res, 'fma_mcp_manage', id); redirect(res, '/mcp/connections'); return;
      }
      if (!session.userId) throw new HttpError(401, 'access_denied', '먼저 로그인해 주세요.');
      if (path.endsWith('/revoke')) {
        const grantId = field(values, 'grant_id');
        await queues.run(grantId, async () => { const previous = store.revokeGrantForUser(grantId, session.userId!); if (previous) await logout(previous); });
        redirect(res, '/mcp/connections'); return;
      }
      if (path.endsWith('/logout')) { browserSessions.delete(cookie(req, 'fma_mcp_manage')); setCookie(res, 'fma_mcp_manage', '', 0); redirect(res, '/mcp/connections'); return; }
    }
    if (path === '/mcp') {
      const authorization = req.headers.authorization ?? '';
      const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization);
      if (!match) throw new HttpError(401, 'invalid_token', '가계부 연결 로그인이 필요합니다.');
      const token = match[1]!;
      const initial = store.authenticate(token);
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpError(405, 'method_not_allowed', 'POST 요청을 사용하세요.'); }
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'invalid_request', 'JSON 요청이 필요합니다.');
      const input: unknown = JSON.parse(await body(req));
      await queues.run(initial.grantId, async () => {
        const grant = store.authenticate(token);
        const client = FamilyApiClient.fromSession({ apiUrl: options.apiUrl, ...grant.session, timeoutMs: 15_000 });
        let revoked = false;
        try {
          if (input !== null && typeof input === 'object' && 'method' in input && input.method === 'tools/call') {
            try {
              const me = meResponseSchema.parse(await client.me());
              if (me.user.id !== grant.profile.id) throw new ApiError(401, '/v1/auth/me', '다시 연결해 주세요.');
            } catch (error) {
              if (error instanceof ApiError && error.status === 401) {
                store.revokeGrantForUser(grant.grantId, grant.profile.id);
                revoked = true;
                throw new HttpError(401, 'invalid_token', '가계부 로그인이 만료되었습니다. 다시 연결해 주세요.');
              }
              throw new HttpError(502, 'temporarily_unavailable', '가계부 로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.');
            }
          }
          await handleFinanceMcp(req, res, input, client);
        } finally {
          if (!revoked) {
            try { store.updateSession(grant.grantId, client.getSessionSnapshot()); }
            catch (error) { if (!(error instanceof OAuthError && error.error === 'invalid_grant')) throw error; }
          }
        }
      }); return;
    }
    throw new HttpError(404, 'not_found', '요청한 페이지가 없습니다.');
  }

  const server = createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      if (res.headersSent) { if (!res.writableEnded) res.end(); return; }
      let status = 500; let code = 'server_error'; let message = '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
      if (error instanceof HttpError) { status = error.status; code = error.code; message = error.message; }
      else if (error instanceof OAuthError) { status = error.statusCode; code = error.error; message = error.message; }
      else if (error instanceof SyntaxError) { status = 400; code = 'invalid_request'; message = '요청 형식이 올바르지 않습니다.'; }
      if (status === 401) res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="finance:read", error="invalid_token"`);
      if (status === 429) res.setHeader('Retry-After', '60');
      json(res, status, { error: code, error_description: message });
    });
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5000;
  return server;
}
