import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hasSuspiciousSmsContent, parseCardSms } from '@family/card-parsers';
import type { AppConfig } from '@family/config';
import {
  schema,
  trackPipelineExecution,
  type Db,
} from '@family/database';
import { createLogger, QUEUE_NAMES } from '@family/shared';
import type { Job } from 'bullmq';
import { and, eq, getTableColumns, notExists, sql } from 'drizzle-orm';

import { LlmSpanExtractorService } from '../card-sms/llm-span-extractor.service';
import {
  isCardSmsParseResolved,
  resolveCardSmsParseDisposition,
  type CardSmsParseStatus,
} from '../card-sms/parse-disposition';
import {
  createParseQualityProbe,
  parseQualityMetrics,
  type ParseQualityProbe,
} from '../card-sms/parse-quality';
import { TemplateRecipeService } from '../card-sms/template-recipe.service';
import { DB } from '../database/database.module';
import { MoneyRuntimeService } from '../promotion/money-runtime.service';
import { TransactionPromotionService } from '../promotion/transaction-promotion.service';
import { RealtimePublisherService } from '../realtime/realtime-publisher.service';
import { assertCardSmsRepairGuard, type CardSmsRepairGuard } from '../card-sms/repair-guard';

/** card-sms-parse 잡 payload(스펙 §5.2: { cardSmsEventId }). */
interface CardSmsParseJobData {
  cardSmsEventId: string;
  /** 운영자가 검토한 과거 실패 건에 한해 L0·무과금·무알림으로 재처리한다. */
  repair?: CardSmsRepairGuard;
}

/** 잡 결과. 정상 파싱은 parseStatus, 레코드 미존재는 skipped 로 구분한다. */
type CardSmsParseJobResult =
  | { cardSmsEventId: string; parseStatus: CardSmsParseStatus }
  | { cardSmsEventId: string; skipped: true };

@Processor(QUEUE_NAMES.CARD_SMS_PARSE)
export class CardSmsParseProcessor extends WorkerHost {
  private readonly logger: ReturnType<typeof createLogger>;
  /** ADR-0027 6단계 게이트. 끄는 것은 사고 대응 수단이다(기본 on). */
  private readonly actionGate: boolean;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly promotionService: TransactionPromotionService,
    private readonly realtimePublisher: RealtimePublisherService,
    private readonly llmSpanExtractor: LlmSpanExtractorService,
    private readonly templateRecipe: TemplateRecipeService,
    private readonly moneyRuntime: MoneyRuntimeService,
    configService: ConfigService,
  ) {
    super();
    const nodeEnv = configService.get<AppConfig['app']>('app')?.nodeEnv;
    this.logger = createLogger('worker:card-sms-parse-processor', {
      pretty: nodeEnv !== 'production',
    });
    this.actionGate = configService.get<AppConfig['ai']>('ai')?.cardSmsActionGate !== 'off';
    // ADR-0027 5단계: 승격 소비 일시정지 대상으로 자기 자신을 등록한다.
    // `WorkerHost.worker`는 이 프로세스의 BullMQ Worker다 — `pause()`는 새 잡을
    // 가져오지 않을 뿐 큐에서 지우지 않으므로 pause 중 들어온 잡은 그대로 쌓인다.
    // getter로 감싸는 이유: `worker`는 Nest가 나중에 주입하므로 생성자 시점에 잡으면 안 된다.
    this.moneyRuntime.register({
      name: QUEUE_NAMES.CARD_SMS_PARSE,
      pause: () => this.worker.pause(),
      resume: () => this.worker.resume(),
    });
  }

  async process(job: Job<CardSmsParseJobData>): Promise<CardSmsParseJobResult> {
    // 캐스케이드가 어느 레이어에서 끝났는지를 잡 결과가 아니라 probe로 모은다 —
    // 잡 결과 타입(`CardSmsParseJobResult`)은 BullMQ 계약이라 관측용 필드로
    // 오염시키지 않는다. ADR-0023 §관측 지표의 원자료다.
    const quality = createParseQualityProbe();

    return trackPipelineExecution(
      this.db,
      {
        pipelineName: 'card-sms-parse',
        pipelineVersion: 'card-sms-parse-v2',
        stepName: 'parse-and-promote',
        stepVersion: 'card-parser-v1',
        trigger: 'bullmq',
        scopeType: 'card-sms-event',
        scopeId: job.data.cardSmsEventId || 'missing',
        externalRunId: String(job.id ?? 'unknown'),
        attempt: job.attemptsMade + 1,
        maximumAttempts: job.opts?.attempts ?? 1,
        summarize: (result) =>
          'skipped' in result
            ? {
                inputCount: 0,
                outputCount: 0,
                rejectedCount: 0,
                metrics: { skipped: true },
              }
            : {
                inputCount: 1,
                outputCount: result.parseStatus === 'parse_failed' ? 0 : 1,
                rejectedCount: result.parseStatus === 'parse_failed' ? 1 : 0,
                metrics: parseQualityMetrics(quality, result.parseStatus),
              },
      },
      ({ pipelineRunId }) => this.processTracked(job, pipelineRunId, quality),
    );
  }

  /** 실제 카드 문자 파싱/승격. 바깥 wrapper가 실행 상태와 AI trace 상관키를 관리한다. */
  private async processTracked(
    job: Job<CardSmsParseJobData>,
    pipelineRunId: string,
    quality: ParseQualityProbe,
  ): Promise<CardSmsParseJobResult> {
    const { cardSmsEventId } = job.data;

    if (!cardSmsEventId) {
      // 방어: payload 결손은 재시도해도 무의미하므로 즉시 실패시킨다(민감정보 없음).
      this.logger.warn(
        { jobId: job.id, queue: job.queueName },
        'card-sms parse job missing cardSmsEventId',
      );
      throw new Error('card-sms parse job payload is missing cardSmsEventId');
    }

    const [event] = await this.db
      .select({ ...getTableColumns(schema.cardSmsEvents),
        updatedAtVersion: sql<string>`${schema.cardSmsEvents.updatedAt}::text`,
      })
      .from(schema.cardSmsEvents)
      .where(eq(schema.cardSmsEvents.id, cardSmsEventId))
      .limit(1);

    if (!event) {
      // 레코드 미존재(삭제/경합) — 재파싱 대상 없음. 로그 후 정상 종료.
      this.logger.warn(
        { jobId: job.id, cardSmsEventId, queue: job.queueName },
        'card-sms event not found; skipping parse',
      );
      return { cardSmsEventId, skipped: true };
    }

    const repair = job.data.repair;
    const [existingTransaction] = await this.db.select({ id: schema.cardTransactions.id })
      .from(schema.cardTransactions).where(eq(schema.cardTransactions.sourceEventId, cardSmsEventId)).limit(1);
    if (existingTransaction) {
      if (repair !== undefined) throw new Error('repair_already_promoted');
      // 큐 재전송이 이미 확정된 문자·거래의 결과를 다시 덮어쓰지 않는다.
      return { cardSmsEventId, skipped: true };
    }
    if (repair !== undefined) {
      assertCardSmsRepairGuard(event, repair);
    } else if (event.parseStatus === 'parsed' || event.parseStatus === 'pending_review') {
      // 확정 후 재전송은 원문을 다시 해석하지 않는다. 거래 생성만 실패했다면 저장 결과로 재시도한다.
      if (event.transactionType === 'approval' || event.transactionType === 'cancellation') {
        await this.promotionService.promote(cardSmsEventId);
      }
      return { cardSmsEventId, parseStatus: event.parseStatus };
    } else if (event.parseStatus === 'ignored') {
      return { cardSmsEventId, skipped: true };
    }

    const input = {
      sender: event.sender,
      content: event.rawContent,
      receivedAt: event.receivedAt,
    };
    const suspiciousInput = hasSuspiciousSmsContent(input.content);

    // L0 — 결정적 규칙 파서 + 액션 결박 금액 게이트(ADR-0027 6단계).
    // 게이트가 금액을 확정하지 못하면 amount를 비우고 내려보내므로, 아래 `parseable`이
    // 자연히 false가 되어 L1(레시피)→L2(LLM) 경로가 이어받는다.
    let result = parseCardSms(input, { actionGate: repair === undefined ? this.actionGate : true });
    // 금액 없는 거절·비카드 안내는 이미 판정됐으므로 레시피나 유료 LLM으로 보내지 않는다.
    const parseable = isCardSmsParseResolved;

    // L1 — 사람이 한 번 확정해 레시피가 생긴 레이아웃이면 LLM 없이 결정적으로 추출한다.
    // 지문 exact match라 "비슷한 템플릿"으로 잘못 보내는 오탐이 없다(ADR-0023 S4).
    let parseSource: 'rule' | 'recipe' | 'llm-span' = 'rule';
    if (repair === undefined && !suspiciousInput && !parseable(result)) {
      quality.recipeAttempted = true;
      const fromRecipe = await this.templateRecipe.extract(input, event.householdId, event.memberId);
      if (fromRecipe && parseable(fromRecipe.result)) {
        result = fromRecipe.result;
        parseSource = 'recipe';
        quality.recipeHit = true;
      }
    }

    // L2 — L0·L1이 모두 못 읽은 건만 LLM span 추출로 넘긴다(ADR-0023). LLM은 값을
    // 만들지 않고 원문 인용만 하며, 실패는 null 이라 기존 parse_failed 흐름이 유지된다.
    let fromLlm = false;
    if (repair === undefined && !suspiciousInput && !parseable(result) && this.llmSpanExtractor.enabled) {
      quality.llmAttempted = true;
      const extraction = await this.llmSpanExtractor.extract(
        input,
        event.householdId,
        pipelineRunId,
      );
      // 거절 판정은 **결과 적용 여부와 무관**하다 — shadow 모드에서도 "유효 span을
      // 못 냈다"는 사실은 그대로 세야 문구 개편 신호(llm_span_reject_rate)가 잡힌다.
      quality.llmSpanRejected = !extraction || !parseable(extraction.result);
      quality.llmRejectedSpans = extraction?.rejected.length ?? 0;
      // shadow 모드는 관찰만 한다 — 파싱 상태를 바꾸지 않는다.
      if (extraction && this.llmSpanExtractor.appliesResult && parseable(extraction.result)) {
        result = extraction.result;
        fromLlm = true;
        parseSource = 'llm-span';
      }
    }
    quality.parseSource = parseSource;

    // 금액은 minor units 정수만 허용(부동소수 금지, PRD §10). 파서 결함을 차단한다.
    const amount = result.amount ?? null;
    const currency = result.currency ?? null;
    if (amount !== null && !Number.isInteger(amount)) {
      throw new Error(
        `parsed amount must be a minor-units integer (cardSmsEventId=${cardSmsEventId})`,
      );
    }

    // 같은 판정으로 안내·거절·금액 오류·LLM 격리와 승격 가능 여부를 함께 결정한다.
    const disposition = resolveCardSmsParseDisposition(
      result,
      event.receivedAt,
      fromLlm,
    );
    // 재사용 정책도 카드·중복까지 확인하는 원자적 자동 복구 경로에서만 반영한다.
    // 의심 문구는 일반 파서가 성공했더라도 거래로 승격하지 않는다.
    const { parseStatus, parseError, promotable } = suspiciousInput || parseSource === 'recipe'
      ? { parseStatus: 'quarantined' as const, parseError: suspiciousInput ? 'suspicious_content' : 'approved_policy_validation_pending', promotable: false }
      : disposition;

    const now = new Date();

    const [updated] = await this.db
      .update(schema.cardSmsEvents)
      .set({
        issuer: result.issuer ?? null,
        transactionType: result.transactionType,
        amount,
        currency,
        merchantRaw: result.merchantRaw ?? null,
        occurredAt: result.occurredAt ?? null,
        maskedCardNumber: result.maskedCardNumber ?? null,
        installmentMonths: result.installmentMonths ?? null,
        // 거절 사유(거절 문자에만 존재). 재파싱 시 승인으로 바뀌면 null로 되돌려야 하므로
        // `?? null`로 명시 초기화한다 — 옛 사유가 남으면 실패 목록에 유령 항목이 생긴다.
        declineReason: result.declineReason ?? null,
        confidence: result.confidence,
        parseStatus,
        parseError,
        parsedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(schema.cardSmsEvents.id, cardSmsEventId),
        eq(schema.cardSmsEvents.parseStatus, event.parseStatus),
        // JS Date의 밀리초 절삭 때문에 신규 DB now()가 충돌로 오인되지 않게 원래 정밀도를 유지한다.
        sql`${schema.cardSmsEvents.updatedAt} = ${event.updatedAtVersion}::timestamptz`,
        notExists(this.db.select({ id: schema.cardTransactions.id }).from(schema.cardTransactions)
          .where(eq(schema.cardTransactions.sourceEventId, cardSmsEventId))),
      ))
      .returning({ id: schema.cardSmsEvents.id });
    if (!updated) {
      if (repair !== undefined) throw new Error('repair_snapshot_changed_before_write');
      return { cardSmsEventId, skipped: true };
    }

    // 로그는 식별자/상태/발급사/신뢰도만(원문·금액·가맹점 등 PII 미기록, 스펙 §1.1/§6).
    this.logger.info(
      {
        jobId: job.id,
        cardSmsEventId,
        eventId: event.eventId,
        issuer: result.issuer ?? null,
        parseStatus,
        confidence: result.confidence,
        parseSource,
      },
      'card-sms event parsed',
    );

    // 파싱 성공(또는 사람 검토 필요) 건은 같은 잡 안에서 거래로 승격한다(스펙 §1.1/§6).
    // parse_failed는 승격 대상이 아니다. 승격 실패는 잡을 재시도하게 두되, 멱등
    // (sourceEventId UNIQUE)이라 재승격이 안전하다.
    // declined(승인거절/거부/실패)는 실제 체결이 아니므로 sms 기록만 남기고 거래로
    // 승격하지 않는다 — 승격하면 소비 집계·목록에 유령 거래가 잡힌다.
    // quarantined(LLM 추론)도 여기서 자연히 제외된다 — 사람이 확인해 상태를 올리기
    // 전까지 거래를 만들지 않는다(ADR-0023 §6).
    if (promotable) {
      await this.promotionService.promote(cardSmsEventId, { repair: repair !== undefined });
    }

    // 실시간 무효화 힌트(best-effort, fire-and-forget) — parse_failed도 대시보드
    // 패널 대상이라 상태 불문 발행한다. publish는 내부에서 실패를 흡수하므로
    // await 하지 않는다(Redis 부분 장애가 잡 처리량을 깎지 않게).
    void this.realtimePublisher.publish(event.householdId);

    return { cardSmsEventId, parseStatus };
  }
}
