import {
  Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown,
} from '@nestjs/common';
import { scopedTemplateFingerprint } from '@family/card-parsers';
import { schema, type Db } from '@family/database';
import { createLogger } from '@family/shared';
import { and, count, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import { DB } from '../database/database.module';
import { TransactionPromotionService } from '../promotion/transaction-promotion.service';

const RECOVERY_INTERVAL_MS = 5 * 60 * 1_000;
const SCAN_LIMIT = 100;

/** 한 번의 제한된 스캔 결과. 원문·사용자·카드 식별자는 외부로 반환하지 않는다. */
export interface AutomaticRecoverySummary {
  /** 활성 회원이 명시적으로 켜 둔 본인 카드 정책 수. */
  readonly activePolicies: number;
  /** 이번 배치에서 읽은 미승격 실패·검역 이벤트 수(최대 100). */
  readonly candidates: number;
  /** 동일 검증을 통과한 수. 미리보기에서는 적용 가능한 수다. */
  readonly eligible: number;
  readonly applied: number;
  readonly blocked: number;
  readonly failed: number;
}

interface RecoveryCandidate {
  readonly id: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly sender: string;
  readonly rawContent: string;
  readonly updatedAt: Date;
}

interface RecoveryScan {
  readonly activePolicies: number;
  readonly candidates: readonly RecoveryCandidate[];
  readonly policies: ReadonlyMap<string, Date>;
}

/** 승인된 개인 양식만 주기적으로 재검증하고 원자적 자동 승격 서비스로 넘긴다. */
@Injectable()
export class AutomaticRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = createLogger('worker:automatic-recovery');
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<AutomaticRecoverySummary> | null = null;
  private stopping = false;
  /** 차단된 오래된 이벤트가 다음 이벤트의 검사를 계속 막지 않도록 순환한다. */
  private cursor: string | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly promotion: TransactionPromotionService,
  ) {}

  /** 부팅 시 한 번 실행하고 이후 5분마다 겹치지 않는 배치를 실행한다. */
  onApplicationBootstrap(): void {
    this.stopping = false;
    this.tick();
    this.timer = setInterval(() => this.tick(), RECOVERY_INTERVAL_MS);
    this.timer.unref();
  }

  /** 신규 실행을 멈추고 이미 시작한 트랜잭션이 끝난 뒤 종료한다. */
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      await this.inFlight;
    } catch {
      // 실행 경로에서 오류를 보고한다. 종료 대기는 저장 작업의 정리만 책임진다.
    }
  }

  /**
   * 현재 스캔 위치의 최대 100건을 읽기 전용으로 검증한다. 정책·이벤트·감사 기록과
   * 스캔 위치를 바꾸지 않으며, 실제 run은 잠금 안에서 모든 조건을 다시 검증한다.
   */
  async preview(): Promise<AutomaticRecoverySummary> {
    return this.process(false);
  }

  /** 최대 100건을 처리한다. 겹쳐 호출되면 같은 진행 중 실행의 집계를 반환한다. */
  run(): Promise<AutomaticRecoverySummary> {
    if (this.inFlight) return this.inFlight;
    if (this.stopping) return Promise.resolve(this.emptySummary());
    const operation = this.process(true);
    this.inFlight = operation;
    void operation.then(
      () => { if (this.inFlight === operation) this.inFlight = null; },
      () => { if (this.inFlight === operation) this.inFlight = null; },
    );
    return operation;
  }

  private tick(): void {
    void this.run().then(summary => {
      if (summary.candidates > 0 || summary.failed > 0) {
        this.logger.info(summary, 'automatic recovery batch finished');
      }
    }).catch(() => {
      // DB 오류 객체에는 쿼리 매개변수의 원문이 포함될 수 있으므로 출력하지 않는다.
      this.logger.error('automatic recovery batch failed');
    });
  }

  private emptySummary(): AutomaticRecoverySummary {
    return { activePolicies: 0, candidates: 0, eligible: 0, applied: 0, blocked: 0, failed: 0 };
  }

  private async process(apply: boolean): Promise<AutomaticRecoverySummary> {
    const scan = await this.scan(this.cursor);
    let eligible = 0;
    let applied = 0;
    let blocked = 0;
    let failed = 0;
    let processed = 0;
    let lastId: string | null = null;
    for (const candidate of scan.candidates) {
      if (apply && this.stopping) break;
      processed += 1;
      lastId = candidate.id;
      const fingerprint = scopedTemplateFingerprint(candidate.householdId, candidate.memberId,
        candidate.sender, candidate.rawContent);
      const policyUpdatedAt = scan.policies.get(fingerprint);
      if (!policyUpdatedAt) {
        blocked += 1;
        continue;
      }
      try {
        const outcome = apply
          ? await this.promotion.promoteAutomatic(candidate.id, candidate.updatedAt, policyUpdatedAt)
          : await this.promotion.previewAutomatic(candidate.id, candidate.updatedAt, policyUpdatedAt);
        if (outcome.status === 'blocked') blocked += 1;
        else {
          eligible += 1;
          if (outcome.status === 'applied') applied += 1;
        }
      } catch {
        failed += 1;
      }
    }
    if (apply) {
      this.cursor = processed < scan.candidates.length || scan.candidates.length === SCAN_LIMIT ? lastId : null;
    }
    return { activePolicies: scan.activePolicies, candidates: processed, eligible, applied, blocked, failed };
  }

  private activePolicyConditions(): SQL | undefined {
    return and(
      eq(schema.householdMembers.status, 'active'),
      eq(schema.householdMembers.householdId, schema.cardSmsEvents.householdId),
      eq(schema.householdMembers.userId, schema.cardSmsTemplates.confirmedBy),
      isNull(schema.users.deletedAt), isNull(schema.households.deletedAt),
      eq(schema.cardSmsEvents.parseStatus, 'parsed'),
      sql`${schema.cardSmsTemplates.recipe}->'automationEnabled' = 'true'::jsonb`,
      sql`${schema.cardSmsTemplates.recipe}->>'householdId' = ${schema.cardSmsEvents.householdId}::text`,
      sql`${schema.cardSmsTemplates.recipe}->>'memberId' = ${schema.cardSmsEvents.memberId}::text`,
      eq(schema.paymentCards.householdId, schema.cardSmsEvents.householdId),
      or(eq(schema.paymentCards.ownerMemberId, schema.cardSmsEvents.memberId), eq(schema.paymentCards.isShared, true)),
      eq(schema.paymentCards.status, 'active'),
      isNull(schema.sourceItems.deletedAt),
    );
  }

  private async scan(cursor: string | null): Promise<RecoveryScan> {
    const [total] = await this.db.select({ total: count() }).from(schema.cardSmsTemplates)
      .innerJoin(schema.cardSmsEvents, eq(schema.cardSmsEvents.id, schema.cardSmsTemplates.sourceEventId))
      .innerJoin(schema.householdMembers, eq(schema.householdMembers.id, schema.cardSmsEvents.memberId))
      .innerJoin(schema.users, eq(schema.users.id, schema.householdMembers.userId))
      .innerJoin(schema.households, eq(schema.households.id, schema.householdMembers.householdId))
      .innerJoin(schema.sourceItems, eq(schema.sourceItems.id, schema.cardSmsEvents.sourceItemId))
      .innerJoin(schema.paymentCards, sql`${schema.paymentCards.id}::text = ${schema.cardSmsTemplates.recipe}->>'approvedCardId'`)
      .where(this.activePolicyConditions());
    const readCandidates = async (after: string | null): Promise<RecoveryCandidate[]> => this.db.select({
      id: schema.cardSmsEvents.id, householdId: schema.cardSmsEvents.householdId,
      memberId: schema.cardSmsEvents.memberId, sender: schema.cardSmsEvents.sender,
      rawContent: schema.cardSmsEvents.rawContent, updatedAt: schema.cardSmsEvents.updatedAt,
    }).from(schema.cardSmsEvents)
      .innerJoin(schema.householdMembers, eq(schema.householdMembers.id, schema.cardSmsEvents.memberId))
      .innerJoin(schema.users, eq(schema.users.id, schema.householdMembers.userId))
      .innerJoin(schema.households, eq(schema.households.id, schema.householdMembers.householdId))
      .innerJoin(schema.sourceItems, eq(schema.sourceItems.id, schema.cardSmsEvents.sourceItemId))
      .leftJoin(schema.cardTransactions, eq(schema.cardTransactions.sourceEventId, schema.cardSmsEvents.id))
      .where(and(inArray(schema.cardSmsEvents.parseStatus, ['parse_failed', 'quarantined']),
        eq(schema.householdMembers.status, 'active'),
        eq(schema.householdMembers.householdId, schema.cardSmsEvents.householdId),
        isNull(schema.users.deletedAt), isNull(schema.households.deletedAt),
        isNull(schema.sourceItems.deletedAt), isNull(schema.cardTransactions.id),
        after ? gt(schema.cardSmsEvents.id, after) : undefined,
      )).orderBy(schema.cardSmsEvents.id).limit(SCAN_LIMIT);
    let candidates = await readCandidates(cursor);
    if (candidates.length === 0 && cursor !== null) candidates = await readCandidates(null);
    const fingerprints = [...new Set(candidates.map(candidate => scopedTemplateFingerprint(
      candidate.householdId, candidate.memberId, candidate.sender, candidate.rawContent,
    )))];
    const policies = fingerprints.length === 0 ? [] : await this.db.select({
      fingerprint: schema.cardSmsTemplates.fingerprint, updatedAt: schema.cardSmsTemplates.updatedAt,
    }).from(schema.cardSmsTemplates)
      .innerJoin(schema.cardSmsEvents, eq(schema.cardSmsEvents.id, schema.cardSmsTemplates.sourceEventId))
      .innerJoin(schema.householdMembers, eq(schema.householdMembers.id, schema.cardSmsEvents.memberId))
      .innerJoin(schema.users, eq(schema.users.id, schema.householdMembers.userId))
      .innerJoin(schema.households, eq(schema.households.id, schema.householdMembers.householdId))
      .innerJoin(schema.sourceItems, eq(schema.sourceItems.id, schema.cardSmsEvents.sourceItemId))
      .innerJoin(schema.paymentCards, sql`${schema.paymentCards.id}::text = ${schema.cardSmsTemplates.recipe}->>'approvedCardId'`)
      .where(and(this.activePolicyConditions(), inArray(schema.cardSmsTemplates.fingerprint, fingerprints)));
    return { activePolicies: total?.total ?? 0, candidates,
      policies: new Map(policies.map(policy => [policy.fingerprint, policy.updatedAt])) };
  }
}
