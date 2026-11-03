import { scopedTemplateFingerprint, templateFingerprint } from '@family/card-parsers';
import { schema } from '@family/database';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AutomaticPromotionOutcome, AutomaticPromotionPreview, TransactionPromotionService,
} from '../promotion/transaction-promotion.service';
import { AutomaticRecoveryService } from './automatic-recovery.service';

const timestamp = new Date('2026-10-28T01:00:00Z');
const content = '[Web발신]\n현대카드(1234)승인\n김*수\n10/28 10:30\n12,000원 일시불\n테스트상점';

function candidate(index: number, memberId = 'self') {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    householdId: 'household', memberId, sender: 'test-card', rawContent: content, updatedAt: timestamp };
}
type Candidate = ReturnType<typeof candidate>;

function fingerprint(row: Candidate): string {
  return scopedTemplateFingerprint(row.householdId, row.memberId, row.sender, row.rawContent);
}

/** 실제 Drizzle SQL을 기록하되 합성 행만 반환한다. 외부 DB나 운영 원문은 읽지 않는다. */
function setup(options: {
  rows?: Candidate[];
  nextRows?: Candidate[];
  approvedKeys?: string[];
  outcomes?: (AutomaticPromotionOutcome | Error)[];
} = {}) {
  const rows = options.rows ?? [candidate(1)];
  const approvedKeys = options.approvedKeys ?? [...new Set(rows.map(fingerprint))];
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: readonly unknown[]) {
      queries.push({ sql: query, params });
      const response = Promise.resolve().then((): unknown[][] => {
        if (query.includes('count(*)')) return [[approvedKeys.length]];
        if (query.includes('from "card_sms_templates"')) return approvedKeys.map(key => [key, timestamp.toISOString()]);
        if (query.includes('from "card_sms_events"')) {
          const selected = query.includes('"card_sms_events"."id" >') ? options.nextRows ?? [] : rows;
          return selected.map(row => [row.id, row.householdId, row.memberId, row.sender,
            row.rawContent, row.updatedAt.toISOString()]);
        }
        throw new Error('예상하지 않은 자동 복구 SQL');
      });
      return Object.assign(response, { values: () => response });
    },
  };
  const outcomes = [...(options.outcomes ?? [])];
  const promote = vi.fn(async (): Promise<AutomaticPromotionOutcome> => {
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome ?? { status: 'applied', transactionId: 'synthetic-transaction' };
  });
  const preview = vi.fn(async (): Promise<AutomaticPromotionPreview> => ({ status: 'eligible' }));
  const db = drizzle(driver as unknown as postgres.Sql, { schema });
  const service = new AutomaticRecoveryService(db, {
    promoteAutomatic: promote, previewAutomatic: preview,
  } as unknown as TransactionPromotionService);
  return { service, promote, preview, queries };
}

afterEach(() => vi.useRealTimers());

describe('승인한 본인 문자 양식 자동 복구 스캔', () => {
  it('미리보기는 같은 검증을 읽기 전용으로 호출하고 숫자만 반환한다', async () => {
    const { service, promote, preview, queries } = setup();
    expect(await service.preview()).toEqual({ activePolicies: 1, candidates: 1, eligible: 1,
      applied: 0, blocked: 0, failed: 0 });
    expect(preview).toHaveBeenCalledWith(candidate(1).id, timestamp, timestamp);
    expect(promote).not.toHaveBeenCalled();
    expect(queries.every(query => query.sql.startsWith('select '))).toBe(true);
    expect(await service.run()).toEqual({ activePolicies: 1, candidates: 1, eligible: 1,
      applied: 1, blocked: 0, failed: 0 });
  });

  it('개별 차단·저장 오류 뒤에도 다음 후보를 처리한다', async () => {
    const { service, promote } = setup({ rows: [1, 2, 3, 4].map(index => candidate(index)), outcomes: [
      { status: 'blocked', reason: 'policy_changed' }, new Error('합성 저장 오류: 비공개 원문'),
      { status: 'applied', transactionId: 'a' }, { status: 'applied', transactionId: 'b' },
    ] });
    expect(await service.run()).toEqual({ activePolicies: 1, candidates: 4, eligible: 2,
      applied: 2, blocked: 1, failed: 1 });
    expect(promote).toHaveBeenCalledTimes(4);
  });

  it('전역 양식과 배우자의 개인 양식은 본인 이벤트 승인을 대신하지 않는다', async () => {
    const own = candidate(1);
    const spouse = candidate(2, 'spouse');
    const { service, promote } = setup({ rows: [own, spouse], approvedKeys: [
      templateFingerprint(own.sender, own.rawContent), fingerprint(spouse),
    ] });
    const summary = await service.run();
    expect(summary.applied).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(promote).toHaveBeenCalledWith(spouse.id, timestamp, timestamp);
  });

  it('스캔 SQL이 미승격·활성 회원·명시적 재사용·본인 또는 공용 카드로 범위를 제한한다', async () => {
    const { service, queries } = setup();
    await service.run();
    const policies = queries.find(query => query.sql.includes('count(*)'));
    expect(policies?.sql).toContain('"household_members"."user_id" = "card_sms_templates"."confirmed_by"');
    expect(policies?.sql).toContain("->'automationEnabled' = 'true'::jsonb");
    expect(policies?.sql).toContain("->>'householdId'");
    expect(policies?.sql).toContain("->>'memberId'");
    expect(policies?.sql).toContain('"payment_cards"."owner_member_id" = "card_sms_events"."member_id"');
    expect(policies?.params).toContain(true);
    expect(policies?.params).toContain('active');
    const candidates = queries.find(query => query.sql.includes('from "card_sms_events"'));
    expect(candidates?.sql).toContain('"card_transactions"."id" is null');
    expect(candidates?.sql).toContain('"source_items"."deleted_at" is null');
    expect(candidates?.params).toContain('parse_failed');
    expect(candidates?.params).toContain('quarantined');
    expect(candidates?.params).toContain(100);
  });

  it('미리보기 차단은 쓰기 없이 집계한다', async () => {
    const { service, preview, promote } = setup();
    preview.mockResolvedValue({ status: 'blocked', reason: 'promotion_paused' });
    const summary = await service.preview();
    expect(summary.blocked).toBe(1);
    expect(summary.applied).toBe(0);
    expect(promote).not.toHaveBeenCalled();
  });

  it('동시에 요청된 실행은 하나의 진행 중 배치를 공유한다', async () => {
    const { service, promote } = setup();
    let finish: ((outcome: AutomaticPromotionOutcome) => void) | undefined;
    const pending = new Promise<AutomaticPromotionOutcome>(resolve => { finish = resolve; });
    promote.mockImplementation(() => pending);
    const first = service.run();
    const second = service.run();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
    finish?.({ status: 'applied', transactionId: 'one' });
    await expect(first).resolves.toMatchObject({ applied: 1 });
  });

  it('종료는 현재 승격을 기다리고 다음 후보와 새 실행을 멈춘다', async () => {
    const { service, promote } = setup({ rows: [candidate(1), candidate(2)] });
    let finish: ((outcome: AutomaticPromotionOutcome) => void) | undefined;
    promote.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const operation = service.run();
    await vi.waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
    let stopped = false;
    const shutdown = service.onApplicationShutdown().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish?.({ status: 'applied', transactionId: 'one' });
    await shutdown;
    expect((await operation).candidates).toBe(1);
    expect(promote).toHaveBeenCalledTimes(1);
    expect((await service.run()).candidates).toBe(0);
  });

  it('차단된 100건 다음 배치를 검사하고 끝에 도달하면 다시 순환한다', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => candidate(index + 1));
    const { service, promote, queries } = setup({ rows, nextRows: [candidate(101)], approvedKeys: [] });
    expect((await service.run()).blocked).toBe(100);
    expect((await service.preview()).blocked).toBe(1);
    expect((await service.run()).blocked).toBe(1);
    expect((await service.run()).blocked).toBe(100);
    expect(queries.some(query => query.params.includes(candidate(100).id))).toBe(true);
    expect(promote).not.toHaveBeenCalled();
  });

  it('부팅과 5분 간격에 실행하고 종료 후에는 타이머를 해제한다', async () => {
    vi.useFakeTimers();
    const { service } = setup({ rows: [] });
    const run = vi.spyOn(service, 'run').mockResolvedValue({ activePolicies: 0, candidates: 0,
      eligible: 0, applied: 0, blocked: 0, failed: 0 });
    service.onApplicationBootstrap();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(run).toHaveBeenCalledTimes(2);
    await service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
