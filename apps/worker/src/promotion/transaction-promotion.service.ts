/**
 * 거래 승격 서비스 (Phase 4 Build Spec §6).
 *
 * 파싱이 끝난 `card_sms_events`(parseStatus in parsed/pending_review, amount 존재)를
 * 정규화된 `card_transactions`로 승격한다. 파싱 워커가 같은 잡 안에서 호출하므로
 * 별도 큐 없이 10초 반영 목표를 유지한다(스펙 §1.1).
 *
 * 규약:
 * - 멱등: `card_transactions.sourceEventId` UNIQUE + `onConflictDoNothing`.
 *   재승격/경합은 기존 레코드를 남기고 승인 잔액을 이중 반영하지 않는다.
 * - 금액은 KRW 정수(부동소수 금지). netAmount 규약(스펙 §1.2):
 *   approval → netAmount = amount - cancelledAmount, cancellation → netAmount = 0.
 * - 카드 자동연결: 원본 구성원 소유 카드 또는 명시적 공용 카드만 후보로 삼는다.
 *   발급사·뒤 4자리로 유일하게 식별한 경우만 연결하고, 카드번호가 없는 문자도
 *   같은 구성원 범위를 지킨다. 모호하거나 타인 개인 카드만 일치하면 미연결·검토로
 *   남기며 후보 중 가장 제한적인 공개범위를 유지한다.
 * - 카테고리: merchant_category_rules(household, merchantNormalized) →
 *   키워드(categorizeByKeyword → slug → 시스템 expense_categories) →
 *   LLM 제안(category-suggest 큐, 비동기 자가학습) → null (스펙 §1.3).
 *   LLM tier 는 여기서 동기 분류하지 않는다 — 미분류(null)로 승격을 완료하고
 *   가맹점 단위 1회 category-suggest 잡만 enqueue 한다(승격 지연/실패 없음).
 * - 로그는 식별자/거래유형/상태만(금액·가맹점·PII 미기록, 스펙 §6/§1.1).
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@family/config';
import {
  schema,
  MONEY_CONTRACT_VERSION_V2,
  type Db,
  type DbExecutor,
  notTransferCategory,
  spendPeriodWindow,
} from '@family/database';
import {
  applyRecipe,
  automaticApprovalRejection,
  scopedTemplateFingerprint,
  templateFingerprint,
  type CardSmsParseResult,
  type TemplateRecipe,
} from '@family/card-parsers';
import {
  assertKrwInteger,
  categorizeByKeyword,
  createLogger,
  currencyExponent,
  normalizeMerchant,
  resolvePaymentCardLink,
  QUEUE_NAMES,
  type NotificationDispatchJob,
  type PaymentCardLink as CardLink,
} from '@family/shared';
import type { Queue } from 'bullmq';
import { convertToKrw as convertMoneyToKrw, fxBaseDate, fxRateDisplayValue } from '@family/transaction-domain';
import { and, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { DB } from '../database/database.module';
import { FxRateService } from './fx-rate.service';
import { MoneyShadowService } from './money-shadow.service';
import { MoneyWriteService } from './money-write.service';
import { MoneyRuntimeService } from './money-runtime.service';

/** 개인 승인 정책의 자동 적용 결과. 차단 사유에는 원문이나 개인정보를 넣지 않는다. */
export type AutomaticPromotionOutcome =
  | { readonly status: 'applied'; readonly transactionId: string }
  | { readonly status: 'blocked'; readonly reason: string };

/** 읽기 전용 미리보기 결과. 실제 적용은 잠금 안에서 같은 검증을 다시 수행한다. */
export type AutomaticPromotionPreview =
  | { readonly status: 'eligible' }
  | { readonly status: 'blocked'; readonly reason: string };

interface ApprovedRecipe extends TemplateRecipe {
  readonly approvedCardId: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly automationEnabled: true;
}

interface AutomaticPreparation {
  readonly event: typeof schema.cardSmsEvents.$inferSelect;
  readonly policy: typeof schema.cardSmsTemplates.$inferSelect;
  readonly result: CardSmsParseResult & { amount: number; merchantRaw: string; occurredAt: Date };
  readonly card: CardLink & { cardId: string };
  readonly merchantNormalized: string | null;
  readonly categoryId: string | null;
}

/** 금액 명령 이후의 거절도 트랜잭션 전체를 되돌리도록 사용하는 내부 신호. */
class AutomaticPromotionBlocked extends Error {}

function isApprovedRecipe(value: Record<string, unknown>): value is Record<string, unknown> & ApprovedRecipe {
  const fields = value.fields;
  return value.schemaVersion === 'card-sms-recipe-v1'
    && value.transactionType === 'approval'
    && typeof value.fingerprint === 'string'
    && typeof value.issuer === 'string'
    && typeof value.approvedCardId === 'string'
    && typeof value.householdId === 'string'
    && typeof value.memberId === 'string'
    && value.automationEnabled === true
    && fields !== null && typeof fields === 'object' && !Array.isArray(fields)
    && Object.entries(fields).every(([field, rule]: [string, unknown]) => {
      if (!['amount', 'occurredAt', 'merchant', 'installment'].includes(field)
        || rule === null || typeof rule !== 'object' || Array.isArray(rule)) return false;
      const index = (rule as Record<string, unknown>).candidateIndex;
      return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0;
    });
}

/**
 * 외화 환산 결과. KRW 거래는 fx=null. 외화는 amount(KRW 환산 minor units) +
 * original*(원통화 원본) + rate(승인 시점 환율)를 함께 담는다.
 */
interface ConvertedAmount {
  amount: number;
  currency: 'KRW';
  originalAmount: number | null;
  originalCurrency: string | null;
  exchangeRate: number | null;
}

/** 거래 상태(스펙 §2 txnStatus enum). */
type TransactionStatus =
  | 'approved'
  | 'partially_cancelled'
  | 'cancelled'
  | 'pending_review'
  | 'duplicate_suspected';

/**
 * 2차 유사중복 판정 시각 근접 창(±수분, 스펙 §6.6). 같은 카드/금액/가맹점의 승인이
 * 이 창 안에 이미 있으면 새 승인을 duplicate_suspected로 표시한다.
 */
const DUPLICATE_TIME_WINDOW_MS = 5 * 60 * 1000;

/** 취소 승격 결과(로깅용). */
interface CancellationOutcome {
  status: TransactionStatus;
  linked: boolean;
  skipped: boolean;
  /** 새로 삽입된 취소 거래 id(skip이면 null) — 알림 enqueue에 사용. */
  transactionId: string | null;
}

/** 예산 알림 임계(백분율). 내림차순 — 넘긴 것 중 가장 높은 미발송분을 발송한다. */
const BUDGET_ALERT_THRESHOLDS = [100, 80] as const;

/** Korea Standard Time은 고정 UTC+9(서머타임 없음). */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 현재 Asia/Seoul 회계월 창 `[from, to)`와 `YYYY-MM` 라벨(budget.service와 동일 산식). */
function currentSeoulMonth(): { from: Date; to: Date; periodMonth: string } {
  const seoulNow = new Date(Date.now() + KST_OFFSET_MS);
  const year = seoulNow.getUTCFullYear();
  const monthIndex = seoulNow.getUTCMonth();
  const from = new Date(Date.UTC(year, monthIndex, 1) - KST_OFFSET_MS);
  const to = new Date(Date.UTC(year, monthIndex + 1, 1) - KST_OFFSET_MS);
  const periodMonth = `${year.toString().padStart(4, '0')}-${(monthIndex + 1)
    .toString()
    .padStart(2, '0')}`;
  return { from, to, periodMonth };
}

@Injectable()
export class TransactionPromotionService {
  private readonly logger: ReturnType<typeof createLogger>;

  constructor(
    @Inject(DB) private readonly db: Db,
    // 미분류 승격 시 LLM 카테고리 제안을 트리거하는 category-suggest 큐(생산자).
    @InjectQueue(QUEUE_NAMES.CATEGORY_SUGGEST)
    private readonly categorySuggestQueue: Queue,
    // 새 거래 승격 시 푸시 알림을 트리거하는 notification-dispatch 큐(생산자).
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_DISPATCH)
    private readonly notificationQueue: Queue,
    // 외화 거래를 승인 시점 환율로 KRW 환산한다.
    private readonly fxRate: FxRateService,
    // ADR-0027 롤아웃 3단계: 승격 결과를 새 금액 계약과 대조해 기록만 한다(무변경).
    private readonly moneyShadow: MoneyShadowService,
    // ADR-0027 5단계: enforce가 켜지면 승격의 금액 쓰기를 이쪽이 소유한다(D-1 해소).
    private readonly moneyWrite: MoneyWriteService,
    configService: ConfigService,
    @Optional() private readonly moneyRuntime?: MoneyRuntimeService,
  ) {
    const nodeEnv = configService.get<AppConfig['app']>('app')?.nodeEnv;
    this.logger = createLogger('worker:transaction-promotion', {
      pretty: nodeEnv !== 'production',
    });
  }

  /**
   * 개인이 승인한 문자 정책의 적용 가능성만 읽는다. 상태·정책·카드·중복 검증은
   * 실제 적용과 공유하며 금액 명령, 감사 기록, 이벤트 갱신을 실행하지 않는다.
   */
  async previewAutomatic(
    eventId: string,
    expectedEventUpdatedAt: Date,
    expectedPolicyUpdatedAt: Date,
  ): Promise<AutomaticPromotionPreview> {
    try {
      await this.db.transaction(async (tx) => {
        await this.prepareAutomatic(tx, eventId, expectedEventUpdatedAt, expectedPolicyUpdatedAt, false);
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
      return { status: 'eligible' };
    } catch (error: unknown) {
      if (error instanceof AutomaticPromotionBlocked) return { status: 'blocked', reason: error.message };
      throw error;
    }
  }

  /**
   * 명시적으로 재사용을 승인한 본인 정책만 자동 적용한다. 이벤트·정책·회원·카드를
   * 잠근 뒤 원문을 다시 해석하고, 거래 생성·이벤트 갱신·자동 주체 감사를 함께 커밋한다.
   * 차단은 무변경이며 저장 오류는 호출자에게 전파한다. LLM과 알림은 호출하지 않는다.
   */
  async promoteAutomatic(
    eventId: string,
    expectedEventUpdatedAt: Date,
    expectedPolicyUpdatedAt: Date,
  ): Promise<AutomaticPromotionOutcome> {
    try {
      const applied = await this.db.transaction(async (tx) => {
        const prepared = await this.prepareAutomatic(tx, eventId, expectedEventUpdatedAt, expectedPolicyUpdatedAt, true);
        const { event, policy, result, card, merchantNormalized, categoryId } = prepared;
        this.assertAutomaticRuntime();
        const command = await this.moneyWrite.commands.createApproval({
          metadata: {
            householdId: event.householdId, memberId: event.memberId, cardId: card.cardId,
            sourceEventId: event.id, merchantRaw: result.merchantRaw, merchantNormalized,
            categoryId, authorizationCode: null, installmentMonths: result.installmentMonths ?? null,
            visibility: card.visibility, memo: null,
          },
          minorUnits: result.amount, currency: 'KRW', occurredAt: result.occurredAt,
          receivedAt: event.receivedAt, reviewFlag: null,
        }, { tx });
        if (!command.ok) throw new AutomaticPromotionBlocked('money_command_rejected');
        if (command.value.alreadyPromoted) throw new AutomaticPromotionBlocked('already_promoted');

        const now = new Date();
        await tx.update(schema.cardSmsEvents).set({
          parseStatus: 'parsed', parseError: null, issuer: result.issuer,
          transactionType: 'approval', declineReason: null, amount: result.amount, currency: 'KRW',
          merchantRaw: result.merchantRaw, occurredAt: result.occurredAt,
          maskedCardNumber: result.maskedCardNumber ?? null,
          installmentMonths: result.installmentMonths ?? null, confidence: result.confidence,
          parsedAt: now, updatedAt: now,
        }).where(eq(schema.cardSmsEvents.id, event.id));
        const [audit] = await tx.insert(schema.pipelineRuns).values({
          pipelineName: 'card-sms-automatic-recovery', pipelineVersion: 'v1',
          scopeType: 'card-sms-event', scopeId: event.id, trigger: 'scheduled',
          status: 'succeeded', startedAt: now, finishedAt: now,
        }).returning({ id: schema.pipelineRuns.id });
        if (!audit) throw new Error('automatic_recovery_audit_missing');
        await tx.insert(schema.pipelineStepRuns).values({
          pipelineRunId: audit.id, stepName: 'approved-policy-promotion', stepVersion: 'v1',
          status: 'succeeded', inputCount: 1, outputCount: 1, rejectedCount: 0,
          metrics: { actor: 'automatic', policyId: policy.id }, startedAt: now, finishedAt: now,
        });
        await this.verifyAutomatic(tx, prepared, command.value.transactionId);
        return { prepared, transactionId: command.value.transactionId };
      }, { isolationLevel: 'serializable' });

      // 같은 트랜잭션의 읽기 검증과 COMMIT 성공으로 완료를 판정한다.
      // 커밋 이후의 정상 취소·사용자 수정은 이 승인 저장의 실패로 되돌려 해석하지 않는다.
      return { status: 'applied', transactionId: applied.transactionId };
    } catch (error: unknown) {
      if (error instanceof AutomaticPromotionBlocked) return { status: 'blocked', reason: error.message };
      throw error;
    }
  }

  private assertAutomaticRuntime(): void {
    if (!this.moneyWrite.enforced) throw new AutomaticPromotionBlocked('money_contract_not_enforced');
    if (!this.moneyRuntime || this.moneyRuntime.isPromotionPaused) {
      throw new AutomaticPromotionBlocked('promotion_paused');
    }
  }

  private async prepareAutomatic(
    tx: DbExecutor, eventId: string, expectedEventUpdatedAt: Date,
    expectedPolicyUpdatedAt: Date, lock: boolean,
  ): Promise<AutomaticPreparation> {
    this.assertAutomaticRuntime();
    const eventQuery = tx.select().from(schema.cardSmsEvents).where(eq(schema.cardSmsEvents.id, eventId)).limit(1);
    const [event] = await (lock ? eventQuery.for('update') : eventQuery);
    if (!event || !['parse_failed', 'quarantined'].includes(event.parseStatus)) {
      throw new AutomaticPromotionBlocked('event_not_eligible');
    }
    if (event.updatedAt.getTime() !== expectedEventUpdatedAt.getTime()) {
      throw new AutomaticPromotionBlocked('event_changed');
    }
    const [existing] = await tx.select({ id: schema.cardTransactions.id }).from(schema.cardTransactions)
      .where(eq(schema.cardTransactions.sourceEventId, event.id)).limit(1);
    if (existing) throw new AutomaticPromotionBlocked('already_promoted');

    const fingerprint = scopedTemplateFingerprint(event.householdId, event.memberId, event.sender, event.rawContent);
    const policyQuery = tx.select().from(schema.cardSmsTemplates)
      .where(eq(schema.cardSmsTemplates.fingerprint, fingerprint)).limit(1);
    const [policy] = await (lock ? policyQuery.for('update') : policyQuery);
    if (!policy || !isApprovedRecipe(policy.recipe) || !policy.sourceEventId || !policy.confirmedBy) {
      throw new AutomaticPromotionBlocked('policy_not_approved');
    }
    if (policy.updatedAt.getTime() !== expectedPolicyUpdatedAt.getTime()) {
      throw new AutomaticPromotionBlocked('policy_changed');
    }
    if (policy.recipe.householdId !== event.householdId || policy.recipe.memberId !== event.memberId
      || policy.recipe.fingerprint !== templateFingerprint(event.sender, event.rawContent)) {
      throw new AutomaticPromotionBlocked('policy_scope_mismatch');
    }
    const sourceQuery = tx.select().from(schema.cardSmsEvents)
      .where(eq(schema.cardSmsEvents.id, policy.sourceEventId)).limit(1);
    const [source] = await (lock ? sourceQuery.for('share') : sourceQuery);
    if (!source || source.householdId !== event.householdId || source.memberId !== event.memberId
      || source.parseStatus !== 'parsed'
      || scopedTemplateFingerprint(source.householdId, source.memberId, source.sender, source.rawContent) !== fingerprint) {
      throw new AutomaticPromotionBlocked('policy_source_invalid');
    }
    const memberQuery = tx.select({ id: schema.householdMembers.id }).from(schema.householdMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.householdMembers.userId))
      .innerJoin(schema.households, eq(schema.households.id, schema.householdMembers.householdId))
      .where(and(eq(schema.householdMembers.id, event.memberId),
        eq(schema.householdMembers.householdId, event.householdId),
        eq(schema.householdMembers.userId, policy.confirmedBy), eq(schema.householdMembers.status, 'active'),
        isNull(schema.users.deletedAt), isNull(schema.households.deletedAt))).limit(1);
    const [member] = await (lock ? memberQuery.for('share') : memberQuery);
    if (!member) throw new AutomaticPromotionBlocked('member_not_active');
    const sourceIds = [...new Set([source.sourceItemId, event.sourceItemId])].sort();
    const itemsQuery = tx.select({ id: schema.sourceItems.id }).from(schema.sourceItems)
      .where(and(inArray(schema.sourceItems.id, sourceIds), isNull(schema.sourceItems.deletedAt)))
      .orderBy(schema.sourceItems.id);
    const items = await (lock ? itemsQuery.for('share') : itemsQuery);
    if (items.length !== sourceIds.length) throw new AutomaticPromotionBlocked('source_deleted');

    const input = { sender: event.sender, content: event.rawContent, receivedAt: event.receivedAt };
    const extraction = applyRecipe(input, policy.recipe);
    const rejection = automaticApprovalRejection(input, extraction.result, extraction.rejected);
    if (rejection !== null) throw new AutomaticPromotionBlocked(rejection);
    const result = extraction.result;
    if (result.amount === undefined || !result.merchantRaw || !result.occurredAt) {
      throw new AutomaticPromotionBlocked('incomplete_fields');
    }
    const cardsQuery = tx.select({ id: schema.paymentCards.id, maskedNumber: schema.paymentCards.maskedNumber,
      issuer: schema.paymentCards.issuer, visibility: schema.paymentCards.visibility,
      ownerMemberId: schema.paymentCards.ownerMemberId, isShared: schema.paymentCards.isShared,
    }).from(schema.paymentCards).where(and(eq(schema.paymentCards.householdId, event.householdId),
      eq(schema.paymentCards.status, 'active'))).orderBy(schema.paymentCards.id);
    // 같은 카드의 자동 복구끼리 중복 검사와 삽입이 동시에 통과하지 않게 직렬화한다.
    const cards = await (lock ? cardsQuery.for('update') : cardsQuery);
    const approvedCard = cards.find(card => card.id === policy.recipe.approvedCardId);
    const card = resolvePaymentCardLink({ memberId: event.memberId,
      maskedCardNumber: result.maskedCardNumber ?? null, issuer: result.issuer ?? null }, cards);
    if (!approvedCard || (approvedCard.ownerMemberId !== event.memberId && !approvedCard.isShared)
      || card.ambiguous || card.cardId !== approvedCard.id) {
      throw new AutomaticPromotionBlocked('card_not_unique_owner');
    }
    const merchantNormalized = await this.resolveMerchantAlias(event.householdId, normalizeMerchant(result.merchantRaw), tx);
    if (await this.isDuplicateApproval(event.householdId, event.memberId, approvedCard.id,
      result.amount, 'KRW', merchantNormalized, result.occurredAt, tx)) {
      throw new AutomaticPromotionBlocked('duplicate_suspected');
    }
    const categoryId = await this.resolveCategoryId(event.householdId, result.merchantRaw, merchantNormalized, tx);
    return { event, policy, result: { ...result, amount: result.amount,
      merchantRaw: result.merchantRaw, occurredAt: result.occurredAt },
      card: { ...card, cardId: approvedCard.id }, merchantNormalized, categoryId };
  }

  private async verifyAutomatic(tx: DbExecutor, prepared: AutomaticPreparation, transactionId: string): Promise<void> {
    const [row] = await tx.select({ transaction: schema.cardTransactions, event: schema.cardSmsEvents })
      .from(schema.cardTransactions).innerJoin(schema.cardSmsEvents,
        eq(schema.cardSmsEvents.id, schema.cardTransactions.sourceEventId))
      .where(eq(schema.cardTransactions.id, transactionId)).limit(1);
    const { event, result, card } = prepared;
    if (!row || row.transaction.sourceEventId !== event.id || row.transaction.householdId !== event.householdId
      || row.transaction.memberId !== event.memberId || row.transaction.cardId !== card.cardId
      || row.transaction.transactionType !== 'approval' || row.transaction.currency !== 'KRW'
      || row.transaction.amount !== result.amount || row.transaction.netAmount !== result.amount
      || row.transaction.status !== 'approved' || row.transaction.merchantRaw !== result.merchantRaw
      || row.transaction.approvedAt?.getTime() !== result.occurredAt.getTime()
      || row.event.parseStatus !== 'parsed' || row.event.amount !== result.amount) {
      throw new Error('automatic_recovery_verification_failed');
    }
  }

  /**
   * 파싱 이벤트를 거래로 승격한다(스펙 §6 절차). 승격 대상이 아니거나 이미 승격된
   * 경우 조용히 skip한다(멱등). 예외는 상위(잡)로 전파해 재시도되게 둔다.
   */
  async promote(cardSmsEventId: string, options: { repair?: boolean } = {}): Promise<void> {
    if (!cardSmsEventId) {
      throw new Error('promote() called without cardSmsEventId');
    }

    // 1. 이벤트 조회 + 승격 대상 판정.
    const [event] = await this.db
      .select()
      .from(schema.cardSmsEvents)
      .where(eq(schema.cardSmsEvents.id, cardSmsEventId))
      .limit(1);

    if (!event) {
      this.logger.warn({ cardSmsEventId }, 'promotion skipped: event not found');
      return;
    }

    if (event.parseStatus !== 'parsed' && event.parseStatus !== 'pending_review') {
      this.logger.info(
        { cardSmsEventId, parseStatus: event.parseStatus },
        'promotion skipped: parse status not promotable',
      );
      return;
    }

    const amount = event.amount;
    if (amount === null) {
      this.logger.info({ cardSmsEventId }, 'promotion skipped: amount missing');
      return;
    }
    // minor-units 안전정수 불변식(부동소수 차단, PRD §10). 통화 무관 정수 검증이며,
    // 스케일/통화 정합은 파서가 보장한다. 파서 결함을 여기서도 막는다.
    assertKrwInteger(amount);

    const transactionType = event.transactionType;
    if (transactionType !== 'approval' && transactionType !== 'cancellation') {
      this.logger.info(
        { cardSmsEventId, transactionType },
        'promotion skipped: transaction type not promotable',
      );
      return;
    }

    // 2. 멱등 사전 점검(이미 승격됨 → skip). 실질 보증은 insert의 onConflictDoNothing.
    const [existing] = await this.db
      .select({ id: schema.cardTransactions.id })
      .from(schema.cardTransactions)
      .where(eq(schema.cardTransactions.sourceEventId, event.id))
      .limit(1);

    if (existing) {
      this.logger.info(
        { cardSmsEventId, transactionType, status: 'already_promoted' },
        'promotion skipped: already promoted',
      );
      return;
    }

    // 파싱 후 승격이 중단되어 스케줄러가 다시 호출해도 무과금·무알림 정책을 보존한다.
    // 재처리 잡의 기존 pipeline 감사 이력이 원본 이벤트에 결박된 영속 근거다.
    let repair = options.repair === true;
    if (!repair) {
      const [repairRun] = await this.db.select({ id: schema.pipelineRuns.id }).from(schema.pipelineRuns)
        .where(and(
          eq(schema.pipelineRuns.pipelineName, 'card-sms-parse'),
          eq(schema.pipelineRuns.scopeType, 'card-sms-event'),
          eq(schema.pipelineRuns.scopeId, event.id),
          sql`starts_with(${schema.pipelineRuns.externalRunId}, ${`smsrepair_${event.id}_`})`,
        )).limit(1);
      repair = repairRun !== undefined;
    }

    // 3. 카드 자동연결(뒤 4자리 → 없으면 발급사 폴백) → cardId, visibility 상속.
    const link = await this.resolveCard(
      event.householdId,
      event.memberId,
      event.maskedCardNumber,
      event.issuer,
    );

    // 4. 가맹점 정규화(원문 없으면 null) → 사용자가 확정한 별칭으로 치환.
    //    별칭 해석을 카테고리 조회보다 **먼저** 해야 규칙이 대표 이름 하나로 모인다
    //    (안 하면 GS25처럼 한 브랜드가 6개 키로 쪼개져 규칙도 6번 학습된다).
    const merchantNormalized = await this.resolveMerchantAlias(
      event.householdId,
      event.merchantRaw ? normalizeMerchant(event.merchantRaw) : null,
    );

    // 5. 카테고리: 사용자 규칙 → 키워드(시스템 카테고리) → null.
    const categoryId = await this.resolveCategoryId(
      event.householdId,
      event.merchantRaw,
      merchantNormalized,
    );

    // 5.5. 외화면 승인 시점 환율로 KRW 환산(원화 지출/예산/집계에 통합). 이후 승격은
    // 전부 converted.amount(KRW minor units) 기준 — 원통화는 original*로 병기 보존.
    const converted = await this.convertToKrw(event, amount);

    // 6/7. 거래유형별 승격.
    if (transactionType === 'approval') {
      const { status, transactionId } = await this.promoteApproval(
        event,
        converted,
        link,
        merchantNormalized,
        categoryId,
      );
      this.logger.info(
        { cardSmsEventId, transactionType, status },
        'promotion completed',
      );
      // 승격 트랜잭션이 끝난 뒤 새 금액 계약과 대조한다(ADR-0027 3단계, 기록만).
      await this.moneyShadow.observe(transactionId, 'worker_promotion_approval');
      // 새로 승격됐고 미분류면 LLM 카테고리 제안을 enqueue(가맹점 단위 dedupe).
      if (!repair && status !== 'already_promoted' && categoryId === null) {
        await this.enqueueCategorySuggestion(event, merchantNormalized);
      }
      // 새로 승격된 거래는 푸시 알림을 enqueue(수신자/마스킹은 소비자가 결정).
      if (!repair && status !== 'already_promoted' && transactionId) {
        await this.enqueueNotification(event.householdId, transactionId);
        // 이 지출이 예산 임계(80/100%)를 새로 넘겼으면 예산 알림도 enqueue.
        await this.checkBudgetAlerts({
          householdId: event.householdId,
          memberId: event.memberId,
          cardId: link.cardId ?? null,
          categoryId,
        });
      }
      return;
    }

    const outcome = await this.promoteCancellation(
      event,
      converted,
      link,
      merchantNormalized,
      categoryId,
    );
    this.logger.info(
      {
        cardSmsEventId,
        transactionType,
        status: outcome.skipped ? 'already_promoted' : outcome.status,
        linked: outcome.linked,
      },
      outcome.skipped ? 'promotion skipped: already promoted' : 'promotion completed',
    );
    // 취소는 연결 대상까지 대조한다 — 새 후보 규칙(원통화 잔액·증거 필수)이 같은
    // 승인을 고르는지가 이 단계에서 재야 할 값이다.
    await this.moneyShadow.observe(outcome.transactionId, 'worker_promotion_cancellation');
    if (!repair && !outcome.skipped && categoryId === null) {
      await this.enqueueCategorySuggestion(event, merchantNormalized);
    }
    if (!repair && !outcome.skipped && outcome.transactionId) {
      await this.enqueueNotification(event.householdId, outcome.transactionId);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 외화 환산                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * v2는 서울 거래일의 불변 스냅샷과 도메인 정수 산술로 환산한다. 중복 비교와
   * 실제 저장의 금액이 일치해야 한다. KRW는 그대로, legacy/shadow 모드만 기존
   * 최신 환율 경로를 유지한다. 원통화 원본과 호환 표시 환율은 함께 보존한다.
   */
  private async convertToKrw(
    event: schema.CardSmsEvent,
    amount: number,
  ): Promise<ConvertedAmount> {
    const rawCurrency = (event.currency ?? 'KRW').toUpperCase();
    if (rawCurrency === 'KRW') {
      return {
        amount,
        currency: 'KRW',
        originalAmount: null,
        originalCurrency: null,
        exchangeRate: null,
      };
    }

    if (this.moneyWrite.enforced) {
      // Acquire before the approval/card lock. The same immutable snapshot and
      // integer math feed both duplicate comparison and the domain write.
      const snapshot = await this.moneyWrite.fxSnapshots.find({
        baseCurrency: rawCurrency,
        asOfDate: fxBaseDate(event.occurredAt, event.receivedAt),
        moneyContractVersion: MONEY_CONTRACT_VERSION_V2,
      });
      if (!snapshot) {
        throw new Error(`money contract rejected ${event.transactionType}: fx_snapshot_missing`);
      }
      const converted = convertMoneyToKrw(amount, rawCurrency, snapshot.rate);
      if (!converted.ok) {
        throw new Error(`money contract rejected ${event.transactionType}: ${converted.failure}`);
      }
      this.logger.info(
        { cardSmsEventId: event.id, originalCurrency: rawCurrency },
        'foreign amount converted using transaction-date snapshot',
      );
      return {
        amount: converted.krw,
        currency: 'KRW',
        originalAmount: amount,
        originalCurrency: rawCurrency,
        exchangeRate: fxRateDisplayValue(snapshot.rate),
      };
    }

    const rate = await this.fxRate.getRateToKrw(rawCurrency);
    const major = amount / 10 ** currencyExponent(rawCurrency);
    const krw = Math.round(major * rate);
    assertKrwInteger(krw);
    this.logger.info(
      { cardSmsEventId: event.id, originalCurrency: rawCurrency, exchangeRate: rate },
      'foreign amount converted to KRW',
    );
    return {
      amount: krw,
      currency: 'KRW',
      originalAmount: amount,
      originalCurrency: rawCurrency,
      exchangeRate: rate,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* 승인 승격                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * 승인 거래를 승격한다(스펙 §6.6). 카드 자동연결이 모호하면(뒤 4자리 중복)
   * status='pending_review'로 남겨 검토를 유도한다. 그렇지 않으면 2차 유사중복이면
   * 'duplicate_suspected', 아니면 'approved'. netAmount=amount, cancelledAmount=0,
   * approvedAt=occurredAt. onConflictDoNothing(sourceEventId)로 재승격을 흡수한다.
   *
   * @returns 실제 기록된 status. 경합으로 삽입되지 않았으면 'already_promoted'.
   */
  private async promoteApproval(
    event: schema.CardSmsEvent,
    converted: ConvertedAmount,
    link: CardLink,
    merchantNormalized: string | null,
    categoryId: string | null,
  ): Promise<{
    status: TransactionStatus | 'already_promoted';
    transactionId: string | null;
  }> {
    const amount = converted.amount;
    // 모호 매칭은 cardId=null이라 중복 판정 기준(카드)이 없고, '어느 카드인지 미정'
    // 자체가 검토 대상이므로 중복 검사를 건너뛰고 pending_review로 확정한다.
    let status: TransactionStatus;
    if (link.ambiguous) {
      status = 'pending_review';
    } else {
      // 외화도 승격 시 KRW로 환산돼 저장되므로 중복 비교 통화는 항상 KRW.
      const isDuplicate = await this.isDuplicateApproval(
        event.householdId,
        event.memberId,
        link.cardId,
        amount,
        converted.currency,
        merchantNormalized,
        event.occurredAt,
      );
      status = isDuplicate ? 'duplicate_suspected' : 'approved';
    }

    const metadata = {
      householdId: event.householdId,
      memberId: event.memberId,
      cardId: link.cardId,
      sourceEventId: event.id,
      merchantRaw: event.merchantRaw ?? null,
      merchantNormalized,
      categoryId,
      // card_sms_events/파서에 승인번호가 없어 항상 null(향후 파서 확장 대비).
      authorizationCode: null,
      installmentMonths: event.installmentMonths ?? null,
      visibility: link.visibility,
      memo: null,
    };

    /**
     * ADR-0027 5단계 — **D-1이 여기서 닫힌다.**
     *
     * legacy의 `getRateToKrw(currency)`는 오늘 환율을 받았고 재시도 시 금액이 바뀌었다.
     * v2 앞단의 중복 비교도 이제 거래일 스냅샷과 정수 산술을 사용한다.
     *
     * enforce가 켜지면 원통화 금액을 그대로 넘기고 **거래일 스냅샷**으로 환산한다.
     * 스냅샷이 없으면 승격하지 않는다 — 오늘 환율로 대체하는 것이 D-1이었다.
     * 중복 판정에는 여전히 `converted`를 쓴다(비교 기준 통화를 KRW로 유지).
     */
    if (this.moneyWrite.enforced) {
      const result = await this.db.transaction(async (tx) => {
        if (link.cardId) {
          // 자동 복구와 일반 수신이 같은 카드를 잠그고 중복을 다시 확인한다.
          await tx.select({ id: schema.paymentCards.id }).from(schema.paymentCards)
            .where(eq(schema.paymentCards.id, link.cardId)).for('update');
        }
        if (!link.ambiguous) {
          status = await this.isDuplicateApproval(event.householdId, event.memberId, link.cardId,
            amount, converted.currency, merchantNormalized, event.occurredAt, tx)
            ? 'duplicate_suspected' : 'approved';
        }
        return this.moneyWrite.commands.createApproval({
          metadata,
          minorUnits: converted.originalAmount ?? amount,
          currency: converted.originalCurrency ?? converted.currency,
          occurredAt: event.occurredAt ?? null,
          receivedAt: event.receivedAt,
          reviewFlag: status === 'duplicate_suspected' || status === 'pending_review' ? status : null,
        }, { tx });
      }, { isolationLevel: 'serializable' });
      if (!result.ok) {
        // 승격 실패는 잡 재시도로 이어진다 — 조용히 틀린 금액을 확정하는 것보다
        // 반영이 늦는 편이 안전하다는 것이 ADR의 판단이다.
        this.logger.warn(
          { cardSmsEventId: event.id, reason: result.reason },
          'money contract rejected approval promotion',
        );
        throw new Error(`money contract rejected approval: ${result.reason}`);
      }
      return result.value.alreadyPromoted
        ? { status: 'already_promoted', transactionId: null }
        : { status, transactionId: result.value.transactionId };
    }

    const result = await this.moneyWrite.legacy.createApproval({
      metadata,
      money: converted,
      occurredAt: event.occurredAt ?? null,
      status,
    });
    if (!result.ok) {
      throw new Error(`legacy money rejected approval: ${result.reason}`);
    }
    return result.value.alreadyPromoted
      ? { status: 'already_promoted', transactionId: null }
      : { status, transactionId: result.value.transactionId };
  }

  /**
   * 2차 유사중복 판정: 같은 household/card, 동일 amount, 유사(정확) merchantNormalized,
   * 승인시각 ±DUPLICATE_TIME_WINDOW_MS 근접한 기존 승인이 있으면 true.
   * occurredAt이 없으면 시각 비교 불가로 false(과도한 오탐 방지).
   */
  private async isDuplicateApproval(
    householdId: string,
    memberId: string,
    cardId: string | null,
    amount: number,
    currency: string,
    merchantNormalized: string | null,
    occurredAt: Date | null,
    executor: DbExecutor = this.db,
  ): Promise<boolean> {
    if (!occurredAt) {
      return false;
    }

    const lower = new Date(occurredAt.getTime() - DUPLICATE_TIME_WINDOW_MS);
    const upper = new Date(occurredAt.getTime() + DUPLICATE_TIME_WINDOW_MS);

    // amount는 minor units라 통화가 다르면 값이 같아도 의미가 다르다($22.00=2200 vs
    // ₩2,200=2200). 반드시 동일 통화 안에서만 중복을 비교한다.
    const conditions: SQL[] = [
      eq(schema.cardTransactions.householdId, householdId),
      eq(schema.cardTransactions.transactionType, 'approval'),
      eq(schema.cardTransactions.amount, amount),
      eq(schema.cardTransactions.currency, currency),
      gte(schema.cardTransactions.approvedAt, lower),
      lte(schema.cardTransactions.approvedAt, upper),
    ];
    if (cardId) {
      conditions.push(eq(schema.cardTransactions.cardId, cardId));
    } else {
      conditions.push(
        isNull(schema.cardTransactions.cardId),
        eq(schema.cardTransactions.memberId, memberId),
      );
    }
    if (merchantNormalized) {
      conditions.push(eq(schema.cardTransactions.merchantNormalized, merchantNormalized));
    }

    const [row] = await executor
      .select({ id: schema.cardTransactions.id })
      .from(schema.cardTransactions)
      .where(and(...conditions))
      .limit(1);

    return Boolean(row);
  }

  /* ---------------------------------------------------------------------- */
  /* 취소 승격                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * 취소 거래를 승격한다(스펙 §6.7). 취소 레코드를 먼저 삽입(netAmount=0,
   * cancelledAt=occurredAt, status='pending_review')하고, 대응 승인이 유일하게
   * 탐색되면 연결한다: 취소 status='approved' + parentTransactionId, 승인
   * cancelledAmount 누적 / netAmount 재계산 / status(cancelled|partially_cancelled).
   * 다중·불명확·미탐색이면 취소 거래를 pending_review로 남긴다.
   *
   * 멱등: 삽입이 실제로 일어난 경우에만 승인 잔액을 갱신한다(재승격 시 이중 반영 방지).
   */
  private async promoteCancellation(
    event: schema.CardSmsEvent,
    converted: ConvertedAmount,
    link: CardLink,
    merchantNormalized: string | null,
    categoryId: string | null,
  ): Promise<CancellationOutcome> {
    const amount = converted.amount;
    const cancelledAt = event.occurredAt ?? null;

    /**
     * ADR-0027 5단계 — **D-1과 P0-8이 여기서 닫힌다.**
     *
     * 아래 legacy 경로는 취소를 **KRW 환산액**으로 승인과 비교한다. 승인과 취소가
     * 서로 다른 날 환산되면 같은 외화 전액취소도 잔액이 남았다(USD 100 승인 1,300원
     * → 전액취소 1,400원 → `130,000 >= 140,000` 실패). 새 계약은 **원통화 잔액**으로
     * 연결하고 승인 환율로 상계하므로 환율 방향과 무관하게 0이 된다(ADR §4).
     *
     * 후보를 못 고르면 `match: 'none' | 'ambiguous'`가 오고, 그때 취소는 연결되지 않은
     * 채 `pending_review`로 남는다 — legacy와 같은 판단이다.
     */
    if (this.moneyWrite.enforced) {
      const result = await this.moneyWrite.commands.createCancellation({
        metadata: {
          householdId: event.householdId,
          memberId: event.memberId,
          cardId: link.cardId,
          sourceEventId: event.id,
          merchantRaw: event.merchantRaw ?? null,
          merchantNormalized,
          categoryId,
          authorizationCode: null,
          installmentMonths: event.installmentMonths ?? null,
          visibility: link.visibility,
          memo: null,
        },
        minorUnits: converted.originalAmount ?? amount,
        currency: converted.originalCurrency ?? converted.currency,
        occurredAt: cancelledAt,
        receivedAt: event.receivedAt,
      });
      if (!result.ok) {
        this.logger.warn(
          { cardSmsEventId: event.id, reason: result.reason },
          'money contract rejected cancellation promotion',
        );
        throw new Error(`money contract rejected cancellation: ${result.reason}`);
      }
      const linked = result.value.parentTransactionId !== null;
      return {
        status: linked ? 'approved' : 'pending_review',
        linked,
        skipped: result.value.alreadyPromoted,
        // 재승격이면 legacy와 같이 id를 돌려주지 않는다 — 호출부가 이 값으로 알림·
        // 카테고리 제안을 enqueue하므로, 이미 처리된 거래에 두 번 보내면 안 된다.
        transactionId: result.value.alreadyPromoted ? null : result.value.transactionId,
      };
    }

    // The legacy domain owns insertion, unique-parent selection, row locking,
    // cancellation claim and parent cumulative amounts in one transaction.
    const result = await this.moneyWrite.legacy.createCancellation({
      metadata: {
        householdId: event.householdId,
        memberId: event.memberId,
        cardId: link.cardId,
        sourceEventId: event.id,
        merchantRaw: event.merchantRaw ?? null,
        merchantNormalized,
        categoryId,
        authorizationCode: null,
        installmentMonths: event.installmentMonths ?? null,
        visibility: link.visibility,
        memo: null,
      },
      money: converted,
      occurredAt: cancelledAt,
    });
    if (!result.ok) {
      throw new Error(`legacy money rejected cancellation: ${result.reason}`);
    }
    return {
      status: result.value.status,
      linked: result.value.linked,
      skipped: result.value.alreadyPromoted,
      transactionId: result.value.alreadyPromoted ? null : result.value.transactionId,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* 카드 자동연결 / 카테고리                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * 원본 구성원과 카드 식별 정보를 공통 규칙으로 판정한다. 카드 등록 시의
   * 과거 거래 연결도 같은 함수를 사용해 서로 다른 소유자 판단을 하지 않는다.
   */
  private async resolveCard(
    householdId: string,
    memberId: string,
    maskedCardNumber: string | null,
    issuer: string | null,
  ): Promise<CardLink> {
    const cards = await this.db
      .select({
        id: schema.paymentCards.id,
        maskedNumber: schema.paymentCards.maskedNumber,
        issuer: schema.paymentCards.issuer,
        visibility: schema.paymentCards.visibility,
        ownerMemberId: schema.paymentCards.ownerMemberId,
        isShared: schema.paymentCards.isShared,
      })
      .from(schema.paymentCards)
      .where(
        and(
          eq(schema.paymentCards.householdId, householdId),
          eq(schema.paymentCards.status, 'active'),
        ),
      );

    const result = resolvePaymentCardLink({ memberId, maskedCardNumber, issuer }, cards);
    if (result.ambiguous) {
      this.logger.warn(
        { householdId },
        'card auto-link unresolved: ownership or card identity requires review',
      );
    }
    return result;
  }

  /**
   * 카테고리 우선순위(스펙 §1.3, LLM 제외):
   * 1) merchant_category_rules(household, merchantNormalized 정확매칭)
   * 2) 키워드(categorizeByKeyword → slug → 시스템 expense_categories id)
   * 3) 미분류(null).
   */
  /**
   * 사용자가 확정한 가맹점 별칭을 **1단계** 해석한다(`merchant_aliases`).
   * 등록되지 않았으면 입력을 그대로 돌려주므로 별칭이 없는 가구는 종전과 동일하다.
   *
   * 체인(`A->B`, `B->C`)을 따라가지 않는 이유: 등록 API가 저장 시점에 평탄화하므로
   * 여기서 재귀할 필요가 없고, 재귀는 순환 데이터에 무한 루프로 취약하다.
   */
  private async resolveMerchantAlias(
    householdId: string,
    merchantNormalized: string | null,
    executor: DbExecutor = this.db,
  ): Promise<string | null> {
    if (merchantNormalized === null || merchantNormalized.length === 0) {
      return merchantNormalized;
    }
    const [row] = await executor
      .select({ canonical: schema.merchantAliases.canonical })
      .from(schema.merchantAliases)
      .where(
        and(
          eq(schema.merchantAliases.householdId, householdId),
          eq(schema.merchantAliases.alias, merchantNormalized),
        ),
      )
      .limit(1);
    return row?.canonical ?? merchantNormalized;
  }

  private async resolveCategoryId(
    householdId: string,
    merchantRaw: string | null,
    merchantNormalized: string | null,
    executor: DbExecutor = this.db,
  ): Promise<string | null> {
    if (merchantNormalized) {
      const [rule] = await executor
        .select({ categoryId: schema.merchantCategoryRules.categoryId })
        .from(schema.merchantCategoryRules)
        .where(
          and(
            eq(schema.merchantCategoryRules.householdId, householdId),
            eq(schema.merchantCategoryRules.merchantPattern, merchantNormalized),
          ),
        )
        .limit(1);
      if (rule) {
        return rule.categoryId;
      }
    }

    const keywordSource = merchantNormalized ?? merchantRaw;
    if (keywordSource) {
      const slug = categorizeByKeyword(keywordSource);
      if (slug) {
        const [category] = await executor
          .select({ id: schema.expenseCategories.id })
          .from(schema.expenseCategories)
          .where(
            and(
              eq(schema.expenseCategories.slug, slug),
              isNull(schema.expenseCategories.householdId),
            ),
          )
          .limit(1);
        if (category) {
          return category.id;
        }
      }
    }

    return null;
  }

  /**
   * 미분류(categoryId=null)로 승격된 거래의 가맹점에 대해 LLM 카테고리 제안 잡을
   * enqueue 한다(카테고리 우선순위의 LLM tier — 가맹점 단위 1회, 비동기 자가학습).
   *
   * - jobId = `catsug_${householdId}_${md5(merchantNormalized)}` — BullMQ 커스텀
   *   jobId 에는 ':' 를 쓸 수 없어 밑줄을 사용하고, 같은 가맹점의 반복 승격이
   *   만드는 중복 enqueue 를 흡수한다(dedupe). removeOnComplete 로 완료 잡을
   *   제거해 이후 재제안(예: 규칙 삭제 후 재수집)이 가능하다.
   * - merchant 가 없으면 enqueue 하지 않는다(제안 대상 없음).
   * - enqueue 실패는 승격을 실패시키지 않는다(best-effort 부가 기능). 잡 재시도
   *   시 이미 승격된 이벤트는 조기 반환되어 재-enqueue 기회가 없으므로, 예외를
   *   전파해도 제안만 잃는다 — warn 로그 후 흡수한다.
   */
  private async enqueueCategorySuggestion(
    event: schema.CardSmsEvent,
    merchantNormalized: string | null,
  ): Promise<void> {
    if (!merchantNormalized) {
      return;
    }
    const merchantHash = createHash('md5').update(merchantNormalized).digest('hex');
    try {
      await this.categorySuggestQueue.add(
        'suggest',
        {
          householdId: event.householdId,
          merchantNormalized,
          merchantRaw: event.merchantRaw ?? merchantNormalized,
        },
        {
          jobId: `catsug_${event.householdId}_${merchantHash}`,
          removeOnComplete: true,
        },
      );
    } catch {
      // 로그는 식별자/해시 일부만(가맹점 원문·PII 미기록).
      this.logger.warn(
        { cardSmsEventId: event.id, merchantHash: merchantHash.slice(0, 12) },
        'category-suggest enqueue failed; transaction stays unclassified',
      );
    }
  }

  /**
   * 새로 승격된 거래에 대해 푸시 알림 잡을 enqueue 한다(수신자 해석·마스킹·선호
   * 필터는 소비자가 담당). jobId=`notif_${transactionId}`로 재승격/경합의 중복
   * enqueue 를 흡수한다. enqueue 실패는 승격을 실패시키지 않는다(best-effort —
   * 앱 내 SSE/폴링이 안전망). 페이로드에 PII 없음(식별자만).
   */
  private async enqueueNotification(
    householdId: string,
    transactionId: string,
  ): Promise<void> {
    try {
      const payload: NotificationDispatchJob = {
        kind: 'transaction',
        householdId,
        transactionId,
      };
      await this.notificationQueue.add('dispatch', payload, {
        jobId: `notif_${transactionId}`,
        removeOnComplete: true,
      });
    } catch {
      this.logger.warn(
        { transactionId },
        'notification enqueue failed; push skipped (in-app still updates)',
      );
    }
  }

  /**
   * 방금 승격된 approval 지출이 영향을 준 예산들의 이번 달 사용률을 재계산해,
   * 80%/100% 임계를 **새로** 넘긴 예산에 대해 예산 알림을 enqueue 한다.
   * dedupe는 `budget_alert_state` UNIQUE(예산,월,임계)로 "임계당 1회"를 보장한다.
   * 한 거래가 여러 임계를 동시에 넘겨도(예: 0→101%) 가장 높은 미발송 임계만 발송하고
   * 낮은 임계는 마킹만 한다. best-effort(실패해도 승격은 유지).
   */
  private async checkBudgetAlerts(params: {
    householdId: string;
    memberId: string;
    cardId: string | null;
    categoryId: string | null;
  }): Promise<void> {
    try {
      const { householdId, memberId, cardId, categoryId } = params;

      // 이 거래가 영향을 주는 예산만 조회(scope 매칭) — 전체 예산 스캔 회피.
      const scopeMatches: (SQL | undefined)[] = [
        eq(schema.budgets.scopeType, 'household'),
        and(
          eq(schema.budgets.scopeType, 'member'),
          eq(schema.budgets.scopeRefId, memberId),
        ),
      ];
      if (categoryId) {
        scopeMatches.push(
          and(
            eq(schema.budgets.scopeType, 'category'),
            eq(schema.budgets.scopeRefId, categoryId),
          ),
        );
      }
      if (cardId) {
        scopeMatches.push(
          and(
            eq(schema.budgets.scopeType, 'card'),
            eq(schema.budgets.scopeRefId, cardId),
          ),
          and(
            eq(schema.budgets.scopeType, 'card_group'),
            sql`${cardId}::uuid = any(${schema.budgets.cardIds})`,
          ),
        );
      }

      const { from, to, periodMonth } = currentSeoulMonth();
      const effectiveMonth = `${periodMonth}-01`;
      const matched = await this.db
        .select()
        .from(schema.budgets)
        .where(
          and(
            eq(schema.budgets.householdId, householdId),
            // 과거 계획은 감사 기록이다. 현재 거래가 과거월 예산 알림을 다시 울리면 안 된다.
            eq(schema.budgets.effectiveMonth, effectiveMonth),
            or(...scopeMatches),
          ),
        );
      if (matched.length === 0) return;

      for (const budget of matched) {
        const budgetPeriodMonth = budget.effectiveMonth.slice(0, 7);
        // 조회 조건과 insert 사이의 계약을 한 번 더 확인해 alert_state의 월 불일치를 막는다.
        if (budgetPeriodMonth !== periodMonth) continue;
        if (budget.amount <= 0) continue;
        const spent = await this.budgetScopeSpent(budget, from, to);
        const usagePct = Math.floor((spent / budget.amount) * 100);

        // 내림차순 임계 중 넘긴 것들. 삽입 성공(최초 돌파) 중 가장 높은 것만 발송.
        let toSend: number | null = null;
        for (const threshold of BUDGET_ALERT_THRESHOLDS) {
          if (usagePct < threshold) continue;
          const [inserted] = await this.db
            .insert(schema.budgetAlertState)
            .values({ budgetId: budget.id, periodMonth: budgetPeriodMonth, threshold })
            .onConflictDoNothing({
              target: [
                schema.budgetAlertState.budgetId,
                schema.budgetAlertState.periodMonth,
                schema.budgetAlertState.threshold,
              ],
            })
            .returning({ id: schema.budgetAlertState.id });
          if (inserted && toSend === null) toSend = threshold;
        }
        if (toSend === null) continue;

        const payload: NotificationDispatchJob = {
          kind: 'budget',
          householdId,
          budgetId: budget.id,
          budgetName: budget.name ?? '예산',
          threshold: toSend,
        };
        await this.notificationQueue.add('dispatch', payload, {
          jobId: `notif_budget_${budget.id}_${budgetPeriodMonth}_${toSend}`,
          removeOnComplete: true,
        });
      }
    } catch (error) {
      this.logger.warn(
        // DB 오류 메시지에는 카드 식별자·쿼리 인자가 포함될 수 있다.
        { errorType: error instanceof Error ? error.name : 'unknown' },
        'budget alert check failed; skipped (best-effort)',
      );
    }
  }

  /**
   * 예산 scope의 이번 달 순지출(approval netAmount 합). budget.service.computeSpent와
   * 동일 규칙이되 **visibility 필터는 제거**(예산 알림은 특정 뷰어가 아닌 스코프
   * 전체 기준). approvedAt `[from,to)` 창.
   */
  private async budgetScopeSpent(
    budget: schema.Budget,
    from: Date,
    to: Date,
  ): Promise<number> {
    const conditions: SQL[] = [
      eq(schema.cardTransactions.householdId, budget.householdId),
      eq(schema.cardTransactions.transactionType, 'approval'),
      isNull(schema.cardTransactions.excludedAt),
      // 자산 이동(현금 인출·선불 충전)은 예산을 소진시키지 않는다(api budget.service와 동일 규칙).
      notTransferCategory(),
      // 예산 통화(minor units)와 같은 통화만 합산 — 외화 지출이 KRW 예산 소진율을
      // 오염시키지 않게 한다(예산은 단일 통화, 기본 'KRW').
      eq(schema.cardTransactions.currency, budget.currency),
      // 기간 창은 api budget.service와 같은 공통 헬퍼(ADR-0026) — 알림의 사용률과
      // 화면의 사용률이 어긋나면 "80% 알림이 왔는데 화면은 74%"가 된다.
      spendPeriodWindow(from, to),
    ];
    if (budget.scopeType === 'member' && budget.scopeRefId) {
      conditions.push(eq(schema.cardTransactions.memberId, budget.scopeRefId));
    } else if (budget.scopeType === 'category' && budget.scopeRefId) {
      conditions.push(eq(schema.cardTransactions.categoryId, budget.scopeRefId));
    } else if (budget.scopeType === 'card' && budget.scopeRefId) {
      conditions.push(eq(schema.cardTransactions.cardId, budget.scopeRefId));
    } else if (budget.scopeType === 'card_group') {
      // 월별 계획에 저장한 카드 집합을 유지한다. 현재 카드 상태로 과거 범위를 바꾸지 않는다.
      const cardIds = budget.cardIds ?? [];
      conditions.push(cardIds.length > 0 ? inArray(schema.cardTransactions.cardId, cardIds) : sql`false`);
    }
    const [agg] = await this.db
      .select({
        spent: sql<string>`coalesce(sum(${schema.cardTransactions.netAmount}), 0)`,
      })
      .from(schema.cardTransactions)
      .where(and(...conditions));
    return Number(agg?.spent ?? 0) || 0;
  }
}
