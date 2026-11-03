/**
 * Budget domain service (Phase 5 Build Spec §5.2, §1.4).
 *
 * Authorization is enforced *here* in the service layer against `userId`
 * (PRD §7.2/§26) — controllers never make trust decisions. Every path resolves
 * the caller's active household membership first (`requireMembership`), so a
 * non-member always receives a 403 and never learns whether the household or a
 * budget exists. Budget CRUD (create/update/delete) additionally requires an
 * `owner`/`admin` role; listing is open to any active member.
 *
 * Usage rate (spec §1.4): a budget's `spent` is the **selected-month** net spend
 * of its scope — `sum(netAmount) WHERE transactionType='approval'` over the
 * `[monthStart, nextMonthStart)` window (Asia/Seoul, on `approvedAt`) — computed
 * entirely in SQL (never summed in JS). The visibility scope (spec §1.2) is
 * applied: the actor's own rows ∪ `household` ∪ `summary_only`; another member's
 * `private` rows are excluded. `usageRate = spent / amount`,
 * `remaining = amount - spent`.
 *
 * Amounts are KRW integers. Logs never carry amounts or PII.
 */
import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type {
  BudgetCreateRequest,
  BudgetCopyRequest,
  BudgetCopyResponse,
  BudgetListResponse,
  BudgetSummary,
  BudgetUpdateRequest,
  HouseholdRole,
} from '@family/contracts';
import {
  isUniqueViolation,
  schema,
  type Db,
  notTransferCategory,
  spendPeriodWindow,
  visibilityScope,
} from '@family/database';
import { assertKrwInteger } from '@family/shared';

import { DB } from '../database/database.constants';
import {
  addBudgetMonths,
  fromEffectiveMonth,
  isPastBudgetMonth,
  resolveBudgetPeriod,
  threeMonthAverage,
  threeMonthPeriod,
  toEffectiveMonth,
  type BudgetPeriod,
} from './budget-month';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Roles permitted to mutate budgets (spec §1.4 / PRD §7.2). */
const PRIVILEGED_ROLES: readonly HouseholdRole[] = ['owner', 'admin'];

/** Coerces a driver-returned numeric aggregate (string | number) to an int. */
function toInt(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/* -------------------------------------------------------------------------- */
/* Query shapes                                                               */
/* -------------------------------------------------------------------------- */

/** Raw list query parameters (validated in the controller DTO). */
export interface BudgetListQuery {
  householdId?: string;
  month?: string;
}

/** HTTP 헤더에서 검증한 멱등 키를 본문 계약에 결합한 서비스 명령. */
interface BudgetCopyCommand extends BudgetCopyRequest {
  idempotencyKey: string;
}

@Injectable()
export class BudgetService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ---------------------------------------------------------------------- */
  /* List                                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Lists a household's budgets with each scope's selected-month usage. Open to
   * any active member. `month` (optional) selects the accounting month
   * (defaults to the current Asia/Seoul month).
   */
  async list(
    userId: string,
    query: BudgetListQuery,
  ): Promise<BudgetListResponse> {
    const householdId = this.requireHouseholdId(query.householdId);
    const actor = await this.requireMembership(householdId, userId);
    const period = this.resolvePeriod(query.month);

    const budgets = await this.db
      .select()
      .from(schema.budgets)
      .where(
        and(
          eq(schema.budgets.householdId, householdId),
          eq(schema.budgets.effectiveMonth, period.effectiveMonth),
        ),
      )
      .orderBy(asc(schema.budgets.createdAt), asc(schema.budgets.id));

    const labels = await this.buildScopeLabels(budgets);

    const items = await Promise.all(
      budgets.map(async (budget) => {
        const [spent, threeMonthTotal] = await Promise.all([
          this.computeSpent(budget, actor.id, period),
          this.computeSpent(budget, actor.id, threeMonthPeriod(period)),
        ]);
        return this.toSummary(
          budget,
          spent,
          threeMonthAverage(threeMonthTotal),
          labels.get(budget.id) ?? '가족 전체',
        );
      }),
    );

    return { items, month: period.month };
  }

  /* ---------------------------------------------------------------------- */
  /* Mutations                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Creates a budget (owner/admin only). Validates the scope reference belongs
   * to the household (`household` scope carries no ref). A duplicate scope
   * `(householdId, effectiveMonth, scopeType, scopeRefId)` yields a 409.
   */
  async create(
    userId: string,
    input: BudgetCreateRequest,
  ): Promise<BudgetSummary> {
    const actor = await this.requireMembership(
      input.householdId,
      userId,
      PRIVILEGED_ROLES,
    );

    assertKrwInteger(input.amount);
    const period = this.resolvePeriod(input.effectiveMonth);
    this.assertEditableMonth(period.month);
    if (input.scopeType !== 'card_group' && input.cardIds !== undefined) {
      throw new BadRequestException('카드 묶음 예산에서만 cardIds를 사용할 수 있습니다.');
    }
    const scopeRefId = input.scopeType === 'card_group'
      ? null
      : await this.resolveScopeRef(input.householdId, input.scopeType, input.scopeRefId);
    if (input.scopeType === 'card_group' && input.scopeRefId !== undefined) {
      throw new BadRequestException('카드 묶음 예산은 scopeRefId를 사용하지 않습니다.');
    }
    if (input.scopeType !== 'card_group') {
      await this.assertNoDuplicate(input.householdId, period.effectiveMonth, input.scopeType, scopeRefId);
    }

    let created: schema.Budget | undefined;
    try {
      created = await this.db.transaction(async (tx) => {
        const cardIds = input.scopeType === 'card_group'
          ? await this.validateCardGroup(input.householdId, input.cardIds ?? [], tx)
          : [];
        const [row] = await tx.insert(schema.budgets).values({
          householdId: input.householdId,
          name: input.name ?? null,
          scopeType: input.scopeType,
          scopeRefId,
          cardIds,
          amount: input.amount,
          effectiveMonth: period.effectiveMonth,
          createdBy: userId,
        }).returning();
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('a budget for this scope already exists');
      }
      throw error;
    }
    if (!created) {
      throw new Error('failed to create budget');
    }

    return this.summarize(created, actor.id);
  }

  /**
   * 이름·한도는 현재/미래월에만 수정한다. 카드 범위 정정은 과거월도 허용하되
   * 기존 범위를 비교하고 예산 ID·월·한도를 보존하며 같은 트랜잭션에 이력을 남긴다.
   */
  async update(
    userId: string,
    id: string,
    input: BudgetUpdateRequest,
  ): Promise<BudgetSummary> {
    const budget = await this.loadBudget(id);
    const actor = await this.requireMembership(budget.householdId, userId, PRIVILEGED_ROLES);
    const changesScope = input.scopeType !== undefined || input.cardIds !== undefined || input.expectedCardIds !== undefined;
    if (changesScope && (input.scopeType !== 'card_group' || !input.cardIds || !input.expectedCardIds)) {
      throw new BadRequestException('범위 정정에는 scopeType, cardIds, expectedCardIds가 모두 필요합니다.');
    }
    if (!changesScope || input.name !== undefined || input.amount !== undefined) {
      this.assertEditableMonth(fromEffectiveMonth(budget.effectiveMonth));
    }
    if (input.amount !== undefined) assertKrwInteger(input.amount);

    let updated: schema.Budget | undefined;
    try {
      updated = await this.db.transaction(async (tx) => {
        const [current] = await tx.select().from(schema.budgets)
          .where(eq(schema.budgets.id, id)).for('update');
        if (!current) throw new NotFoundException('budget not found');
        const updates: Partial<schema.NewBudget> = { updatedAt: new Date() };
        if (input.name !== undefined) updates.name = input.name;
        if (input.amount !== undefined) updates.amount = input.amount;
        if (changesScope) {
          if (current.scopeType !== 'card' && current.scopeType !== 'card_group') {
            throw new BadRequestException('카드 예산만 카드 묶음으로 정정할 수 있습니다.');
          }
          const previousCardIds = current.scopeType === 'card' && current.scopeRefId
            ? [current.scopeRefId]
            : current.cardIds;
          const expected = (input.expectedCardIds ?? []).map((value) => value.toLowerCase()).sort();
          if (JSON.stringify([...previousCardIds].sort()) !== JSON.stringify(expected)) {
            throw new ConflictException('예산 카드 범위가 변경됐습니다. 다시 조회해 주세요.');
          }
          const cardIds = await this.validateCardGroup(current.householdId, input.cardIds ?? [], tx);
          updates.scopeType = 'card_group';
          updates.scopeRefId = null;
          updates.cardIds = cardIds;
          if (JSON.stringify([...previousCardIds].sort()) !== JSON.stringify(cardIds)) {
            await tx.insert(schema.budgetScopeCorrections).values({
              budgetId: current.id, previousCardIds, cardIds, actorUserId: userId,
            });
          }
        }
        const [row] = await tx.update(schema.budgets).set(updates)
          .where(eq(schema.budgets.id, id)).returning();
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('같은 카드 묶음의 월 예산이 이미 있습니다.');
      throw error;
    }
    if (!updated) throw new NotFoundException('budget not found');
    return this.summarize(updated, actor.id);
  }

  /** Deletes a budget (owner/admin only). */
  async delete(userId: string, id: string): Promise<void> {
    const budget = await this.loadBudget(id);
    await this.requireMembership(budget.householdId, userId, PRIVILEGED_ROLES);
    this.assertEditableMonth(fromEffectiveMonth(budget.effectiveMonth));
    await this.db.delete(schema.budgets).where(eq(schema.budgets.id, id));
  }

  /**
   * source month의 계획을 바로 다음 달로 한 트랜잭션에 복사한다.
   * 같은 idempotencyKey 재시도는 최초 ID 집합을 돌려주고, 다른 요청이 target을 먼저
   * 만들었으면 일부 행도 남기지 않은 채 409로 끝낸다.
   */
  async copy(
    userId: string,
    input: BudgetCopyCommand,
  ): Promise<BudgetCopyResponse> {
    await this.requireMembership(input.householdId, userId, PRIVILEGED_ROLES);
    const source = this.resolvePeriod(input.sourceMonth);
    const target = this.resolvePeriod(input.targetMonth);
    if (addBudgetMonths(source.month, 1) !== target.month) {
      throw new BadRequestException(
        'targetMonth must be the month after sourceMonth',
      );
    }
    this.assertEditableMonth(target.month);

    const replay = await this.findCopyOperation(
      input.householdId,
      input.idempotencyKey,
    );
    if (replay) return this.copyResponse(replay, source.month, target.month);

    try {
      return await this.db.transaction(async (tx) => {
        const targetRows = await tx
          .select({
            scopeType: schema.budgets.scopeType,
            scopeRefId: schema.budgets.scopeRefId,
          })
          .from(schema.budgets)
          .where(
            and(
              eq(schema.budgets.householdId, input.householdId),
              eq(schema.budgets.effectiveMonth, target.effectiveMonth),
            ),
          );
        if (targetRows.length > 0) {
          throw new ConflictException({
            message: 'target month already has budgets',
            conflicts: targetRows,
          });
        }

        const sourceRows = await tx
          .select()
          .from(schema.budgets)
          .where(
            and(
              eq(schema.budgets.householdId, input.householdId),
              eq(schema.budgets.effectiveMonth, source.effectiveMonth),
            ),
          )
          .orderBy(asc(schema.budgets.createdAt), asc(schema.budgets.id));
        if (sourceRows.length === 0) {
          throw new NotFoundException('source month has no budgets');
        }

        // 새 달의 선택 범위는 현재도 유효해야 한다. 과거 월의 집계 범위는 바꾸지 않는다.
        for (const budget of sourceRows) {
          if (budget.scopeType === 'card_group') {
            await this.validateCardGroup(input.householdId, budget.cardIds, tx);
          }
        }
        const copiedBudgetIds = sourceRows.map(() => randomUUID());
        await tx.insert(schema.budgetCopyOperations).values({
          householdId: input.householdId,
          idempotencyKey: input.idempotencyKey,
          sourceMonth: source.effectiveMonth,
          targetMonth: target.effectiveMonth,
          copiedBudgetIds,
          copiedCount: copiedBudgetIds.length,
          createdBy: userId,
        });
        await tx.insert(schema.budgets).values(
          sourceRows.map((budget, index) => ({
            id: copiedBudgetIds[index],
            householdId: budget.householdId,
            name: budget.name,
            scopeType: budget.scopeType,
            scopeRefId: budget.scopeRefId,
            cardIds: budget.cardIds,
            amount: budget.amount,
            effectiveMonth: target.effectiveMonth,
            period: budget.period,
            currency: budget.currency,
            createdBy: userId,
          })),
        );

        return {
          sourceMonth: source.month,
          targetMonth: target.month,
          copiedCount: copiedBudgetIds.length,
          copiedBudgetIds,
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrentReplay = await this.findCopyOperation(
        input.householdId,
        input.idempotencyKey,
      );
      if (concurrentReplay) {
        return this.copyResponse(concurrentReplay, source.month, target.month);
      }
      const conflicts = await this.db
        .select({
          scopeType: schema.budgets.scopeType,
          scopeRefId: schema.budgets.scopeRefId,
        })
        .from(schema.budgets)
        .where(
          and(
            eq(schema.budgets.householdId, input.householdId),
            eq(schema.budgets.effectiveMonth, target.effectiveMonth),
          ),
        );
      throw new ConflictException({
        message: 'target month already has budgets',
        conflicts,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Spend aggregation (SQL only)                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Selected-month net spend of a budget's scope, computed in SQL. Sums
   * `netAmount` over `approval` rows whose `approvedAt` lies in `[from, to)`,
   * honouring the visibility scope (§1.2). Scope filters: `member` →
   * `memberId`, `category` → `categoryId`, `card` → `cardId`; `household` adds
   * no extra filter (household + summary_only rows, others' private excluded).
   */
  private async computeSpent(
    budget: schema.Budget,
    actorMemberId: string,
    period: BudgetPeriod,
  ): Promise<number> {
    const conditions: SQL[] = [
      eq(schema.cardTransactions.householdId, budget.householdId),
      eq(schema.cardTransactions.transactionType, 'approval'),
      // '중복이라 제외' 확정 거래는 예산 사용률에서도 뺀다(analytics와 동일 규칙).
      isNull(schema.cardTransactions.excludedAt),
      // 자산 이동(현금 인출·선불 충전)도 예산을 소진시키지 않는다 — 쓴 게 아니라 옮긴 것.
      notTransferCategory(),
      // 예산 통화와 같은 통화만 소진에 합산(amount=minor units). 외화 지출이 KRW
      // 예산 소진율을 오염시키지 않게 하고, 향후 비-KRW 예산도 자연히 지원한다.
      eq(schema.cardTransactions.currency, budget.currency),
      // 기간 창은 analytics/요약과 같은 공통 헬퍼(ADR-0026). approvedAt strict 비교였을
      // 때는 승인시각 미파싱 거래가 사용률에서 통째로 빠져 analytics 총액과 어긋났다.
      spendPeriodWindow(period.from, period.to),
      visibilityScope(actorMemberId),
    ];

    switch (budget.scopeType) {
      case 'member':
        if (budget.scopeRefId) {
          conditions.push(
            eq(schema.cardTransactions.memberId, budget.scopeRefId),
          );
        }
        break;
      case 'category':
        if (budget.scopeRefId) {
          conditions.push(
            eq(schema.cardTransactions.categoryId, budget.scopeRefId),
          );
        }
        break;
      case 'card':
        if (budget.scopeRefId) {
          conditions.push(
            eq(schema.cardTransactions.cardId, budget.scopeRefId),
          );
        }
        break;
      case 'card_group':
        conditions.push(budget.cardIds.length > 0
          ? inArray(schema.cardTransactions.cardId, budget.cardIds)
          : sql`false`);
        break;
      case 'household':
      default:
        break;
    }

    const [agg] = await this.db
      .select({
        spent: sql<string>`coalesce(sum(${schema.cardTransactions.netAmount}), 0)`,
      })
      .from(schema.cardTransactions)
      .where(and(...conditions));

    const spent = toInt(agg?.spent);
    assertKrwInteger(spent);
    return spent;
  }

  /* ---------------------------------------------------------------------- */
  /* Scope labels                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Resolves a display label per budget id: `household` → '가족 전체',
   * `member` → member name (join to users), `category` → category name,
   * `card` → card alias. Name lookups are batched (no N+1).
   */
  private async buildScopeLabels(
    budgets: schema.Budget[],
  ): Promise<Map<string, string>> {
    const memberIds = new Set<string>();
    const categoryIds = new Set<string>();
    const cardIds = new Set<string>();
    for (const budget of budgets) {
      if (budget.scopeType === 'card_group') budget.cardIds.forEach((id) => cardIds.add(id));
      if (!budget.scopeRefId) {
        continue;
      }
      if (budget.scopeType === 'member') {
        memberIds.add(budget.scopeRefId);
      } else if (budget.scopeType === 'category') {
        categoryIds.add(budget.scopeRefId);
      } else if (budget.scopeType === 'card') {
        cardIds.add(budget.scopeRefId);
      }
    }

    const memberNames = new Map<string, string>();
    if (memberIds.size > 0) {
      const rows = await this.db
        .select({
          id: schema.householdMembers.id,
          name: schema.users.name,
        })
        .from(schema.householdMembers)
        .innerJoin(
          schema.users,
          eq(schema.householdMembers.userId, schema.users.id),
        )
        .where(inArray(schema.householdMembers.id, [...memberIds]));
      for (const row of rows) {
        memberNames.set(row.id, row.name);
      }
    }

    const categoryNames = new Map<string, string>();
    if (categoryIds.size > 0) {
      const rows = await this.db
        .select({
          id: schema.expenseCategories.id,
          name: schema.expenseCategories.name,
        })
        .from(schema.expenseCategories)
        .where(inArray(schema.expenseCategories.id, [...categoryIds]));
      for (const row of rows) {
        categoryNames.set(row.id, row.name);
      }
    }

    const cardAliases = new Map<string, string>();
    if (cardIds.size > 0) {
      const rows = await this.db
        .select({
          id: schema.paymentCards.id,
          alias: schema.paymentCards.alias,
        })
        .from(schema.paymentCards)
        .where(inArray(schema.paymentCards.id, [...cardIds]));
      for (const row of rows) {
        cardAliases.set(row.id, row.alias);
      }
    }

    const labels = new Map<string, string>();
    for (const budget of budgets) {
      labels.set(
        budget.id,
        this.scopeLabelFor(budget, memberNames, categoryNames, cardAliases),
      );
    }
    return labels;
  }

  private scopeLabelFor(
    budget: schema.Budget,
    memberNames: Map<string, string>,
    categoryNames: Map<string, string>,
    cardAliases: Map<string, string>,
  ): string {
    switch (budget.scopeType) {
      case 'member':
        return (
          (budget.scopeRefId && memberNames.get(budget.scopeRefId)) ||
          '알 수 없는 구성원'
        );
      case 'category':
        return (
          (budget.scopeRefId && categoryNames.get(budget.scopeRefId)) ||
          '알 수 없는 카테고리'
        );
      case 'card':
        return (
          (budget.scopeRefId && cardAliases.get(budget.scopeRefId)) ||
          '알 수 없는 카드'
        );
      case 'card_group':
        return budget.cardIds.map((id) => cardAliases.get(id) ?? '알 수 없는 카드').join(' + ');
      case 'household':
      default:
        return '가족 전체';
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Authorization + validation                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Enforces that `userId` is an active member of `householdId` and (optionally)
   * holds one of `roles`. Non-members get a 403 that does not disclose whether
   * the household exists (PRD §26).
   */
  private async requireMembership(
    householdId: string,
    userId: string,
    roles?: readonly HouseholdRole[],
  ): Promise<schema.HouseholdMember> {
    const [member] = await this.db
      .select()
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.userId, userId),
          eq(schema.householdMembers.status, 'active'),
        ),
      )
      .limit(1);

    if (!member) {
      throw new ForbiddenException('not a household member');
    }
    if (roles && !roles.includes(member.role)) {
      throw new ForbiddenException('insufficient role');
    }
    return member;
  }

  /**
   * Validates and normalizes a budget's scope reference. `household` scope
   * carries no ref (always null); the others require a ref that belongs to the
   * household.
   */
  private async resolveScopeRef(
    householdId: string,
    scopeType: schema.Budget['scopeType'],
    scopeRefId: string | undefined,
  ): Promise<string | null> {
    if (scopeType === 'household') {
      return null;
    }
    if (!scopeRefId) {
      throw new BadRequestException(
        `scopeRefId is required for ${scopeType} budgets`,
      );
    }
    switch (scopeType) {
      case 'member':
        await this.assertMemberInHousehold(scopeRefId, householdId);
        break;
      case 'category':
        await this.assertCategoryUsable(scopeRefId, householdId);
        break;
      case 'card':
        await this.assertCardInHousehold(scopeRefId, householdId);
        break;
      default:
        break;
    }
    return scopeRefId;
  }

  /**
   * `(householdId, effectiveMonth, scopeType, scopeRefId)` 중복을 미리 잡아 **친절한
   * 409 메시지**를
   * 준다. 최종 권위는 DB다 — 이 조회와 insert 사이에는 직렬화 지점이 없어 동시 요청
   * 두 건은 둘 다 여기를 통과한다. household 스코프는 `scopeRefId`가 NULL이라 3열
   * UNIQUE로는 막히지 않으므로 월 부분 유니크 인덱스
   * (`budgets_household_month_scope_unique`, 0052)가 그 자리를 대신하고, 위반은
   * create()가 23505로 받아 같은 409로 변환한다.
   */
  private async assertNoDuplicate(
    householdId: string,
    effectiveMonth: string,
    scopeType: schema.Budget['scopeType'],
    scopeRefId: string | null,
  ): Promise<void> {
    const [existing] = await this.db
      .select({ id: schema.budgets.id })
      .from(schema.budgets)
      .where(
        and(
          eq(schema.budgets.householdId, householdId),
          eq(schema.budgets.effectiveMonth, effectiveMonth),
          eq(schema.budgets.scopeType, scopeType),
          scopeRefId === null
            ? isNull(schema.budgets.scopeRefId)
            : eq(schema.budgets.scopeRefId, scopeRefId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException('a budget for this scope already exists');
    }
  }

  /** Validates a target member belongs to the household. */
  private async assertMemberInHousehold(
    memberId: string,
    householdId: string,
  ): Promise<void> {
    const [member] = await this.db
      .select({ id: schema.householdMembers.id })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.id, memberId),
          eq(schema.householdMembers.householdId, householdId),
        ),
      )
      .limit(1);
    if (!member) {
      throw new BadRequestException('member does not belong to this household');
    }
  }

  /** Validates a category exists and is a system default or the household's own. */
  private async assertCategoryUsable(
    categoryId: string,
    householdId: string,
  ): Promise<void> {
    const [category] = await this.db
      .select({
        id: schema.expenseCategories.id,
        householdId: schema.expenseCategories.householdId,
      })
      .from(schema.expenseCategories)
      .where(eq(schema.expenseCategories.id, categoryId))
      .limit(1);
    if (
      !category ||
      (category.householdId !== null && category.householdId !== householdId)
    ) {
      throw new BadRequestException('invalid category');
    }
  }

  /**
   * 같은 가구·소유자의 활성 개인 카드만 묶는다. 카드를 공유 잠금해 검증 중 상태
   * 변경을 막으며, 정렬한 UUID 배열로 순서가 다른 중복 범위도 동일하게 취급한다.
   */
  private async validateCardGroup(
    householdId: string,
    input: readonly string[],
    db: Pick<Db, 'select'>,
  ): Promise<string[]> {
    const cardIds = input.map((id) => id.toLowerCase()).sort();
    if (cardIds.length < 2 || cardIds.length > 20 || new Set(cardIds).size !== cardIds.length) {
      throw new BadRequestException('서로 다른 개인 카드를 2개 이상 선택해 주세요.');
    }
    const rows = await db.select({ id: schema.paymentCards.id, ownerMemberId: schema.paymentCards.ownerMemberId })
      .from(schema.paymentCards).where(and(
        eq(schema.paymentCards.householdId, householdId),
        inArray(schema.paymentCards.id, cardIds),
        eq(schema.paymentCards.status, 'active'),
        eq(schema.paymentCards.isShared, false),
      )).orderBy(asc(schema.paymentCards.id)).for('share');
    if (rows.length !== cardIds.length || new Set(rows.map((row) => row.ownerMemberId)).size !== 1) {
      throw new BadRequestException('같은 가족 구성원의 활성 개인 카드만 묶을 수 있습니다.');
    }
    return cardIds;
  }

  /** Validates a card belongs to the household. */
  private async assertCardInHousehold(
    cardId: string,
    householdId: string,
  ): Promise<void> {
    const [card] = await this.db
      .select({ id: schema.paymentCards.id })
      .from(schema.paymentCards)
      .where(
        and(
          eq(schema.paymentCards.id, cardId),
          eq(schema.paymentCards.householdId, householdId),
        ),
      )
      .limit(1);
    if (!card) {
      throw new BadRequestException('card does not belong to this household');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Loaders + projection                                                    */
  /* ---------------------------------------------------------------------- */

  private async loadBudget(id: string): Promise<schema.Budget> {
    const [budget] = await this.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.id, id))
      .limit(1);
    if (!budget) {
      throw new NotFoundException('budget not found');
    }
    return budget;
  }

  /** 한 달의 계획과 같은 달의 파생 실지출·참고 평균을 투영한다. */
  private async summarize(
    budget: schema.Budget,
    actorMemberId: string,
  ): Promise<BudgetSummary> {
    const period = this.resolvePeriod(
      fromEffectiveMonth(budget.effectiveMonth),
    );
    const [spent, threeMonthTotal] = await Promise.all([
      this.computeSpent(budget, actorMemberId, period),
      this.computeSpent(budget, actorMemberId, threeMonthPeriod(period)),
    ]);
    const labels = await this.buildScopeLabels([budget]);
    return this.toSummary(
      budget,
      spent,
      threeMonthAverage(threeMonthTotal),
      labels.get(budget.id) ?? '가족 전체',
    );
  }

  private toSummary(
    budget: schema.Budget,
    spent: number,
    threeMonthAverageSpent: number,
    scopeLabel: string,
  ): BudgetSummary {
    const remaining = budget.amount - spent;
    const usageRate = budget.amount > 0 ? spent / budget.amount : 0;
    return {
      id: budget.id,
      householdId: budget.householdId,
      name: budget.name,
      scopeType: budget.scopeType,
      scopeRefId: budget.scopeRefId,
      cardIds: budget.cardIds,
      scopeLabel,
      effectiveMonth: fromEffectiveMonth(budget.effectiveMonth),
      amount: budget.amount,
      spent,
      threeMonthAverageSpent,
      remaining,
      usageRate,
      period: budget.period,
      currency: budget.currency,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Input parsing                                                           */
  /* ---------------------------------------------------------------------- */

  private requireHouseholdId(householdId: string | undefined): string {
    if (!householdId) {
      throw new BadRequestException('householdId is required');
    }
    return householdId;
  }

  /**
   * Resolves the accounting month window in Asia/Seoul (fixed UTC+9, no DST).
   * `month=YYYY-MM` selects that month; otherwise the current Seoul month is
   * used. Returns `[from, to)` UTC instants for the `[monthStart, nextMonth)`
   * range plus the normalized `YYYY-MM` label.
   */
  private resolvePeriod(month: string | undefined): BudgetPeriod {
    try {
      return resolveBudgetPeriod(month);
    } catch {
      throw new BadRequestException('month must be in YYYY-MM format');
    }
  }

  /** 과거월 한도·이름·생성·삭제는 금지한다. 명시적 카드 범위 정정만 별도 경로다. */
  private assertEditableMonth(month: string): void {
    if (isPastBudgetMonth(month)) {
      throw new BadRequestException('past month budgets are read-only');
    }
  }

  /** 같은 가구 안의 복사 멱등 키를 찾는다. */
  private async findCopyOperation(
    householdId: string,
    idempotencyKey: string,
  ): Promise<schema.BudgetCopyOperation | undefined> {
    const [operation] = await this.db
      .select()
      .from(schema.budgetCopyOperations)
      .where(
        and(
          eq(schema.budgetCopyOperations.householdId, householdId),
          eq(schema.budgetCopyOperations.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return operation;
  }

  /** idempotencyKey를 다른 source/target에 재사용하면 기존 결과를 오인하지 않게 막는다. */
  private copyResponse(
    operation: schema.BudgetCopyOperation,
    sourceMonth: string,
    targetMonth: string,
  ): BudgetCopyResponse {
    if (
      operation.sourceMonth !== toEffectiveMonth(sourceMonth) ||
      operation.targetMonth !== toEffectiveMonth(targetMonth)
    ) {
      throw new ConflictException('idempotency key was used for another copy');
    }
    return {
      sourceMonth,
      targetMonth,
      copiedCount: operation.copiedCount,
      copiedBudgetIds: operation.copiedBudgetIds,
    };
  }
}
