import { ConfigService } from '@nestjs/config';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import type { Job, Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { schema } from '@family/database';

import { CardSmsParseProcessor } from '../processors/card-sms-parse.processor';
import { TransactionPromotionService } from '../promotion/transaction-promotion.service';
import type { MoneyRuntimeService } from '../promotion/money-runtime.service';
import type { MoneyShadowService } from '../promotion/money-shadow.service';
import type { MoneyWriteService } from '../promotion/money-write.service';
import type { FxRateService } from '../promotion/fx-rate.service';
import type { RealtimePublisherService } from '../realtime/realtime-publisher.service';
import type { LlmSpanExtractorService } from './llm-span-extractor.service';
import type { TemplateRecipeService } from './template-recipe.service';
import { createParseQualityProbe, type ParseQualityProbe } from './parse-quality';
import { evaluateCardSmsRepair, type CardSmsRepairGuard, type CardSmsRepairSnapshot } from './repair-guard';

const ID = '00000000-0000-4000-8000-000000000001';
const approval = '[Web발신]\n현대 네이버 해외승인\n김*수\n10/10 20:46\nKRW 29,000.00\nEXAMPLE*SUBSCRIPTION';
const event: CardSmsRepairSnapshot = {
  id: ID, householdId: ID, memberId: ID, sender: 'card-test', rawContent: approval,
  receivedAt: new Date('2026-10-10T20:46:30+09:00'), updatedAt: new Date('2026-10-11T00:00:00Z'), parseStatus: 'parse_failed',
};

/** SQL은 실제 Drizzle로 생성하고 합성 결과만 반환한다. 외부 DB·Redis 연결은 없다. */
function database(row: Record<string, unknown>, options: { existing?: boolean; conflict?: boolean; priorRepair?: boolean } = {}) {
  const queries: string[] = [];
  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string) {
      queries.push(query);
      const result = Promise.resolve().then((): unknown[][] => {
        if (query.startsWith('update ')) return options.conflict ? [] : [[ID]];
        if (query.includes('from "card_sms_events"')) {
          return [Object.keys(getTableColumns(schema.cardSmsEvents)).map(key => {
            const value = row[key] ?? null;
            return value instanceof Date ? value.toISOString() : value;
          })];
        }
        if (query.includes('from "card_transactions"')) return options.existing ? [[ID]] : [];
        if (query.includes('from "pipeline_runs"')) return options.priorRepair ? [[ID]] : [];
        throw new Error('예상하지 않은 검증용 SQL');
      });
      return Object.assign(result, { values: () => result });
    },
  };
  return { db: drizzle(driver as unknown as postgres.Sql, { schema }), queries };
}

interface ProcessorInternals {
  processTracked(job: Job<{ cardSmsEventId: string; repair?: CardSmsRepairGuard }>, pipelineRunId: string, quality: ParseQualityProbe): Promise<unknown>;
}

function processorSetup(source = event, options: { existing?: boolean; conflict?: boolean } = {}) {
  const { db, queries } = database({ ...source, eventId: 'synthetic' }, options);
  const recipe = vi.fn(async () => null);
  const llm = vi.fn(async () => null);
  const promote = vi.fn(async () => undefined);
  const processor = new CardSmsParseProcessor(
    db, { promote } as unknown as TransactionPromotionService,
    { publish: vi.fn(async () => undefined) } as unknown as RealtimePublisherService,
    { enabled: true, extract: llm } as unknown as LlmSpanExtractorService,
    { extract: recipe } as unknown as TemplateRecipeService,
    { register: vi.fn() } as unknown as MoneyRuntimeService,
    new ConfigService({ app: { nodeEnv: 'production' }, ai: { cardSmsActionGate: 'off' } }),
  );
  const invoke = (repair?: CardSmsRepairGuard) => (processor as unknown as ProcessorInternals).processTracked(
    { id: 'synthetic', data: { cardSmsEventId: ID, ...(repair ? { repair } : {}) } } as Job<{ cardSmsEventId: string; repair?: CardSmsRepairGuard }>,
    ID, createParseQualityProbe(),
  );
  return { invoke, queries, recipe, llm, promote };
}

describe('문자 재처리 소비자의 부작용 경계', () => {
  it('L0 승인만 기존 승격으로 넘기고 레시피·LLM을 호출하지 않는다', async () => {
    const { invoke, queries, recipe, llm, promote } = processorSetup();
    await invoke(evaluateCardSmsRepair(event).guard);
    expect(recipe).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
    expect(promote).toHaveBeenCalledWith(ID, { repair: true });
    const update = queries.find(query => query.startsWith('update '));
    expect(update).toContain('"card_sms_events"."parse_status" =');
    expect(update).toContain('"card_sms_events"."updated_at" =');
    expect(update).toContain('not exists');
  });

  it.each([{ existing: true }, { conflict: true }])('기존 거래나 마지막 순간의 상태 변경을 거절한다 %j', async options => {
    const { invoke, recipe, llm, promote } = processorSetup(event, options);
    await expect(invoke(evaluateCardSmsRepair(event).guard)).rejects.toThrow(/^repair_/);
    expect(recipe).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });

  it('새 파서가 해결하지 못하는 원문은 LLM fallback 없이 중단한다', async () => {
    const { invoke, recipe, llm, promote, queries } = processorSetup({ ...event, rawContent: '알 수 없는 새 문자' });
    await expect(invoke(evaluateCardSmsRepair(event).guard)).rejects.toThrow('repair_requires_manual_review');
    expect(recipe).not.toHaveBeenCalled(); expect(llm).not.toHaveBeenCalled(); expect(promote).not.toHaveBeenCalled();
    expect(queries.some(query => query.startsWith('update '))).toBe(false);
  });

  it('일반 수집의 기존 레시피·LLM fallback은 유지한다', async () => {
    const { invoke, recipe, llm, promote } = processorSetup({ ...event, rawContent: '알 수 없는 새 문자' });
    await invoke();
    expect(recipe).toHaveBeenCalledTimes(1); expect(llm).toHaveBeenCalledTimes(1); expect(promote).not.toHaveBeenCalled();
  });
});

interface PromotionInternals {
  resolveCard(...args: unknown[]): Promise<unknown>;
  resolveMerchantAlias(...args: unknown[]): Promise<unknown>;
  resolveCategoryId(...args: unknown[]): Promise<unknown>;
  convertToKrw(...args: unknown[]): Promise<unknown>;
  promoteApproval(...args: unknown[]): Promise<unknown>;
  enqueueCategorySuggestion(...args: unknown[]): Promise<unknown>;
  enqueueNotification(...args: unknown[]): Promise<unknown>;
  checkBudgetAlerts(...args: unknown[]): Promise<unknown>;
}

describe('재처리 승격의 무과금·무알림 보존', () => {
  it.each([
    { explicitRepair: true, priorRepair: false, sideEffects: false },
    { explicitRepair: false, priorRepair: true, sideEffects: false },
    { explicitRepair: false, priorRepair: false, sideEffects: true },
  ])('직접 재처리/자동 복구/일반 수집을 구분한다 %j', async ({ explicitRepair, priorRepair, sideEffects }) => {
    const { db } = database({ ...event, parseStatus: 'parsed', transactionType: 'approval', amount: 29000, currency: 'KRW', merchantRaw: '검증가맹점' }, { priorRepair });
    const service = new TransactionPromotionService(
      db, {} as Queue, {} as Queue, {} as FxRateService,
      { observe: vi.fn(async () => undefined) } as unknown as MoneyShadowService,
      {} as MoneyWriteService, new ConfigService({ app: { nodeEnv: 'production' } }),
    );
    const internals = service as unknown as PromotionInternals;
    vi.spyOn(internals, 'resolveCard').mockResolvedValue({ cardId: null, visibility: 'private' });
    vi.spyOn(internals, 'resolveMerchantAlias').mockResolvedValue('검증가맹점');
    vi.spyOn(internals, 'resolveCategoryId').mockResolvedValue(null);
    vi.spyOn(internals, 'convertToKrw').mockResolvedValue({ amount: 29000, currency: 'KRW' });
    vi.spyOn(internals, 'promoteApproval').mockResolvedValue({ status: 'approved', transactionId: ID });
    const suggestion = vi.spyOn(internals, 'enqueueCategorySuggestion').mockResolvedValue(undefined);
    const notification = vi.spyOn(internals, 'enqueueNotification').mockResolvedValue(undefined);
    const budget = vi.spyOn(internals, 'checkBudgetAlerts').mockResolvedValue(undefined);
    await service.promote(ID, { repair: explicitRepair });
    expect(suggestion).toHaveBeenCalledTimes(sideEffects ? 1 : 0);
    expect(notification).toHaveBeenCalledTimes(sideEffects ? 1 : 0);
    expect(budget).toHaveBeenCalledTimes(sideEffects ? 1 : 0);
  });
});
