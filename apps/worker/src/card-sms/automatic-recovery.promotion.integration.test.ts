/**
 * 자동 문자 복구의 실제 SQL·금액 명령 통합 검증.
 * SMS_AUTOMATION_TEST_DATABASE_URL이 지정된 격리 test/verify DB에서만 실행한다.
 * 임시 테이블을 기본으로 쓰고 동시성 검증만 고유 테스트 스키마를 만들고 삭제한다.
 * public 데이터는 읽거나 변경하지 않으며 모든 입력은 합성 자료다.
 */
import { deriveRecipe, parseCardSms, scopedTemplateFingerprint, templateFingerprint } from '@family/card-parsers';
import { createDbClient, schema, type Db, type DbExecutor } from '@family/database';
import { normalizeMerchant } from '@family/shared';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FxRateService } from '../promotion/fx-rate.service';
import { MoneyRuntimeService } from '../promotion/money-runtime.service';
import type { MoneyShadowService } from '../promotion/money-shadow.service';
import { MoneyWriteService } from '../promotion/money-write.service';
import { TransactionPromotionService } from '../promotion/transaction-promotion.service';
import { CardSmsParseProcessor } from '../processors/card-sms-parse.processor';
import type { RealtimePublisherService } from '../realtime/realtime-publisher.service';
import type { LlmSpanExtractorService } from './llm-span-extractor.service';
import type { TemplateRecipeService } from './template-recipe.service';
import { createParseQualityProbe, type ParseQualityProbe } from './parse-quality';
import { CardSmsReviewService } from '../../../api/src/card-sms/card-sms-review.service';
import { CardSmsQueryService } from '../../../api/src/card-sms/card-sms-query.service';
import { MoneyWriteService as ApiMoneyWriteService } from '../../../api/src/money/money-write.service';
import { MoneyRuntimeService as ApiMoneyRuntimeService } from '../../../api/src/money/money-runtime.service';
import type { MoneyShadowService as ApiMoneyShadowService } from '../../../api/src/money/money-shadow.service';

const databaseUrl = process.env['SMS_AUTOMATION_TEST_DATABASE_URL'];
const tables = [
  'users', 'households', 'household_members', 'source_items', 'card_sms_events',
  'card_sms_templates', 'payment_cards', 'card_transactions', 'merchant_aliases',
  'merchant_category_rules', 'expense_categories', 'pipeline_runs', 'pipeline_step_runs',
  'feedback_events', 'fx_rate_snapshots',
] as const;
const ids = {
  user: '10000000-0000-4000-8000-000000000001',
  spouseUser: '10000000-0000-4000-8000-000000000002',
  household: '20000000-0000-4000-8000-000000000001',
  member: '30000000-0000-4000-8000-000000000001',
  spouse: '30000000-0000-4000-8000-000000000002',
  device: '40000000-0000-4000-8000-000000000001',
  source: '50000000-0000-4000-8000-000000000001',
  candidateSource: '50000000-0000-4000-8000-000000000002',
  sourceEvent: '60000000-0000-4000-8000-000000000001',
  candidate: '60000000-0000-4000-8000-000000000002',
  card: '70000000-0000-4000-8000-000000000001',
  policy: '80000000-0000-4000-8000-000000000001',
} as const;
const version = new Date('2026-10-28T01:00:00.000Z');
const input = {
  sender: 'test-card',
  content: '[Web발신]\n현대카드(1234)승인\n김*수\n10/28 10:30\n12,000원 일시불\n테스트상점',
  receivedAt: new Date('2026-10-28T10:30:30+09:00'),
};
const parsed = parseCardSms(input);
const recipe = {
  ...deriveRecipe(input, parsed, templateFingerprint(input.sender, input.content)),
  approvedCardId: ids.card,
  householdId: ids.household,
  memberId: ids.member,
  automationEnabled: true,
};

interface ParseProcessorInternals {
  processTracked(job: Job<{ cardSmsEventId: string }>, pipelineRunId: string, quality: ParseQualityProbe): Promise<unknown>;
}

interface DuplicateCheckInternals {
  isDuplicateApproval(householdId: string, memberId: string, cardId: string | null,
    amount: number, currency: string, merchant: string | null, occurredAt: Date | null,
    executor?: DbExecutor): Promise<boolean>;
}

/** 실제 SQL 실행을 대체하지 않고 두 작업의 시작 순서만 맞춘다. */
function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Drizzle의 원인 체인에서 PostgreSQL 직렬화 거절 코드를 읽는다. */
function postgresCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? postgresCode(error.cause) : undefined;
}

/** 잘못 지정한 운영 DB에 연결하기 전에 로컬 검증용 이름을 검사한다. */
function assertIsolatedDatabase(url: string): void {
  const parsedUrl = new URL(url);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (process.env['NODE_ENV'] === 'production'
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
    || !/(?:^|[_-])(?:test|verify|verification)(?:[_-]|$)/u.test(databaseName)) {
    throw new Error('자동 복구 통합 테스트는 로컬 test/verify 전용 DB만 허용합니다.');
  }
}

describe.skipIf(!databaseUrl)('자동 문자 승격 PostgreSQL 통합', () => {
  let client: Sql | undefined;
  let db: Db;
  let service: TransactionPromotionService;
  let moneyWrite: MoneyWriteService;
  const runtime = { contractMode: 'v2', isPromotionPaused: false };
  const categoryAdd = vi.fn();
  const notificationAdd = vi.fn();

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('통합 테스트 DB 설정이 없습니다.');
    assertIsolatedDatabase(databaseUrl);
    ({ client, db } = createDbClient(databaseUrl, { max: 1 }));
    for (const table of tables) {
      await client.unsafe(`CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    }
    // 누락된 임시 테이블이 있으면 public으로 우회하지 않고 SQL 오류로 실패한다.
    await client.unsafe('SET search_path TO pg_temp, pg_catalog');
    const actualRuntime = runtime as unknown as MoneyRuntimeService;
    moneyWrite = new MoneyWriteService(db, actualRuntime);
    service = new TransactionPromotionService(
      db,
      { add: categoryAdd } as unknown as Queue,
      { add: notificationAdd } as unknown as Queue,
      {} as FxRateService,
      { observe: vi.fn(async () => undefined) } as unknown as MoneyShadowService,
      moneyWrite,
      new ConfigService({ app: { nodeEnv: 'test' } }),
      actualRuntime,
    );
  }, 20_000);

  afterAll(async () => { await client?.end(); });

  beforeEach(async () => {
    if (!client) throw new Error('통합 테스트 연결이 없습니다.');
    await client.unsafe(`TRUNCATE ${tables.map(table => `pg_temp."${table}"`).join(', ')}`);
    runtime.contractMode = 'v2';
    runtime.isPromotionPaused = false;
    categoryAdd.mockClear();
    notificationAdd.mockClear();
    await db.insert(schema.users).values([
      { id: ids.user, email: 'synthetic-self@example.invalid', passwordHash: 'synthetic-only', name: '합성 본인' },
      { id: ids.spouseUser, email: 'synthetic-spouse@example.invalid', passwordHash: 'synthetic-only', name: '합성 배우자' },
    ]);
    await db.insert(schema.households).values({ id: ids.household, name: '합성 가구', createdBy: ids.user });
    await db.insert(schema.householdMembers).values([
      { id: ids.member, householdId: ids.household, userId: ids.user, role: 'owner' },
      { id: ids.spouse, householdId: ids.household, userId: ids.spouseUser, role: 'member' },
    ]);
    await db.insert(schema.sourceItems).values([ids.source, ids.candidateSource].map(id => ({
      id, householdId: ids.household, memberId: ids.member, kind: 'card_sms' as const,
      objectKey: `synthetic/${id}`, contentHash: id, receivedAt: input.receivedAt,
    })));
    await db.insert(schema.cardSmsEvents).values([
      { id: ids.sourceEvent, sourceItemId: ids.source, parseStatus: 'parsed' as const },
      { id: ids.candidate, sourceItemId: ids.candidateSource, parseStatus: 'quarantined' as const },
    ].map(event => ({
      ...event, householdId: ids.household, memberId: ids.member, deviceId: ids.device,
      eventId: event.id, sender: input.sender, rawContent: input.content, contentHash: event.id,
      receivedAt: input.receivedAt, updatedAt: version, parseError: 'synthetic_review_required',
    })));
    await db.insert(schema.paymentCards).values({
      id: ids.card, householdId: ids.household, ownerMemberId: ids.member,
      issuer: '현대카드', alias: '합성 네이버 현대카드', maskedNumber: '1234',
      visibility: 'private', createdBy: ids.user,
    });
    await db.insert(schema.cardSmsTemplates).values({
      id: ids.policy, fingerprint: scopedTemplateFingerprint(ids.household, ids.member, input.sender, input.content),
      sender: input.sender, skeleton: 'synthetic-only', recipe,
      sourceEventId: ids.sourceEvent, confirmedBy: ids.user, updatedAt: version,
    });
  });

  /** 비교 대상은 임시 테이블 전체 행이며 원문·정책·금액·감사를 함께 비교한다. */
  async function snapshot() {
    return {
      events: await db.select().from(schema.cardSmsEvents).orderBy(schema.cardSmsEvents.id),
      policies: await db.select().from(schema.cardSmsTemplates).orderBy(schema.cardSmsTemplates.id),
      transactions: await db.select().from(schema.cardTransactions).orderBy(schema.cardTransactions.id),
      runs: await db.select().from(schema.pipelineRuns).orderBy(schema.pipelineRuns.id),
      steps: await db.select().from(schema.pipelineStepRuns).orderBy(schema.pipelineStepRuns.id),
      feedback: await db.select().from(schema.feedbackEvents).orderBy(schema.feedbackEvents.id),
    };
  }

  /** 차단이 조회와 실제 적용 모두에서 같은 사유이며 저장 상태가 불변인지 확인한다. */
  async function expectBlocked(reason: string, eventVersion = version, policyVersion = version): Promise<void> {
    const before = await snapshot();
    expect(await service.previewAutomatic(ids.candidate, eventVersion, policyVersion))
      .toEqual({ status: 'blocked', reason });
    expect(await service.promoteAutomatic(ids.candidate, eventVersion, policyVersion))
      .toEqual({ status: 'blocked', reason });
    expect(await snapshot()).toEqual(before);
  }

  /** 자동 복구 근거와 별개 이벤트인 일반 수신의 파싱 결과를 합성한다. */
  async function prepareNormalEvent(): Promise<void> {
    await db.update(schema.cardSmsEvents).set({
      parseStatus: 'parsed', transactionType: 'approval', issuer: '현대카드', amount: 12_000,
      currency: 'KRW', merchantRaw: '테스트상점', maskedCardNumber: '1234',
      occurredAt: parsed.occurredAt, installmentMonths: 1,
    }).where(eq(schema.cardSmsEvents.id, ids.sourceEvent));
  }

  /** 연결별 실제 서비스·금액 명령을 만들고 외부 알림·환율 호출만 제외한다. */
  function connectedService(targetDb: Db) {
    const actualRuntime = runtime as unknown as MoneyRuntimeService;
    const targetMoney = new MoneyWriteService(targetDb, actualRuntime);
    return { money: targetMoney, service: new TransactionPromotionService(
      targetDb, {} as Queue, {} as Queue, {} as FxRateService,
      { observe: vi.fn(async () => undefined) } as unknown as MoneyShadowService,
      targetMoney, new ConfigService({ app: { nodeEnv: 'production' } }), actualRuntime,
    ) };
  }

  /** 두 세션에서 같은 합성 행을 보게 하되 고유 검증 스키마 밖으로 접근하지 않는다. */
  async function withSharedDatabase(run: (normal: ReturnType<typeof connectedService>,
    automatic: ReturnType<typeof connectedService>, sharedDb: Db, normalPid: number,
    automaticPid: number) => Promise<void>): Promise<void> {
    if (!client || !databaseUrl) throw new Error('통합 테스트 연결이 없습니다.');
    const sharedSchema = `sms_verify_${randomUUID().replaceAll('-', '')}`;
    const connections: Sql[] = [];
    await client.unsafe(`CREATE SCHEMA "${sharedSchema}"`);
    try {
      for (const table of tables) {
        await client.unsafe(`CREATE TABLE "${sharedSchema}"."${table}" (LIKE pg_temp."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
        await client.unsafe(`INSERT INTO "${sharedSchema}"."${table}" SELECT * FROM pg_temp."${table}"`);
      }
      const normal = createDbClient(databaseUrl, { max: 1 });
      const automatic = createDbClient(databaseUrl, { max: 1 });
      connections.push(normal.client, automatic.client);
      for (const connection of connections) {
        await connection.unsafe(`SET search_path TO "${sharedSchema}", pg_catalog`);
        await connection.unsafe("SET statement_timeout TO '5s'");
      }
      const [normalSession] = await normal.client.unsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid');
      const [automaticSession] = await automatic.client.unsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid');
      if (!normalSession || !automaticSession) throw new Error('검증 연결 PID가 없습니다.');
      await run(connectedService(normal.db), connectedService(automatic.db), normal.db,
        normalSession.pid, automaticSession.pid);
    } finally {
      await Promise.all(connections.map(connection => connection.end({ timeout: 5 })));
      await client.unsafe(`DROP SCHEMA "${sharedSchema}" CASCADE`);
    }
  }

  /** 실제 PostgreSQL 카드 잠금 대기를 확인해 우연한 순차 실행을 동시성 성공으로 세지 않는다. */
  async function waitForCardLock(pid: number): Promise<void> {
    if (!client) throw new Error('통합 테스트 연결이 없습니다.');
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [activity] = await client.unsafe<{ wait: string | null; query: string }[]>(
        'SELECT wait_event_type AS wait, query FROM pg_catalog.pg_stat_activity WHERE pid = $1', [pid],
      );
      if (activity?.wait === 'Lock' && activity.query.includes('payment_cards')) return;
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    throw new Error('검증 세션의 카드 잠금 경합이 발생하지 않았습니다.');
  }

  it('미리보기는 적격 여부만 확인하고 원문·정책·금액·감사를 바꾸지 않는다', async () => {
    const before = await snapshot();
    expect(await service.previewAutomatic(ids.candidate, version, version)).toEqual({ status: 'eligible' });
    expect(await snapshot()).toEqual(before);
    expect(categoryAdd).not.toHaveBeenCalled();
    expect(notificationAdd).not.toHaveBeenCalled();
  });

  it('실제 금액 명령으로 본인 거래와 파싱 결과를 저장하고 자동 주체 감사만 남긴다', async () => {
    const before = await snapshot();
    const result = await service.promoteAutomatic(ids.candidate, version, version);
    expect(result.status).toBe('applied');
    const after = await snapshot();
    expect(after.transactions).toHaveLength(1);
    expect(after.transactions[0]).toMatchObject({
      sourceEventId: ids.candidate, memberId: ids.member, cardId: ids.card,
      amount: 12_000, netAmount: 12_000, cancelledAmount: 0, currency: 'KRW',
      moneyContractVersion: 2, transactionType: 'approval', status: 'approved',
      visibility: 'private', merchantRaw: '테스트상점', approvedAt: parsed.occurredAt,
    });
    expect(after.events.find(event => event.id === ids.candidate)).toMatchObject({
      parseStatus: 'parsed', parseError: null, amount: 12_000, rawContent: input.content,
    });
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0]).toMatchObject({ pipelineName: 'card-sms-automatic-recovery', scopeId: ids.candidate, status: 'succeeded' });
    expect(after.steps).toHaveLength(1);
    expect(after.steps[0]).toMatchObject({ metrics: { actor: 'automatic', policyId: ids.policy }, outputCount: 1 });
    expect(after.feedback).toEqual(before.feedback);
    expect(after.policies).toEqual(before.policies);
    expect(categoryAdd).not.toHaveBeenCalled();
    expect(notificationAdd).not.toHaveBeenCalled();
  });

  it('사람 검토 API의 정책 생성·목록·워커 자동 적용·중지 API를 실제 SQL로 연결한다', async () => {
    await db.delete(schema.cardSmsTemplates);
    await db.update(schema.cardSmsEvents).set({
      parseStatus: 'quarantined', rawContent: input.content.replace('10:30', '10:00'),
      receivedAt: new Date('2026-10-28T10:00:30+09:00'),
    }).where(eq(schema.cardSmsEvents.id, ids.sourceEvent));
    // 런타임 모드 getter도 실제 구현을 쓰되 Redis 연결·주기 작업은 시작하지 않는다.
    const redis = new Redis({ lazyConnect: true });
    const config = new ConfigService({ app: { nodeEnv: 'production' },
      money: { contractMode: 'v2' }, queue: { prefix: 'sms-verification-only' } });
    const apiRuntime = new ApiMoneyRuntimeService(redis, config);
    const workerRuntime = new MoneyRuntimeService(redis, config);
    const shadow = { observe: vi.fn() };
    const review = new CardSmsReviewService(db, shadow as unknown as ApiMoneyShadowService,
      new ApiMoneyWriteService(db, apiRuntime));
    const query = new CardSmsQueryService(db);
    const automatic = new TransactionPromotionService(db, {} as Queue, {} as Queue,
      {} as FxRateService, shadow as unknown as MoneyShadowService,
      new MoneyWriteService(db, workerRuntime), config, workerRuntime);
    try {
      const reviewed = await review.review(ids.user, ids.sourceEvent, {
        transactionType: 'approval', amount: 12_000, currency: 'KRW', issuer: '현대카드',
        merchantRaw: '테스트상점', occurredAt: '2026-10-28T01:00:00.000Z',
        installmentMonths: 1, cardId: ids.card, reuseForSimilar: true,
      });
      expect(reviewed).toMatchObject({ cardSmsEventId: ids.sourceEvent, parseStatus: 'parsed' });
      expect(reviewed.transactionId).toBeTruthy();
      const groups = await query.reviewGroups(ids.user, ids.household);
      expect(groups.scannedCount).toBe(1);
      expect(groups.items).toHaveLength(1);
      expect(groups.policies).toHaveLength(1);
      const policy = groups.policies[0];
      if (!policy) throw new Error('사람 검토 API가 정책을 생성하지 않았습니다.');
      expect(policy).toMatchObject({ enabled: true, approvedCardId: ids.card });
      const policyVersion = new Date(policy.updatedAt);
      expect(await automatic.previewAutomatic(ids.candidate, version, policyVersion)).toEqual({ status: 'eligible' });
      expect((await automatic.promoteAutomatic(ids.candidate, version, policyVersion)).status).toBe('applied');
      const applied = await snapshot();
      expect(applied.transactions).toHaveLength(2);
      expect(applied.transactions.every(transaction => transaction.moneyContractVersion === 2)).toBe(true);
      expect(applied.feedback).toHaveLength(1);
      expect(applied.feedback[0]).toMatchObject({ source: 'human_confirmed', targetId: ids.sourceEvent });
      expect((await query.reviewGroups(ids.user, ids.household)).scannedCount).toBe(0);

      const disabled = await query.disableReviewPolicy(ids.user, ids.household, policy.id);
      expect(disabled).toMatchObject({ id: policy.id, enabled: false });
      const nextSourceId = '50000000-0000-4000-8000-000000000003';
      const nextEventId = '60000000-0000-4000-8000-000000000003';
      await db.insert(schema.sourceItems).values({
        id: nextSourceId, householdId: ids.household, memberId: ids.member, kind: 'card_sms',
        objectKey: 'synthetic/after-policy-disable', contentHash: nextSourceId,
        receivedAt: new Date('2026-10-28T11:30:30+09:00'),
      });
      await db.insert(schema.cardSmsEvents).values({
        id: nextEventId, householdId: ids.household, memberId: ids.member, deviceId: ids.device,
        sourceItemId: nextSourceId, eventId: nextEventId, sender: input.sender,
        rawContent: input.content.replace('10:30', '11:30'), contentHash: nextEventId,
        receivedAt: new Date('2026-10-28T11:30:30+09:00'), parseStatus: 'quarantined', updatedAt: version,
      });
      const beforeBlocked = await snapshot();
      expect(await automatic.promoteAutomatic(nextEventId, version, new Date(disabled.updatedAt)))
        .toEqual({ status: 'blocked', reason: 'policy_not_approved' });
      expect(await snapshot()).toEqual(beforeBlocked);
      const after = await query.reviewGroups(ids.user, ids.household);
      expect(after.scannedCount).toBe(1);
      expect(after.policies[0]).toMatchObject({ id: policy.id, enabled: false });
      expect(beforeBlocked.feedback).toHaveLength(2);
      expect(beforeBlocked.feedback.find(feedback => feedback.targetId === policy.id))
        .toMatchObject({ source: 'human_confirmed', label: { action: 'disable', policyId: policy.id } });
    } finally {
      redis.disconnect();
    }
  });

  it('이미 성공한 이벤트를 다시 실행해도 거래·감사가 늘어나지 않는다', async () => {
    expect((await service.promoteAutomatic(ids.candidate, version, version)).status).toBe('applied');
    await expectBlocked('event_not_eligible');
  });

  it('거래가 이미 있으면 이벤트 상태가 다시 검토로 돌아가도 재생성하지 않는다', async () => {
    expect((await service.promoteAutomatic(ids.candidate, version, version)).status).toBe('applied');
    await db.update(schema.cardSmsEvents).set({ parseStatus: 'quarantined', updatedAt: version })
      .where(eq(schema.cardSmsEvents.id, ids.candidate));
    await expectBlocked('already_promoted');
  });

  it('정책을 중지하면 이후 같은 양식도 적용하지 않는다', async () => {
    await db.update(schema.cardSmsTemplates).set({ recipe: { ...recipe, automationEnabled: false } })
      .where(eq(schema.cardSmsTemplates.id, ids.policy));
    await expectBlocked('policy_not_approved');
  });

  it('전체 승격 중지와 구 금액 계약을 모두 차단한다', async () => {
    runtime.isPromotionPaused = true;
    await expectBlocked('promotion_paused');
    runtime.isPromotionPaused = false;
    runtime.contractMode = 'v1';
    await expectBlocked('money_contract_not_enforced');
  });

  it('같은 카드사·번호여도 배우자의 개인 카드에는 본인 거래를 귀속하지 않는다', async () => {
    await db.update(schema.paymentCards).set({ ownerMemberId: ids.spouse, isShared: false })
      .where(eq(schema.paymentCards.id, ids.card));
    await expectBlocked('card_not_unique_owner');
  });

  it('명시적으로 승인한 공용 카드는 원문 구성원과 함께 연결한다', async () => {
    await db.update(schema.paymentCards).set({ ownerMemberId: ids.spouse, isShared: true })
      .where(eq(schema.paymentCards.id, ids.card));
    expect(await service.previewAutomatic(ids.candidate, version, version)).toEqual({ status: 'eligible' });
    expect((await service.promoteAutomatic(ids.candidate, version, version)).status).toBe('applied');
    const [transaction] = await db.select().from(schema.cardTransactions);
    expect(transaction).toMatchObject({ memberId: ids.member, cardId: ids.card, amount: 12_000 });
  });

  it('식별 가능한 본인 카드가 둘이면 승인 카드가 있어도 자동 연결하지 않는다', async () => {
    await db.insert(schema.paymentCards).values({
      id: '70000000-0000-4000-8000-000000000002', householdId: ids.household,
      ownerMemberId: ids.member, issuer: '현대카드', alias: '합성 중복 카드',
      maskedNumber: '1234', createdBy: ids.user,
    });
    await expectBlocked('card_not_unique_owner');
  });

  it('스캔 이후 원문 이벤트가 바뀌면 오래된 버전으로 적용하지 않는다', async () => {
    await db.update(schema.cardSmsEvents).set({ updatedAt: new Date(version.getTime() + 1) })
      .where(eq(schema.cardSmsEvents.id, ids.candidate));
    await expectBlocked('event_changed');
  });

  it('스캔 이후 승인 정책이 바뀌면 오래된 버전으로 적용하지 않는다', async () => {
    await db.update(schema.cardSmsTemplates).set({ updatedAt: new Date(version.getTime() + 1) })
      .where(eq(schema.cardSmsTemplates.id, ids.policy));
    await expectBlocked('policy_changed');
  });

  it('다른 구성원의 레시피가 같은 지문 행에 있어도 적용하지 않는다', async () => {
    await db.update(schema.cardSmsTemplates).set({ recipe: { ...recipe, memberId: ids.spouse } })
      .where(eq(schema.cardSmsTemplates.id, ids.policy));
    await expectBlocked('policy_scope_mismatch');
  });

  it('탈퇴 구성원의 승인 정책은 적용하지 않는다', async () => {
    await db.update(schema.householdMembers).set({ status: 'removed' })
      .where(eq(schema.householdMembers.id, ids.member));
    await expectBlocked('member_not_active');
  });

  it('삭제된 원본 또는 정책 근거에는 재사용하지 않는다', async () => {
    await db.update(schema.sourceItems).set({ deletedAt: version }).where(eq(schema.sourceItems.id, ids.source));
    await expectBlocked('source_deleted');
  });

  it('정책이 있더라도 링크가 섞인 문자는 다시 검사해 자동 적용을 거절한다', async () => {
    const suspiciousContent = `${input.content}\nhttps://example.invalid`;
    // 악성 본문에 맞는 정책이 저장돼 있어도 최종 액션 검증을 우회할 수 없어야 한다.
    await db.update(schema.cardSmsEvents).set({ rawContent: suspiciousContent });
    await db.update(schema.cardSmsTemplates).set({
      fingerprint: scopedTemplateFingerprint(ids.household, ids.member, input.sender, suspiciousContent),
      recipe: { ...recipe, fingerprint: templateFingerprint(input.sender, suspiciousContent) },
    }).where(eq(schema.cardSmsTemplates.id, ids.policy));
    await expectBlocked('suspicious_content');
  });

  it('같은 카드·금액·가맹점·시간의 기존 승인은 이중 반영하지 않는다', async () => {
    const existing = await moneyWrite.commands.createApproval({
      metadata: {
        householdId: ids.household, memberId: ids.member, cardId: ids.card, sourceEventId: ids.sourceEvent,
        merchantRaw: '테스트상점', merchantNormalized: normalizeMerchant('테스트상점'),
        categoryId: null, authorizationCode: null, installmentMonths: 1, visibility: 'private', memo: null,
      },
      minorUnits: 12_000, currency: 'KRW', occurredAt: new Date('2026-10-28T10:29:00+09:00'),
      receivedAt: input.receivedAt, reviewFlag: null,
    });
    expect(existing.ok).toBe(true);
    await expectBlocked('duplicate_suspected');
  });

  it('일반 승격의 사전 조회 이후 자동 복구가 완료되면 잠금 안에서 중복을 다시 판정한다', async () => {
    await prepareNormalEvent();
    const checked = signal();
    const proceed = signal();
    const normal = connectedService(db).service;
    const internals = normal as unknown as DuplicateCheckInternals;
    const originalCheck = internals.isDuplicateApproval.bind(internals);
    const checking = vi.spyOn(internals, 'isDuplicateApproval').mockImplementation(async (...args) => {
      const duplicate = await originalCheck(...args);
      if (args[7] === undefined) {
        expect(duplicate).toBe(false);
        checked.resolve();
        await proceed.promise;
      }
      return duplicate;
    });
    const pending = normal.promote(ids.sourceEvent, { repair: true });
    const completed = Promise.allSettled([pending]);
    try {
      await Promise.race([checked.promise, completed.then(() => { throw new Error('일반 승격이 사전 조회 대기에 도달하지 않았습니다.'); })]);
      expect((await service.promoteAutomatic(ids.candidate, version, version)).status).toBe('applied');
      proceed.resolve();
      await pending;
      const transactions = await db.select().from(schema.cardTransactions);
      expect(transactions).toHaveLength(2);
      expect(transactions.find(transaction => transaction.sourceEventId === ids.candidate)?.status).toBe('approved');
      expect(transactions.find(transaction => transaction.sourceEventId === ids.sourceEvent)?.status).toBe('duplicate_suspected');
      expect(checking.mock.calls.some(call => call[7] !== undefined)).toBe(true);
    } finally {
      proceed.resolve();
      await completed;
      checking.mockRestore();
    }
  });

  it.each(['automatic', 'normal'] as const)('%s가 카드 잠금을 먼저 잡아도 두 경로의 동시 승인은 한 건을 넘지 않는다', async firstRole => {
    await prepareNormalEvent();
    await withSharedDatabase(async (normal, automatic, sharedDb, normalPid, automaticPid) => {
      const entered = signal();
      const proceed = signal();
      const firstMoney = firstRole === 'automatic' ? automatic.money : normal.money;
      const originalCreate = firstMoney.commands.createApproval.bind(firstMoney.commands);
      const creating = vi.spyOn(firstMoney.commands, 'createApproval').mockImplementation(async (...args) => {
        // 이 시점에는 실제 트랜잭션에서 카드 잠금과 중복 조회가 끝난 상태다.
        entered.resolve();
        await proceed.promise;
        return originalCreate(...args);
      });
      const runNormal = () => normal.service.promote(ids.sourceEvent, { repair: true });
      const runAutomatic = () => automatic.service.promoteAutomatic(ids.candidate, version, version);
      const first = firstRole === 'automatic' ? runAutomatic() : runNormal();
      const firstResult = Promise.allSettled([first]);
      let secondResult: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await Promise.race([entered.promise, firstResult.then(() => { throw new Error('첫 승격이 카드 잠금 대기에 도달하지 않았습니다.'); })]);
        secondResult = Promise.allSettled([firstRole === 'automatic' ? runNormal() : runAutomatic()]);
        await waitForCardLock(firstRole === 'automatic' ? normalPid : automaticPid);
        proceed.resolve();
        const [firstOutcomes, secondOutcomes] = await Promise.all([firstResult, secondResult]);
        expect(firstOutcomes[0]?.status).toBe('fulfilled');
        const secondOutcome = secondOutcomes[0];
        if (secondOutcome?.status === 'rejected') {
          expect(postgresCode(secondOutcome.reason)).toBe('40001');
        } else if (firstRole === 'normal') {
          expect(secondOutcome?.status === 'fulfilled' ? secondOutcome.value : undefined)
            .toEqual({ status: 'blocked', reason: 'duplicate_suspected' });
        }
        const committed = await sharedDb.select().from(schema.cardTransactions);
        expect(committed.filter(transaction => transaction.status === 'approved')).toHaveLength(1);
        expect(committed.every(transaction => ['approved', 'duplicate_suspected'].includes(transaction.status))).toBe(true);

        // 직렬화 거절은 정상 재시도한 뒤에도 두 번째 승인을 만들 수 없어야 한다.
        creating.mockRestore();
        await runNormal();
        const retry = await runAutomatic();
        expect(retry.status).toBe('blocked');
        const final = await sharedDb.select().from(schema.cardTransactions);
        expect(final.filter(transaction => transaction.status === 'approved')).toHaveLength(1);
        expect(final.every(transaction => ['approved', 'duplicate_suspected'].includes(transaction.status))).toBe(true);
      } finally {
        proceed.resolve();
        await Promise.all([firstResult, ...(secondResult ? [secondResult] : [])]);
        creating.mockRestore();
      }
    });
  }, 15_000);

  it('감사 SQL이 실제로 실패하면 거래·파싱 상태·상위 감사까지 모두 롤백한다', async () => {
    if (!client) throw new Error('통합 테스트 연결이 없습니다.');
    const before = await snapshot();
    await client.unsafe('ALTER TABLE pg_temp.pipeline_step_runs ADD CONSTRAINT synthetic_audit_failure CHECK (false)');
    try {
      await expect(service.promoteAutomatic(ids.candidate, version, version)).rejects.toMatchObject({
        cause: { code: '23514', constraint_name: 'synthetic_audit_failure' },
      });
      expect(await snapshot()).toEqual(before);
    } finally {
      await client.unsafe('ALTER TABLE pg_temp.pipeline_step_runs DROP CONSTRAINT synthetic_audit_failure');
    }
    // 실패를 해제한 재시도는 한 번만 적용되며 중간 쓰기가 남지 않는다.
    expect((await service.promoteAutomatic(ids.candidate, version, version)).status).toBe('applied');
    expect((await snapshot()).transactions).toHaveLength(1);
  });

  it('일반 파싱의 버전 비교는 PostgreSQL 마이크로초를 잃지 않고 정상 갱신한다', async () => {
    if (!client) throw new Error('통합 테스트 연결이 없습니다.');
    await client.unsafe(
      "UPDATE pg_temp.card_sms_events SET parse_status = 'pending', updated_at = '2026-10-28T01:00:00.000123Z'::timestamptz WHERE id = $1",
      [ids.candidate],
    );
    const [stored] = await client.unsafe<{ version: string }[]>(
      'SELECT updated_at::text AS version FROM pg_temp.card_sms_events WHERE id = $1', [ids.candidate],
    );
    expect(stored?.version).toContain('.000123');
    const promote = vi.fn(async () => undefined);
    const extractRecipe = vi.fn(async () => null);
    const extractLlm = vi.fn(async () => null);
    const processor = new CardSmsParseProcessor(
      db, { promote } as unknown as TransactionPromotionService,
      { publish: vi.fn(async () => undefined) } as unknown as RealtimePublisherService,
      { enabled: true, extract: extractLlm } as unknown as LlmSpanExtractorService,
      { extract: extractRecipe } as unknown as TemplateRecipeService,
      { register: vi.fn() } as unknown as MoneyRuntimeService,
      new ConfigService({ app: { nodeEnv: 'production' }, ai: { cardSmsActionGate: 'off' } }),
    );
    const outcome = await (processor as unknown as ParseProcessorInternals).processTracked(
      { id: 'synthetic', data: { cardSmsEventId: ids.candidate } } as Job<{ cardSmsEventId: string }>,
      'synthetic-pipeline', createParseQualityProbe(),
    );
    expect(outcome).toEqual({ cardSmsEventId: ids.candidate, parseStatus: 'parsed' });
    expect(promote).toHaveBeenCalledWith(ids.candidate, { repair: false });
    expect(extractRecipe).not.toHaveBeenCalled();
    expect(extractLlm).not.toHaveBeenCalled();
    const [updated] = await db.select().from(schema.cardSmsEvents).where(eq(schema.cardSmsEvents.id, ids.candidate));
    expect(updated).toMatchObject({ parseStatus: 'parsed', amount: 12_000 });
  });
});
