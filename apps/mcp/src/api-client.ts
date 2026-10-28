import type {
  AuthResult,
  MeResponse,
  MemoryCreateRequest,
  MemoryListResponse,
  MemorySummary,
  MonthlyAnalytics,
  RetrievalResponse,
  SlackWorkspaceSummary,
  TimelineResponse,
  WorkQueryResponse,
} from '@family/contracts';

import type { McpConfig } from './config';
import {
  budgetListResponseSchema,
  categoryBreakdownSchema,
  categorySummarySchema,
  recategorizeBatchListSchema,
  recategorizePreviewSchema,
  recategorizeResponseSchema,
  recategorizeRevertResponseSchema,
  transactionListResponseSchema,
  transactionSummarySchema,
  financeQualitySchema,
  recurringSeriesListResponseSchema,
  recurringUpcomingResponseSchema,
  type RecategorizeRequest,
  type RecategorizePreview,
  type RecategorizeResponse,
  type RecategorizeRevertResponse,
  type RecategorizeBatchList,
  type BudgetListResponse,
  type CategoryBreakdown,
  type CategorySummary,
  type TransactionListResponse,
  type TransactionSummary,
  type TransactionStatus,
  type FinanceQuality,
  type RecurringSeriesListResponse,
  type RecurringUpcomingResponse,
} from '@family/contracts';

/**
 * HTTP client for the Family Memory API (Phase 10 spec §2.3).
 *
 * All MCP tools call the API through this client — never the database directly.
 * Authorization/ownership is enforced by the API (the logged-in user may only
 * touch data they own), so the tools inherit those guarantees for free.
 *
 * Auth flow: `login()` exchanges email+password for a short-lived access token
 * (kept in memory) plus an HttpOnly refresh cookie (managed manually here, since
 * Node's fetch has no cookie jar). `authedFetch` sends `Authorization: Bearer`
 * (+ the refresh cookie); on a 401 it refreshes once and retries.
 *
 * SECRETS: the access token, refresh cookie, and password are never logged.
 */

/** `DELETE /v1/memory/memories/:id` result (mirrors the API's MemoryDeleteResult). */
export interface MemoryDeleteResult {
  deleted: true;
}

/** 주소·인증 값 없이 공개할 수 있는 네트워크 오류 분류다. */
export type ApiNetworkCode =
  | 'ENOTFOUND' | 'EAI_AGAIN' | 'EPERM' | 'EACCES' | 'ECONNREFUSED'
  | 'ECONNRESET' | 'ENETUNREACH' | 'EHOSTUNREACH' | 'EPIPE'
  | 'TIMEOUT' | 'TLS' | 'ABORTED' | 'SOCKET';

/** API 오류에서 별도로 전달할 수 있는 안전한 진단 값이다. */
export interface ApiErrorDiagnostics {
  networkCode?: ApiNetworkCode;
  reason?: 'HOUSEHOLD_NOT_FOUND';
}

const NETWORK_CODE_MAP: ReadonlyMap<string, ApiNetworkCode> = new Map([
  ['ENOTFOUND', 'ENOTFOUND'], ['EAI_AGAIN', 'EAI_AGAIN'], ['EPERM', 'EPERM'], ['EACCES', 'EACCES'],
  ['ECONNREFUSED', 'ECONNREFUSED'], ['ECONNRESET', 'ECONNRESET'], ['ENETUNREACH', 'ENETUNREACH'],
  ['EHOSTUNREACH', 'EHOSTUNREACH'], ['EPIPE', 'EPIPE'], ['ETIMEDOUT', 'TIMEOUT'],
  ['UND_ERR_CONNECT_TIMEOUT', 'TIMEOUT'], ['UND_ERR_HEADERS_TIMEOUT', 'TIMEOUT'], ['UND_ERR_BODY_TIMEOUT', 'TIMEOUT'],
  ['ABORT_ERR', 'ABORTED'], ['UND_ERR_ABORTED', 'ABORTED'], ['UND_ERR_SOCKET', 'SOCKET'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS'], ['CERT_HAS_EXPIRED', 'TLS'], ['DEPTH_ZERO_SELF_SIGNED_CERT', 'TLS'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS'], ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS'],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'TLS'], ['ERR_SSL_WRONG_VERSION_NUMBER', 'TLS'],
]);

/** 중첩 cause·AggregateError에서 허용한 코드만 추출하며 순환·과도한 깊이를 제한한다. */
export function extractApiNetworkCode(error: unknown): ApiNetworkCode | undefined {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  for (let count = 0; pending.length > 0 && count < 32; count += 1) {
    const value = pending.shift();
    if (typeof value !== 'object' || value === null || visited.has(value)) continue;
    visited.add(value);
    const candidate = value as { code?: unknown; cause?: unknown; errors?: unknown; name?: unknown };
    if (typeof candidate.code === 'string') {
      const code = NETWORK_CODE_MAP.get(candidate.code);
      if (code !== undefined) return code;
    }
    if (candidate.name === 'TimeoutError') return 'TIMEOUT';
    if (candidate.name === 'AbortError') return 'ABORTED';
    if (candidate.cause !== undefined) pending.push(candidate.cause);
    if (Array.isArray(candidate.errors)) pending.push(...candidate.errors.slice(0, 32));
  }
  return undefined;
}

/** HTTP 상태와 안전한 진단을 보존하며 원시 네트워크 오류를 외부로 전달하지 않는다. */
export class ApiError extends Error {
  readonly networkCode?: ApiNetworkCode;
  readonly reason?: ApiErrorDiagnostics['reason'];

  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
    diagnostics: ApiErrorDiagnostics = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.networkCode = diagnostics.networkCode;
    this.reason = diagnostics.reason;
  }
}

type QueryParams = Record<string, string | number | undefined>;

/** 서버의 공개범위를 유지하는 거래 검색 조건. 원문 문자 조회는 포함하지 않는다. */
export interface FinanceTransactionQuery {
  householdId: string;
  memberId?: string;
  cardId?: string;
  type?: 'approval' | 'cancellation';
  status?: TransactionStatus;
  categoryId?: string;
  from?: string;
  to?: string;
  q?: string;
  attribution?: 'shared';
  limit?: number;
  cursor?: string;
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: QueryParams;
}

/** 신뢰된 연결 계층이 보관하는 FMA 세션이다. 도구 결과나 로그에 포함하지 않는다. */
export interface FamilyApiSessionSnapshot {
  accessToken: string;
  /** Cookie 헤더 형식의 `refresh_token=...` 값이다. */
  refreshCookie: string;
}

/** 원격 연결 계층에서 검증한 세션으로 요청별 API 클라이언트를 만든다. */
export interface FamilyApiSessionOptions extends FamilyApiSessionSnapshot {
  apiUrl: string;
  timeoutMs?: number;
}

interface SessionClientConfig {
  apiUrl: string;
  session: FamilyApiSessionSnapshot;
  timeoutMs: number;
}

export class FamilyApiClient {
  private readonly baseUrl: string;
  private readonly localConfig: McpConfig | null;
  private readonly requestTimeoutMs: number | undefined;
  private refreshPending: Promise<void> | null = null;
  /** In-memory access token (never persisted, never logged). */
  private accessToken: string | null = null;
  /** Manual cookie jar (name -> value); holds the refresh cookie. */
  private readonly cookies = new Map<string, string>();
  /** Cached auto-resolved defaults (only when derived from lookup, not args). */
  private cachedWorkspaceId: string | null = null;
  private cachedHouseholdId: string | null = null;

  /** 기존 로컬 설정 또는 fromSession이 검증한 내부 세션 설정을 받는다. */
  constructor(config: McpConfig | SessionClientConfig) {
    this.baseUrl = config.apiUrl;
    if ('session' in config) {
      this.localConfig = null;
      this.requestTimeoutMs = config.timeoutMs;
      this.accessToken = config.session.accessToken;
      this.cookies.set('refresh_token', config.session.refreshCookie.slice('refresh_token='.length));
    } else {
      this.localConfig = config;
    }
  }

  /** 비밀번호를 받지 않고, 인증 계층이 검증한 FMA 세션만 요청별로 주입한다. */
  static fromSession(options: FamilyApiSessionOptions): FamilyApiClient {
    let url: URL;
    try { url = new URL(options.apiUrl); }
    catch { throw new Error('API 연결 주소 형식이 올바르지 않습니다.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('API 연결 주소 형식이 올바르지 않습니다.');
    }
    const tokenPattern = /^[^\s;,\u0000-\u001f\u007f]+$/;
    if (!options.accessToken || options.accessToken.length > 16384 || !tokenPattern.test(options.accessToken)
      || !options.refreshCookie.startsWith('refresh_token=')
      || options.refreshCookie.length > 16384
      || !tokenPattern.test(options.refreshCookie.slice('refresh_token='.length))) {
      throw new Error('유효한 API 세션이 필요합니다. 다시 연결하세요.');
    }
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new Error('API 요청 제한 시간은 1~60000밀리초여야 합니다.');
    }
    return new FamilyApiClient({
      apiUrl: url.toString().replace(/\/$/, ''),
      session: { accessToken: options.accessToken, refreshCookie: options.refreshCookie },
      timeoutMs,
    });
  }

  /** 갱신된 세션을 신뢰된 연결 저장소에 돌려준다. 반환값을 사용자에게 출력하지 않는다. */
  getSessionSnapshot(): FamilyApiSessionSnapshot {
    const refreshToken = this.cookies.get('refresh_token');
    if (!this.accessToken || !refreshToken) throw new Error('저장할 API 세션이 없습니다. 다시 연결하세요.');
    return { accessToken: this.accessToken, refreshCookie: `refresh_token=${refreshToken}` };
  }

  /* ---------------------------------------------------------------------- */
  /* Auth                                                                    */
  /* ---------------------------------------------------------------------- */

  /** Log in with the configured credentials; stores access token + refresh cookie. */
  async login(): Promise<void> {
    if (!this.localConfig) throw new Error('원격 세션은 비밀번호 로그인을 사용할 수 없습니다. 다시 연결하세요.');
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: this.localConfig.email,
          password: this.localConfig.password,
        }),
      });
    } catch (err) {
      throw new ApiError(
        0,
        '/v1/auth/login',
        'API 서버에 연결할 수 없습니다.',
        { networkCode: extractApiNetworkCode(err) },
      );
    }
    if (!res.ok) {
      throw new ApiError(
        res.status,
        '/v1/auth/login',
        await this.safeErrorMessage(res),
      );
    }
    const data = (await res.json()) as AuthResult;
    this.accessToken = data.tokens.accessToken;
    this.storeCookies(res);
  }

  /** Rotate the refresh cookie and obtain a fresh access token. */
  private async refresh(): Promise<void> {
    const headers: Record<string, string> = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;

    const res = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers,
      ...(this.requestTimeoutMs === undefined ? {} : { signal: AbortSignal.timeout(this.requestTimeoutMs) }),
      ...(this.localConfig === null ? { redirect: 'error' as const } : {}),
    });
    if (!res.ok) {
      throw new ApiError(
        res.status,
        '/v1/auth/refresh',
        '세션이 만료되었습니다. 자격 증명을 확인하고 다시 시도하세요.',
      );
    }
    const data = (await res.json()) as AuthResult;
    if (this.localConfig === null && (typeof data?.tokens?.accessToken !== 'string' || !data.tokens.accessToken)) {
      throw new ApiError(502, '/v1/auth/refresh', 'API 인증 응답을 확인하지 못했습니다. 다시 연결하세요.');
    }
    this.accessToken = data.tokens.accessToken;
    this.storeCookies(res);
  }

  /** 같은 요청에서 병렬로 만료를 발견해도 회전형 refresh 쿠키를 한 번만 사용한다. */
  private async refreshOnce(): Promise<void> {
    if (!this.refreshPending) {
      this.refreshPending = this.refresh().finally(() => { this.refreshPending = null; });
    }
    await this.refreshPending;
  }

  /* ---------------------------------------------------------------------- */
  /* Core request                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Authenticated request. Sends Bearer token (+ refresh cookie); on 401 it
   * refreshes once and retries. Throws {@link ApiError} on any non-2xx result.
   */
  private async authedFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
    const url = this.buildUrl(path, opts.query);

    const run = (): Promise<Response> => {
      const headers: Record<string, string> = {};
      if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
      const cookie = this.cookieHeader();
      // 원격 조회에는 access token만 보내고 refresh 쿠키는 갱신 경로에만 사용한다.
      if (cookie && this.localConfig !== null) headers.cookie = cookie;
      let body: string | undefined;
      if (opts.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
      return fetch(url, {
        method: opts.method ?? 'GET', headers, body,
        ...(this.requestTimeoutMs === undefined ? {} : { signal: AbortSignal.timeout(this.requestTimeoutMs) }),
        ...(this.localConfig === null ? { redirect: 'error' as const } : {}),
      });
    };

    let res: Response;
    try {
      const attemptedToken = this.accessToken;
      res = await run();
      if (res.status === 401) {
        // 병렬 요청이 이미 갱신했다면 최신 토큰으로 한 번만 재시도한다.
        if (this.accessToken === attemptedToken) await this.refreshOnce();
        res = await run();
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(0, path, 'API 요청에 실패했습니다.', { networkCode: extractApiNetworkCode(err) });
    }

    if (!res.ok) {
      throw new ApiError(res.status, path, await this.safeErrorMessage(res));
    }
    if (res.status === 204) {
      return undefined as T;
    }
    try { return (await res.json()) as T; }
    catch (error: unknown) {
      if (this.localConfig !== null) throw error;
      throw new ApiError(0, path, 'API 응답을 확인하지 못했습니다. 다시 조회하세요.', { networkCode: extractApiNetworkCode(error) });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Domain methods (spec §1 tool ↔ API mapping)                             */
  /* ---------------------------------------------------------------------- */

  /** POST /v1/ai/work-query — grounded answer + citations (or refusal). */
  workQuery(input: {
    workspaceId: string;
    question: string;
  }): Promise<WorkQueryResponse> {
    return this.authedFetch<WorkQueryResponse>('/v1/ai/work-query', {
      method: 'POST',
      body: input,
    });
  }

  /** POST /v1/ai/retrieval — ranked chunks (snippet + citation). */
  retrieve(input: {
    workspaceId: string;
    query: string;
    topK?: number;
  }): Promise<RetrievalResponse> {
    return this.authedFetch<RetrievalResponse>('/v1/ai/retrieval', {
      method: 'POST',
      body: input,
    });
  }

  /** POST /v1/memory/memories — directly create an approved memory. */
  createMemory(input: MemoryCreateRequest): Promise<MemorySummary> {
    return this.authedFetch<MemorySummary>('/v1/memory/memories', {
      method: 'POST',
      body: input,
    });
  }

  /** DELETE /v1/memory/memories/:id — soft-delete a memory. */
  deleteMemory(memoryId: string): Promise<MemoryDeleteResult> {
    return this.authedFetch<MemoryDeleteResult>(
      `/v1/memory/memories/${encodeURIComponent(memoryId)}`,
      { method: 'DELETE' },
    );
  }

  /** GET /v1/graph/timeline — relationship history for an entity (validFrom asc). */
  graphTimeline(input: {
    workspaceId: string;
    entityId: string;
  }): Promise<TimelineResponse> {
    return this.authedFetch<TimelineResponse>('/v1/graph/timeline', {
      query: { workspaceId: input.workspaceId, entityId: input.entityId },
    });
  }

  /** GET /v1/memory/memories — a workspace's memories (optionally current only). */
  listMemories(input: {
    workspaceId: string;
    current?: boolean;
  }): Promise<MemoryListResponse> {
    return this.authedFetch<MemoryListResponse>('/v1/memory/memories', {
      query: {
        workspaceId: input.workspaceId,
        current: input.current ? 'true' : undefined,
      },
    });
  }

  /** GET /v1/analytics/monthly — net spend + previous-period delta. */
  monthly(input: {
    householdId: string;
    month?: string;
  }): Promise<MonthlyAnalytics> {
    return this.authedFetch<MonthlyAnalytics>('/v1/analytics/monthly', {
      query: { householdId: input.householdId, month: input.month },
    });
  }

  /** GET /v1/slack/workspaces — the caller's own Slack workspaces. */
  listWorkspaces(): Promise<SlackWorkspaceSummary[]> {
    return this.authedFetch<SlackWorkspaceSummary[]>('/v1/slack/workspaces');
  }

  /** GET /v1/auth/me — current user + active memberships. */
  me(): Promise<MeResponse> {
    return this.authedFetch<MeResponse>('/v1/auth/me');
  }

  /** 선택월의 예산·사용액을 조회한다. 모델 API를 호출하지 않는다. */
  async budgets(householdId: string, month?: string): Promise<BudgetListResponse> {
    return budgetListResponseSchema.parse(await this.authedFetch<unknown>('/v1/budgets', { query: { householdId, month } }));
  }

  /** 선택월의 카테고리별 순지출을 조회한다. */
  async categorySpending(householdId: string, month?: string): Promise<CategoryBreakdown> {
    return categoryBreakdownSchema.parse(await this.authedFetch<unknown>('/v1/analytics/categories', { query: { householdId, month } }));
  }

  /** 거래 공개범위와 본인 문자 수집 범위를 구분한 전 기간 검토 현황. */
  async financeQuality(householdId: string): Promise<FinanceQuality> {
    return financeQualitySchema.parse(await this.authedFetch<unknown>('/v1/analytics/quality', { query: { householdId } }));
  }

  /** 사용자 판단과 마지막 계산 시각을 보존하는 정기지출 목록을 조회한다. */
  async recurringSeries(householdId: string): Promise<RecurringSeriesListResponse> {
    return recurringSeriesListResponseSchema.parse(await this.authedFetch<unknown>('/v1/recurring/series', { query: { householdId } }));
  }

  /** 명시한 시각까지의 확정 정기지출 예상치를 조회한다. 실제 청구액을 뜻하지 않는다. */
  async recurringUpcoming(householdId: string, until: string): Promise<RecurringUpcomingResponse> {
    return recurringUpcomingResponseSchema.parse(await this.authedFetch<unknown>('/v1/recurring/upcoming', { query: { householdId, until } }));
  }

  /** 검색 결과와 다음 페이지 커서를 함께 반환한다. */
  async transactions(input: FinanceTransactionQuery): Promise<TransactionListResponse> {
    return transactionListResponseSchema.parse(await this.authedFetch<unknown>('/v1/transactions', { query: { ...input } }));
  }

  /** 사용 가능한 분류 ID를 조회한다. */
  async categories(householdId: string): Promise<CategorySummary[]> {
    return categorySummarySchema.array().parse(await this.authedFetch<unknown>('/v1/categories', { query: { householdId } }));
  }

  /** 과거 거래 재분류의 건수·금액·예산 영향을 미리 확인한다. */
  async recategorizePreview(input: Omit<RecategorizeRequest, 'expectedCount'>): Promise<RecategorizePreview> {
    return recategorizePreviewSchema.parse(await this.authedFetch<unknown>('/v1/transactions/recategorize/preview', { query: { ...input } }));
  }

  /** 미리 확인한 건수에 한해 과거 거래를 재분류한다. 향후 규칙은 변경하지 않는다. */
  async recategorize(input: RecategorizeRequest): Promise<RecategorizeResponse> {
    return recategorizeResponseSchema.parse(await this.authedFetch<unknown>('/v1/transactions/recategorize', { method: 'POST', body: input }));
  }

  /** 결과가 불명일 때도 재전송 전에 확인할 수정 이력. */
  async recategorizeHistory(householdId: string): Promise<RecategorizeBatchList> {
    return recategorizeBatchListSchema.parse(await this.authedFetch<unknown>('/v1/transactions/recategorize/batches', { query: { householdId } }));
  }

  /** 이후 사용자 수정을 보존하는 기존 되돌리기 API를 호출한다. */
  async recategorizeRevert(batchId: string): Promise<RecategorizeRevertResponse> {
    return recategorizeRevertResponseSchema.parse(await this.authedFetch<unknown>(`/v1/transactions/recategorize/${encodeURIComponent(batchId)}/revert`, { method: 'POST' }));
  }

  /** 거래를 재조회해 분류 적용과 공개범위를 확인한다. */
  async transaction(id: string): Promise<TransactionSummary> {
    return transactionSummarySchema.parse(await this.authedFetch<unknown>(`/v1/transactions/${encodeURIComponent(id)}`));
  }

  /** 분류와 명시적으로 선택한 향후 규칙만 수정한다. 금액·소유자 수정은 노출하지 않는다. */
  async classifyTransaction(id: string, categoryId: string, applyRule: boolean, expectedCategoryId: string | null): Promise<TransactionSummary> {
    return transactionSummarySchema.parse(await this.authedFetch<unknown>(`/v1/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { categoryId, applyRule, expectedCategoryId } }));
  }

  /* ---------------------------------------------------------------------- */
  /* Default resolution (spec §1: arg ?? env ?? auto)                        */
  /* ---------------------------------------------------------------------- */

  /**
   * Resolve the workspace scope id (workspaces.id). Precedence:
   * explicit arg → `FAMILY_WORKSPACE_ID` → first Slack workspace's `workspaceId`.
   * Throws a clear error when none can be determined.
   */
  async resolveWorkspaceId(arg?: string): Promise<string> {
    if (arg && arg.trim() !== '') return arg;
    if (this.localConfig?.workspaceId) return this.localConfig.workspaceId;
    if (this.cachedWorkspaceId) return this.cachedWorkspaceId;

    const workspaces = await this.listWorkspaces();
    const first = workspaces[0];
    if (!first) {
      throw new ApiError(
        0,
        '/v1/slack/workspaces',
        '워크스페이스를 찾을 수 없습니다. FAMILY_WORKSPACE_ID를 지정하거나 먼저 Slack 워크스페이스를 만드세요.',
      );
    }
    // The RAG/memory/graph scope is `workspaces.id`, exposed as `workspaceId`
    // on the summary (NOT the `id`, which is slack_workspaces.id).
    this.cachedWorkspaceId = first.workspaceId;
    return first.workspaceId;
  }

  /**
   * Resolve the household id. Precedence:
   * explicit arg → `FAMILY_HOUSEHOLD_ID` → first membership's `householdId`.
   * Throws a clear error when none can be determined.
   */
  async resolveHouseholdId(arg?: string): Promise<string> {
    if (arg && arg.trim() !== '') return arg;
    if (this.localConfig?.householdId) return this.localConfig.householdId;
    if (this.cachedHouseholdId) return this.cachedHouseholdId;

    const me = await this.me();
    const first = me.memberships[0];
    if (!first) {
      throw new ApiError(
        0,
        '/v1/auth/me',
        '가구(household)를 찾을 수 없습니다. FAMILY_HOUSEHOLD_ID를 지정하거나 먼저 가구에 소속되세요.',
        { reason: 'HOUSEHOLD_NOT_FOUND' },
      );
    }
    this.cachedHouseholdId = first.householdId;
    return first.householdId;
  }

  /* ---------------------------------------------------------------------- */
  /* Internal helpers                                                        */
  /* ---------------------------------------------------------------------- */

  private buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Capture Set-Cookie headers into the manual cookie jar. */
  private storeCookies(res: Response): void {
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [];
    for (const raw of setCookies) {
      const pair = raw.split(';', 1)[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name && (this.localConfig !== null || name === 'refresh_token')) this.cookies.set(name, value);
    }
  }

  /** Serialize the cookie jar into a `Cookie` header value. */
  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * Extract a short, non-sensitive error message from a failed response.
   * Reads the API's `{ message }` when present; never returns raw bodies that
   * could contain secrets.
   */
  private async safeErrorMessage(res: Response): Promise<string> {
    if (this.localConfig === null) {
      await res.body?.cancel().catch(() => undefined);
      return `API가 요청을 처리하지 못했습니다 (HTTP ${res.status}).`;
    }
    try {
      const text = await res.text();
      if (!text) return res.statusText || `HTTP ${res.status}`;
      const json: unknown = JSON.parse(text);
      if (json && typeof json === 'object' && 'message' in json) {
        const message = (json as { message: unknown }).message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.map(String).join('; ');
      }
      return res.statusText || `HTTP ${res.status}`;
    } catch {
      return res.statusText || `HTTP ${res.status}`;
    }
  }
}
