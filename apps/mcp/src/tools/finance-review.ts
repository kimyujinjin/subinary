import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { transactionStatusSchema, type RecategorizePreview, type RecategorizeResponse } from '@family/contracts';

import { FamilyApiClient, ApiError } from '../api-client';
import { describeError, textResult } from './shared';

const householdId = z.string().uuid().optional();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional();
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

/** 구조화 데이터와 동일한 텍스트를 반환해 금액·제외·페이지 정보를 보존한다. */
function result(data: object): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: { data } };
}

/** 인증 정보나 원시 오류 응답을 도구 결과에 노출하지 않는다. */
async function safely(run: () => Promise<object>): Promise<CallToolResult> {
  try { return result(await run()); }
  catch (error) {
    return textResult(error instanceof ApiError ? describeError(error) : '서버 응답을 확인하지 못했습니다. 완료로 처리하지 말고 다시 조회하세요.', true);
  }
}

interface PreviewEntry {
  householdId: string;
  merchant: string;
  categoryId: string;
  preview: RecategorizePreview;
  expiresAt: number;
  state: 'ready' | 'running' | 'unknown' | 'applied';
  applied?: RecategorizeResponse;
}

/** 금융 전용 조회와 선택적인 분류 정리 도구를 등록한다. 원문·금액 수정·삭제는 노출하지 않는다. */
export function registerFinanceReview(server: McpServer, client: FamilyApiClient, allowWrites: boolean): void {
  const previews = new Map<string, PreviewEntry>();

  server.registerTool('finance_overview', {
    title: '예산과 소비 현황',
    description: '월별 순지출·카테고리·예산을 기존 API로 조회합니다. 제외 내역을 함께 설명하고 예산 잔액을 통장 잔액으로 표현하지 마세요. 별도 모델 API를 호출하지 않습니다.',
    inputSchema: { householdId, month }, annotations: readAnnotations,
  }, ({ householdId: requested, month: selected }) => safely(async () => {
    const id = await client.resolveHouseholdId(requested);
    const [spending, categories, budgets, quality] = await Promise.all([
      client.monthly({ householdId: id, month: selected }), client.categorySpending(id, selected), client.budgets(id, selected), client.financeQuality(id),
    ]);
    return { fetchedAt: new Date().toISOString(), spending, categories, budgets, quality, caveat: '카드 문자 기반 내역입니다. 카드 청구서·통장 잔액·환불 입금 완료를 뜻하지 않습니다. 품질 집계는 전 기간 검토 현황이며 문자 상태는 본인 수집분만 포함합니다.' };
  }));

  server.registerTool('finance_quality', {
    title: '수집과 거래 검토 상태', description: '본인 문자 수집의 최근 시각·파싱 실패와 조회 가능한 거래의 미분류·중복 의심·미연결 취소를 확인합니다. 전 기간 집계이며 각 항목을 오류 확정으로 단정하지 마세요.',
    inputSchema: { householdId }, annotations: readAnnotations,
  }, ({ householdId: requested }) => safely(async () => client.financeQuality(await client.resolveHouseholdId(requested))));

  server.registerTool('finance_sms_review_groups', {
    title: '확인이 필요한 문자 묶음',
    description: '본인에게 수신된 파싱 실패·격리 문자를 같은 양식으로 묶어 건수와 가계부 웹 검토 경로를 조회합니다. 원문은 반환하지 않습니다. truncated이면 전체 건수로 단정하지 마세요. 대표 문자와 같은 양식도 각각 검증하며, 이 도구는 확정·재사용 동의를 수행하지 않습니다.',
    inputSchema: { householdId }, annotations: readAnnotations,
  }, ({ householdId: requested }) => safely(async () => client.smsReviewGroups(await client.resolveHouseholdId(requested))));

  server.registerTool('finance_recurring', {
    title: '정기지출 후보와 확정 내역',
    description: '정기지출 탐지 결과와 마지막 계산 시각을 조회합니다. computedAt이 없으면 미계산이며, 후보는 확정된 구독이 아닙니다. 사용자 판단이나 해지 상태를 변경하지 않습니다.',
    inputSchema: { householdId }, annotations: readAnnotations,
  }, ({ householdId: requested }) => safely(async () => client.recurringSeries(await client.resolveHouseholdId(requested))));

  server.registerTool('finance_upcoming', {
    title: '예정 정기지출 확인',
    description: 'until까지 사용자 확정 정기지출의 예상 목록과 제외 건수를 조회합니다. 카드 청구 예정액 전체가 아니며 미확정 후보를 더하지 마세요. 최신 계산 상태는 finance_recurring으로 함께 확인합니다.',
    inputSchema: { householdId, until: z.string().datetime() }, annotations: readAnnotations,
  }, ({ householdId: requested, until }) => safely(async () => client.recurringUpcoming(await client.resolveHouseholdId(requested), until)));

  server.registerTool('finance_transactions', {
    title: '카드 거래 검색',
    description: '권한에 따라 거래를 검색합니다. memberId는 거래 구성원이며 카드 소유자와 다를 수 있습니다. 반환된 다음 페이지 커서가 있으면 전체 목록이라고 표현하지 마세요.',
    inputSchema: {
      householdId, memberId: z.string().uuid().optional(), cardId: z.string().uuid().optional(),
      type: z.enum(['approval', 'cancellation']).optional(),
      status: transactionStatusSchema.optional(),
      categoryId: z.string().uuid().optional(), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
      q: z.string().min(1).max(200).optional(), attribution: z.literal('shared').optional(),
      limit: z.number().int().min(1).max(100).default(20), cursor: z.string().max(2000).optional(),
    }, annotations: readAnnotations,
  }, ({ householdId: requested, ...query }) => safely(async () => client.transactions({ ...query, householdId: await client.resolveHouseholdId(requested) })));

  server.registerTool('finance_categories', {
    title: '사용 가능한 지출 분류', description: '실제 카테고리 ID와 이름을 조회합니다. ID를 추측하지 마세요.',
    inputSchema: { householdId }, annotations: readAnnotations,
  }, ({ householdId: requested }) => safely(async () => ({ items: await client.categories(await client.resolveHouseholdId(requested)) })));

  server.registerTool('finance_recategorize_preview', {
    title: '과거 거래 분류 변경 미리보기',
    description: '가맹점별 과거 거래 분류 변경의 건수·금액·예산 영향을 보여줍니다. 거래를 바꾸지 않습니다. 사용자에게 범위를 설명하고 그 지시에 따라 적용하세요. 향후 자동분류 규칙은 변경하지 않습니다.',
    inputSchema: { householdId, merchant: z.string().min(1).max(200), categoryId: z.string().uuid() }, annotations: readAnnotations,
  }, ({ householdId: requested, merchant, categoryId }) => safely(async () => {
    const id = await client.resolveHouseholdId(requested);
    const preview = await client.recategorizePreview({ householdId: id, merchant, categoryId });
    const now = Date.now();
    for (const [key, entry] of previews) if (entry.expiresAt <= now && entry.state === 'ready') previews.delete(key);
    if (previews.size >= 100) throw new ApiError(409, 'preview', '이 세션의 변경 미리보기가 너무 많습니다. 결과 이력을 확인한 뒤 연결을 다시 시작하세요.');
    const previewId = randomUUID();
    const expiresAt = now + 10 * 60_000;
    previews.set(previewId, { householdId: id, merchant, categoryId, preview, expiresAt, state: 'ready' });
    return { previewId, expiresAt: new Date(expiresAt).toISOString(), preview, writesEnabled: allowWrites };
  }));

  server.registerTool('finance_recategorize_history', {
    title: '분류 변경 결과와 이력', description: '분류 변경의 적용·되돌리기 결과를 조회합니다. 실행 응답이 끊겼을 때 재실행 전에 확인하세요.',
    inputSchema: { householdId }, annotations: readAnnotations,
  }, ({ householdId: requested }) => safely(async () => client.recategorizeHistory(await client.resolveHouseholdId(requested))));

  if (!allowWrites) return;

  server.registerTool('finance_classify_transaction', {
    title: '거래 분류와 향후 규칙 지정',
    description: '사용자가 지정한 거래의 카테고리를 변경하고 재조회합니다. expectedCategoryId에는 직전 조회한 분류를 넣으세요. 향후 동일 가맹점 규칙은 사용자가 요청했을 때만 applyFutureRule=true로 지정합니다. 다른 과거 거래는 바꾸지 않습니다.',
    inputSchema: { transactionId: z.string().uuid(), categoryId: z.string().uuid(), expectedCategoryId: z.string().uuid().nullable(), applyFutureRule: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, ({ transactionId, categoryId, expectedCategoryId, applyFutureRule }) => safely(async () => {
    const before = await client.transaction(transactionId);
    if (before.categoryId !== expectedCategoryId) throw new ApiError(409, 'transaction', '직전 조회 이후 분류가 변경됐습니다. 최신 거래를 확인하세요.');
    await client.classifyTransaction(transactionId, categoryId, applyFutureRule, expectedCategoryId);
    const after = await client.transaction(transactionId);
    return { transactionId, previousCategoryId: before.categoryId, requestedCategoryId: categoryId, after, verified: after.categoryId === categoryId, futureRuleRequested: applyFutureRule };
  }));

  server.registerTool('finance_recategorize_apply', {
    title: '미리 확인한 분류 변경 적용',
    description: '사용자가 지정한 분류 변경을 같은 세션의 미리보기 ID로 적용합니다. 성공 시 batchId를 이력 조회로 확인하세요. 결과 불명은 재전송하지 않습니다. 이 도구는 과거 거래만 변경하며 향후 규칙은 바꾸지 않습니다.',
    inputSchema: { previewId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, ({ previewId }) => safely(async () => {
    const entry = previews.get(previewId);
    if (!entry) throw new ApiError(409, 'preview', '이 세션에서 변경 미리보기를 먼저 조회하세요.');
    if (entry.state === 'applied' && entry.applied) return { ...entry.applied, replay: true };
    if (entry.state !== 'ready') throw new ApiError(409, 'preview', '이미 실행 중이거나 결과가 불명입니다. 변경 이력을 확인하세요.');
    if (entry.expiresAt <= Date.now()) throw new ApiError(409, 'preview', '미리보기가 만료됐습니다. 다시 조회하세요.');
    if (entry.preview.count === 0 || entry.preview.exceedsLimit) throw new ApiError(409, 'preview', '변경할 대상이 없거나 적용 상한을 넘었습니다.');
    entry.state = 'running';
    try {
      const current = await client.recategorizePreview({ householdId: entry.householdId, merchant: entry.merchant, categoryId: entry.categoryId });
      if (JSON.stringify(current) !== JSON.stringify(entry.preview)) {
        entry.state = 'ready';
        throw new ApiError(409, 'preview', '미리보기 이후 대상이 달라졌습니다. 새 미리보기로 범위를 확인하세요.');
      }
    } catch (error) {
      entry.state = 'ready';
      throw error;
    }
    // 전송 이후 오류는 서버에 반영됐을 수 있으므로 같은 ID의 재전송을 막는다.
    entry.state = 'unknown';
    const applied = await client.recategorize({ householdId: entry.householdId, merchant: entry.merchant, categoryId: entry.categoryId, expectedCount: entry.preview.count });
    entry.applied = applied;
    entry.state = 'applied';
    return { ...applied, verifyWith: 'finance_recategorize_history' };
  }));

  server.registerTool('finance_recategorize_revert', {
    title: '분류 변경 되돌리기', description: '사용자가 지정한 변경 batch를 되돌립니다. 이후 직접 수정한 거래는 보존하므로 skippedCount를 함께 설명하세요.',
    inputSchema: { batchId: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, ({ batchId }) => safely(async () => client.recategorizeRevert(batchId)));
}
