/**
 * 같은 판단을 다시 보내도 아무것도 바꾸지 않는다(정기 지출 P2).
 *
 * 버그: 확정된 행의 "정기 결제 맞아요"를 다시 누르면 `confirmed`가 재전송되고, 서버가
 * `stoppedDismissedAt`을 지워 앞서 받은 "계속 써요" 답이 사라졌다 — 해지 질문이 다시 떴다.
 * 실제 잠금·트랜잭션은 격리 DB 통합 테스트가 보고, 여기서는 어떤 쿼리가 나가는지만 본다.
 */
import { schema } from '@family/database';
import { NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecurringService } from './recurring.service';

vi.mock('./recurring-transaction', () => ({
  // 잠금·격리 수준은 통합 테스트의 몫이다. 여기서는 같은 executor로 작업만 돌린다.
  withRecurringTransaction: async (
    db: unknown,
    _householdId: string,
    work: (tx: unknown, state: { computedAt: Date | null }) => Promise<unknown>,
  ) => work(db, { computedAt: null }),
}));

const SERIES = '00000000-0000-4000-8000-0000000000a1';
const HOUSEHOLD = '00000000-0000-4000-8000-0000000000a2';
const USER = '00000000-0000-4000-8000-0000000000a3';
const MEMBER = '00000000-0000-4000-8000-0000000000a4';

type Status = 'candidate' | 'confirmed' | 'rejected' | 'needs_review' | 'ended';

function setup(current: Status | null) {
  const queries: string[] = [];
  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string) {
      queries.push(query);
      return {
        async values(): Promise<unknown[][]> {
          if (query.startsWith('update "recurring_series"')) return [[SERIES, 'updated']];
          if (query.includes('"household_members"')) return [[MEMBER]];
          if (query.includes('"status"') && query.includes('from "recurring_series"')) {
            return current === null ? [] : [[SERIES, current]];
          }
          return [[SERIES, HOUSEHOLD]];
        },
      };
    },
  };
  const service = new RecurringService(
    drizzle(driver as unknown as postgres.Sql, { schema }),
  );
  const updates = () => queries.filter((query) => query.startsWith('update'));
  return { service, queries, updates };
}

describe('정기 결제 판단의 재전송', () => {
  beforeEach(() => {
    vi.stubEnv('RECURRING_RADAR_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('확정된 행에 확정을 다시 보내면 update 없이 그대로 돌려준다("계속 써요" 답 보존)', async () => {
    const { service, updates } = setup('confirmed');
    await expect(service.decide(USER, SERIES, 'confirmed')).resolves.toEqual({
      id: SERIES,
      status: 'confirmed',
    });
    expect(updates()).toHaveLength(0);
  });

  it.each(['rejected', 'ended'] as const)('이미 %s인 행에 같은 판단도 바꾸지 않는다', async (decision) => {
    const { service, updates } = setup(decision);
    await expect(service.decide(USER, SERIES, decision)).resolves.toEqual({ id: SERIES, status: decision });
    expect(updates()).toHaveLength(0);
  });

  it('상태가 바뀌는 판단은 그대로 저장한다', async () => {
    const { service, queries, updates } = setup('candidate');
    await service.decide(USER, SERIES, 'confirmed');
    expect(queries.some((query) => query.startsWith('select "id", "status"'))).toBe(true);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]).toContain('"stopped_dismissed_at"');
  });

  it('"계속 써요"는 확정 상태에서도 답한 시각을 기록한다', async () => {
    const { service, queries, updates } = setup('confirmed');
    await service.decide(USER, SERIES, 'still_active');
    expect(updates()).toHaveLength(1);
    // 상태 확인 쿼리를 건너뛴다 — 이 답은 상태와 무관하게 "물어봤고 답을 받았다"를 남긴다.
    expect(queries.some((query) => query.startsWith('select "id", "status"'))).toBe(false);
  });

  it('볼 수 없는 행은 상태를 알려 주지 않고 없음(404)이다', async () => {
    const { service, updates } = setup(null);
    await expect(service.decide(USER, SERIES, 'confirmed')).rejects.toBeInstanceOf(NotFoundException);
    expect(updates()).toHaveLength(0);
  });
});
