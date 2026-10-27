import { sql } from 'drizzle-orm';
import { schema, type Db, type DbExecutor } from '@family/database';

/** 가구별 성공 시각. null은 아직 성공한 계산이 없다는 뜻이다. */
export interface RecurringCalculationState {
  computedAt: Date | null;
}

/** 드라이버가 감싼 원인에서도 PostgreSQL 재시도 가능 코드만 찾는다. */
function isRetryableConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && (current.code === '40001' || current.code === '40P01')) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

/**
 * 수동·자동 재계산과 사용자 결정을 같은 가구 잠금으로 직렬화한다.
 * repeatable read로 거래·별칭·기존 판단을 같은 스냅샷에서 읽는다. 잠금 대기 전에
 * 잡힌 오래된 스냅샷은 상태 행 갱신 충돌로 재시도되어 이전 판단을 덮지 않는다.
 */
export async function withRecurringTransaction<T>(
  db: Db,
  householdId: string,
  work: (tx: DbExecutor, state: RecurringCalculationState) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recurring:${householdId}`}))`);
        const [state] = await tx.insert(schema.recurringRecomputeState)
          .values({ householdId })
          .onConflictDoUpdate({
            target: schema.recurringRecomputeState.householdId,
            set: { updatedAt: new Date() },
          })
          .returning({ computedAt: schema.recurringRecomputeState.computedAt });
        if (!state) throw new Error('정기결제 계산 상태를 잠그지 못했습니다.');
        return work(tx, state);
      }, { isolationLevel: 'repeatable read' });
    } catch (error: unknown) {
      if (attempt >= 2 || !isRetryableConflict(error)) throw error;
    }
  }
}
