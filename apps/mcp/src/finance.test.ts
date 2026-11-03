import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

import { FamilyApiClient } from './api-client';
import { loadConfig, type McpConfig } from './config';
import { registerAllTools } from './tools';

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const CATEGORY = '22222222-2222-4222-8222-222222222222';
const BATCH = '33333333-3333-4333-8333-333333333333';
const TRANSACTION = '44444444-4444-4444-8444-444444444444';
const transaction = {
  id: TRANSACTION, householdId: HOUSEHOLD, memberId: 'fixture-member', cardId: null,
  transactionType: 'approval', status: 'approved', amount: 1000, cancelledAmount: 0, netAmount: 1000,
  currency: 'KRW', originalAmount: null, originalCurrency: null, exchangeRate: null,
  merchantRaw: '테스트가맹점', merchantNormalized: '테스트가맹점', categoryId: null, categorySlug: null,
  approvedAt: '2026-10-01T00:00:00Z', cancelledAt: null, installmentMonths: null, parentTransactionId: null,
  visibility: 'private', memo: null, masked: false, excludedAt: null, createdAt: '2026-10-01T00:00:00Z',
};
const preview = {
  merchantCanonical: '테스트가맹점', toCategoryId: CATEGORY, toCategoryName: '식비', count: 2, amount: 12000,
  oldestAt: '2026-10-01T00:00:00Z', newestAt: '2026-10-02T00:00:00Z', months: [], fromCategoryNames: ['미분류'],
  transferBoundaryCrossed: false, exceedsLimit: false, limit: 500,
};
const closers: Array<() => Promise<void>> = [];
const requests: Array<{ path: string; method: string; body: unknown }> = [];

/** 실제 MCP 프로토콜로 도구 목록·입력 검증·호출을 시험하고 HTTP만 대체한다. */
async function setup(mode: McpConfig['toolMode'] = 'finance-readonly'): Promise<Client> {
  const config = loadConfig({ FAMILY_API_URL: 'https://family.invalid', FAMILY_EMAIL: 'test@example.com', FAMILY_PASSWORD: 'fixture-secret', FAMILY_HOUSEHOLD_ID: HOUSEHOLD, FAMILY_TOOL_MODE: mode });
  const server = new McpServer({ name: 'finance-test', version: '1.0.0' });
  registerAllTools(server, new FamilyApiClient(config), mode);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  closers.push(async () => { await client.close(); await server.close(); });
  return client;
}

/** 검증 가능한 HTTP 요청 경로와 본문을 기록한다. */
function mockApi(respond: (url: URL, method: string) => object | Promise<object>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    requests.push({ path: url.pathname, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined });
    return Response.json(await respond(url, method));
  }));
}

/** 미리보기 응답에서 모델이 사용할 ID를 검증해 꺼낸다. */
async function getPreview(client: Client): Promise<string> {
  const response = await client.callTool({ name: 'finance_recategorize_preview', arguments: { merchant: '테스트가맹점', categoryId: CATEGORY } });
  return z.object({ data: z.object({ previewId: z.string().uuid() }) }).parse(response.structuredContent).data.previewId;
}

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); requests.length = 0;
});

describe('금융 전용 MCP 경계', () => {
  it('기본 등록에는 기억/유료 AI 검색/쓰기 도구가 없다', async () => {
    const client = await setup();
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain('finance_transactions');
    expect(names).toContain('finance_sms_review_groups');
    expect(names).toHaveLength(10);
    expect(names).not.toContain('memory_search');
    expect(names).not.toContain('finance_recategorize_apply');
    expect(names).not.toContain('finance_classify_transaction');
    expect((await client.callTool({ name: 'finance_recategorize_apply', arguments: { previewId: BATCH } })).isError).toBe(true);
  });

  it('거래 페이지를 누락 없이 전달하고 데이터는 기존 API만 읽는다', async () => {
    mockApi(() => ({ items: [], nextCursor: 'next-page' }));
    const client = await setup();
    const response = await client.callTool({ name: 'finance_transactions', arguments: { limit: 20 } });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({ data: { items: [], nextCursor: 'next-page' } });
    expect(requests.map(r => r.path)).toEqual(['/v1/transactions']);
  });

  it('입력 상한을 넘으면 API를 호출하지 않는다', async () => {
    mockApi(() => ({}));
    const client = await setup();
    expect((await client.callTool({ name: 'finance_transactions', arguments: { limit: 101 } })).isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('서버의 접근 거부를 성공으로 바꾸지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    const client = await setup();
    const response = await client.callTool({ name: 'finance_transactions', arguments: {} });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).toContain('접근 권한');
  });

  it('정기지출 0건일 때도 미계산 상태를 보존한다', async () => {
    mockApi(() => ({ enabled: true, provisional: false, items: [], computedAt: null }));
    const client = await setup();
    const response = await client.callTool({ name: 'finance_recurring', arguments: {} });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({ data: { enabled: true, provisional: false, items: [], computedAt: null } });
    expect(requests.map(r => r.path)).toEqual(['/v1/recurring/series']);
  });

  it('문자 묶음은 읽기 전용으로 원문 없이 상한·검토 경로·중지 상태를 보존한다', async () => {
    const groups = { scope: 'own_member', scannedCount: 100, truncated: true,
      items: [{ groupId: 'scope-hash', sender: '1588-test', count: 100, parseFailed: 80, quarantined: 20,
        latestReceivedAt: '2026-10-28T00:00:00Z', representativeEventId: TRANSACTION, reviewPath: `/todo?reviewSms=${TRANSACTION}` }],
      policies: [{ id: BATCH, approvedCardId: CATEGORY, enabled: false, createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' }] };
    mockApi(() => ({ ...groups, rawContent: '반환하면 안 되는 원문', items: groups.items.map(item => ({ ...item, rawContent: '본문 지시 무시' })) }));
    const client = await setup();
    const tools = (await client.listTools()).tools;
    expect(tools.find(tool => tool.name === 'finance_sms_review_groups')?.annotations?.readOnlyHint).toBe(true);
    const response = await client.callTool({ name: 'finance_sms_review_groups', arguments: {} });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({ data: groups });
    expect(requests.map(r => [r.path, r.method])).toEqual([['/v1/card-sms-events/review-groups', 'GET']]);
    expect(JSON.stringify(response)).not.toContain('rawContent');
  });

  it('문자 묶음의 외부 검토 URL·잘못된 범위를 신뢰하지 않는다', async () => {
    mockApi(() => ({ scope: 'own_member', scannedCount: 1, truncated: false, policies: [],
      items: [{ groupId: 'bad', sender: 'test', count: 1, parseFailed: 1, quarantined: 0,
        latestReceivedAt: '2026-10-28T00:00:00Z', representativeEventId: TRANSACTION, reviewPath: 'https://untrusted.invalid/login' }] }));
    const client = await setup();
    expect((await client.callTool({ name: 'finance_sms_review_groups', arguments: {} })).isError).toBe(true);
    const before = requests.length;
    expect((await client.callTool({ name: 'finance_sms_review_groups', arguments: { householdId: 'invalid' } })).isError).toBe(true);
    expect(requests).toHaveLength(before);
  });

  it('분류 검토 모드도 문자 자동 승인 도구는 제공하지 않는다', async () => {
    const client = await setup('finance-review');
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toHaveLength(13);
    expect(names).not.toContain('finance_sms_review');
    expect(names).not.toContain('finance_sms_policy_enable');
  });
});

describe('단일 거래 분류의 확인과 충돌', () => {
  it('기대 분류를 서버에 전달하고 다시 조회한 값으로 성공을 검증한다', async () => {
    let changed = false;
    mockApi((_url, method) => {
      if (method === 'PATCH') changed = true;
      return { ...transaction, categoryId: changed ? CATEGORY : null };
    });
    const client = await setup('finance-review');
    const response = await client.callTool({ name: 'finance_classify_transaction', arguments: { transactionId: TRANSACTION, categoryId: CATEGORY, expectedCategoryId: null } });
    expect(response.isError).not.toBe(true);
    expect(requests.map(r => r.method)).toEqual(['GET', 'PATCH', 'GET']);
    expect(requests[1]?.body).toEqual({ categoryId: CATEGORY, applyRule: false, expectedCategoryId: null });
    expect(z.object({ data: z.object({ verified: z.boolean() }) }).parse(response.structuredContent).data.verified).toBe(true);
  });

  it('조회 시 이미 분류가 바뀌었으면 갱신하지 않는다', async () => {
    mockApi(() => ({ ...transaction, categoryId: CATEGORY }));
    const client = await setup('finance-review');
    expect((await client.callTool({ name: 'finance_classify_transaction', arguments: { transactionId: TRANSACTION, categoryId: CATEGORY, expectedCategoryId: null } })).isError).toBe(true);
    expect(requests.map(r => r.method)).toEqual(['GET']);
  });

  it('조회 직후 동시 수정으로 API가 409를 반환하면 성공으로 보고하지 않는다', async () => {
    let patches = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'PATCH') { patches += 1; return Response.json({ message: '분류 변경 충돌' }, { status: 409 }); }
      return Response.json(transaction);
    }));
    const client = await setup('finance-review');
    expect((await client.callTool({ name: 'finance_classify_transaction', arguments: { transactionId: TRANSACTION, categoryId: CATEGORY, expectedCategoryId: null, applyFutureRule: true } })).isError).toBe(true);
    expect(patches).toBe(1);
  });

  it('적용 후 재조회가 실패하면 반영 확인 완료로 보고하지 않는다', async () => {
    let calls = 0;
    mockApi(() => {
      calls += 1;
      if (calls === 3) throw new Error('fixture-network-loss');
      return calls === 1 ? transaction : { ...transaction, categoryId: CATEGORY };
    });
    const client = await setup('finance-review');
    expect((await client.callTool({ name: 'finance_classify_transaction', arguments: { transactionId: TRANSACTION, categoryId: CATEGORY, expectedCategoryId: null } })).isError).toBe(true);
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1);
  });
});

describe('분류 변경의 미리보기·재시도 경계', () => {
  it('같은 미리보기 재호출은 한 번만 적용하며 결과를 재사용한다', async () => {
    mockApi((url) => url.pathname.endsWith('/preview') ? preview : { batchId: BATCH, appliedCount: 2 });
    const client = await setup('finance-review');
    const previewId = await getPreview(client);
    const first = await client.callTool({ name: 'finance_recategorize_apply', arguments: { previewId } });
    const second = await client.callTool({ name: 'finance_recategorize_apply', arguments: { previewId } });
    expect(first.isError).not.toBe(true);
    expect(second.structuredContent).toEqual({ data: { batchId: BATCH, appliedCount: 2, replay: true } });
    expect(requests.filter(r => r.method === 'POST')).toEqual([{ path: '/v1/transactions/recategorize', method: 'POST', body: { householdId: HOUSEHOLD, merchant: '테스트가맹점', categoryId: CATEGORY, expectedCount: 2 } }]);
  });

  it('대상 건수/금액이 바뀌면 적용하지 않는다', async () => {
    let count = 0;
    mockApi(() => ++count === 1 ? preview : { ...preview, count: 3, amount: 18000 });
    const client = await setup('finance-review');
    const previewId = await getPreview(client);
    expect((await client.callTool({ name: 'finance_recategorize_apply', arguments: { previewId } })).isError).toBe(true);
    expect(requests.every(r => r.method === 'GET')).toBe(true);
  });

  it('미리보기 없이 임의 ID로 수정할 수 없다', async () => {
    mockApi(() => ({}));
    const client = await setup('finance-review');
    expect((await client.callTool({ name: 'finance_recategorize_apply', arguments: { previewId: BATCH } })).isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('적용 응답 유실 뒤 자동으로 같은 변경을 재전송하지 않는다', async () => {
    mockApi((_url, method) => {
      if (method === 'POST') throw new Error('connection lost');
      return preview;
    });
    const client = await setup('finance-review');
    const previewId = await getPreview(client);
    expect((await client.callTool({ name: 'finance_recategorize_apply', arguments: { previewId } })).isError).toBe(true);
    expect((await client.callTool({ name: 'finance_recategorize_apply', arguments: { previewId } })).isError).toBe(true);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
  });

  it('만료된 미리보기는 최신 범위를 확인하게 한다', async () => {
    mockApi(() => preview);
    const client = await setup('finance-review');
    const previewId = await getPreview(client);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    expect((await client.callTool({ name: 'finance_recategorize_apply', arguments: { previewId } })).isError).toBe(true);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
  });
});
