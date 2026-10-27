import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, asc, eq, exists, gt, isNull, lt, or } from 'drizzle-orm';
import { schema, type Db } from '@family/database';

import { DB } from '../database/database.constants';
import { isRecurringRadarEnabled, RECURRING_REFRESH_INTERVAL_MS } from './recurring.constants';
import { RecurringService } from './recurring.service';

/** 한 차례 자동 갱신 결과. 원문·금액을 로그에 남기지 않는다. */
export interface RecurringRefreshSummary {
  refreshed: number;
  failed: number;
}

/** 정기결제 엔진을 시작 시와 30분마다 갱신한다. 알림은 기존 worker가 담당한다. */
@Injectable()
export class RecurringRefreshService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RecurringRefreshService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly recurring: RecurringService,
  ) {}

  onApplicationBootstrap(): void {
    if (!isRecurringRadarEnabled()) return;
    this.stopped = false;
    void this.runAndSchedule();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 오래된 가구만 순회한다. 실패한 가구는 성공 시각이 그대로라 다음 실행에 재시도된다. */
  async refreshDue(): Promise<RecurringRefreshSummary> {
    const summary: RecurringRefreshSummary = { refreshed: 0, failed: 0 };
    if (this.running || !isRecurringRadarEnabled()) return summary;
    this.running = true;
    try {
      let cursor: string | undefined;
      const dueBefore = new Date(Date.now() - RECURRING_REFRESH_INTERVAL_MS);
      while (true) {
        const households = await this.db.select({ id: schema.households.id }).from(schema.households)
          .leftJoin(schema.recurringRecomputeState, eq(schema.recurringRecomputeState.householdId, schema.households.id))
          .where(and(
            isNull(schema.households.deletedAt),
            or(isNull(schema.recurringRecomputeState.computedAt), lt(schema.recurringRecomputeState.computedAt, dueBefore)),
            cursor ? gt(schema.households.id, cursor) : undefined,
            exists(this.db.select({ id: schema.householdMembers.id }).from(schema.householdMembers).where(and(
              eq(schema.householdMembers.householdId, schema.households.id),
              eq(schema.householdMembers.status, 'active'),
            ))),
          )).orderBy(asc(schema.households.id)).limit(100);
        for (const household of households) {
          try {
            if (await this.recurring.recomputeIfDue(household.id)) summary.refreshed += 1;
          } catch (error: unknown) {
            summary.failed += 1;
            this.logger.warn(`정기결제 갱신 실패 household=${household.id} error=${error instanceof Error ? error.name : 'UnknownError'}`);
          }
        }
        if (households.length < 100) break;
        cursor = households[households.length - 1].id;
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async runAndSchedule(): Promise<void> {
    try {
      await this.refreshDue();
    } catch (error: unknown) {
      this.logger.warn(`정기결제 갱신 조회 실패 error=${error instanceof Error ? error.name : 'UnknownError'}`);
    }
    // 완료 뒤 30분을 센다. 시작 시각 기준 interval이면 첫 계산 지연 때문에 다음
    // tick이 TTL 직전에 도착해 건너뛰고 실제 갱신 간격이 60분이 될 수 있다.
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.runAndSchedule(), RECURRING_REFRESH_INTERVAL_MS);
    this.timer.unref();
  }
}
