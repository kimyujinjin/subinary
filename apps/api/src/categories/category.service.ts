/**
 * Category service (Phase 4 Build Spec §5.2, extended).
 *
 * Read: the catalogue is the union of system categories (`householdId = null`)
 * and a household's own custom categories. Write (custom only): any active
 * household member may create/rename/delete a household category; system
 * categories are immutable. Deleting a custom category reverts its transactions
 * to unclassified and removes dependent merchant rules / category budgets.
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, or } from 'drizzle-orm';

import type {
  CategoryCreateRequest,
  CategorySummary,
  CategoryUpdateRequest,
} from '@family/contracts';
import { schema, type Db } from '@family/database';

import { DB } from '../database/database.constants';
import { RealtimePublisherService } from '../realtime/realtime-publisher.service';

/** Projects an expense-category row onto its public summary. */
function toCategorySummary(row: schema.ExpenseCategory): CategorySummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isSystem: row.isSystem,
  };
}

@Injectable()
export class CategoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtimePublisher: RealtimePublisherService,
  ) {}

  /**
   * Lists system categories plus the given household's custom categories.
   * System first, then custom, each ordered by slug for stability.
   *
   * 쓰기 경로(create/update/delete)와 동일하게 **멤버십을 강제한다** — 이전에는 읽기만
   * 검사가 빠져 있어 인증된 사용자가 임의 householdId로 남의 커스텀 카테고리 이름을
   * 조회할 수 있었다(households가 1개뿐이라 표면화되지 않았을 뿐).
   */
  async listCategories(
    userId: string,
    householdId: string,
  ): Promise<CategorySummary[]> {
    await this.requireMembership(householdId, userId);
    return this.queryCategories(householdId);
  }

  /**
   * 인가 없이 카탈로그만 읽는 내부 조회. 이미 멤버십을 확인한 호출자
   * (`listCategories`, `assertNameAvailable`)만 사용한다.
   */
  private async queryCategories(householdId: string): Promise<CategorySummary[]> {
    const rows = await this.db
      .select()
      .from(schema.expenseCategories)
      .where(
        or(
          isNull(schema.expenseCategories.householdId),
          eq(schema.expenseCategories.householdId, householdId),
        ),
      )
      .orderBy(
        asc(schema.expenseCategories.isSystem),
        asc(schema.expenseCategories.slug),
      );

    return rows.map(toCategorySummary);
  }

  /**
   * Resolves a system-category `slug` to its id, or `null` when unknown.
   * Scoped to system categories (`householdId IS NULL`).
   */
  async resolveSlugToId(slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.expenseCategories.id })
      .from(schema.expenseCategories)
      .where(
        and(
          eq(schema.expenseCategories.slug, slug),
          isNull(schema.expenseCategories.householdId),
        ),
      )
      .limit(1);

    return row?.id ?? null;
  }

  /**
   * Creates a household custom category (name only). Slug is an opaque,
   * per-household identifier; `isSystem` is always false. Any active member may
   * create. Duplicate names (incl. system) within the household are rejected.
   */
  async createCategory(
    userId: string,
    input: CategoryCreateRequest,
  ): Promise<CategorySummary> {
    await this.requireMembership(input.householdId, userId);
    const name = input.name.trim();
    await this.assertNameAvailable(input.householdId, name);

    const [row] = await this.db
      .insert(schema.expenseCategories)
      .values({
        householdId: input.householdId,
        slug: `custom-${randomUUID().slice(0, 8)}`,
        name,
        isSystem: false,
      })
      .returning();
    return toCategorySummary(row);
  }

  /** Renames a household custom category. System categories are immutable. */
  async updateCategory(
    userId: string,
    id: string,
    input: CategoryUpdateRequest,
  ): Promise<CategorySummary> {
    const cat = await this.getCustomOrThrow(id);
    const householdId = cat.householdId as string;
    await this.requireMembership(householdId, userId);
    const name = input.name.trim();
    await this.assertNameAvailable(householdId, name, id);

    const [row] = await this.db
      .update(schema.expenseCategories)
      .set({ name })
      .where(eq(schema.expenseCategories.id, id))
      .returning();
    // 이름 변경이 가족의 거래/분석 라벨에 반영되도록 힌트 발행(best-effort).
    void this.realtimePublisher.publish(householdId, 'categories.changed');
    return toCategorySummary(row);
  }

  /**
   * Deletes a household custom category. Transactions using it revert to
   * unclassified (categoryId = null); dependent merchant rules and
   * category-scoped budgets are removed. System categories cannot be deleted.
   */
  async deleteCategory(userId: string, id: string): Promise<void> {
    const cat = await this.getCustomOrThrow(id);
    const householdId = cat.householdId as string;
    const role = await this.memberRole(householdId, userId);

    await this.db.transaction(async (tx) => {
      // 예산에 쓰는 카테고리를 지우면 그 예산도 지워진다 — 예산을 만들 수 있는 사람(소유자·관리자)만.
      const [budget] = await tx
        .select({ id: schema.budgets.id })
        .from(schema.budgets)
        .where(and(eq(schema.budgets.scopeType, 'category'), eq(schema.budgets.scopeRefId, id)))
        .limit(1);
      if (budget && role !== 'owner' && role !== 'admin') {
        throw new ForbiddenException('예산에 쓰는 카테고리는 가족 관리자만 지울 수 있어요.');
      }
      // '지난 거래 다시 분류' 기록과 학습 자료는 이 카테고리·규칙을 가리킨다(FK NO ACTION). 기록을
      // 지우면 되돌리기·학습 계보가 끊기므로 지우지 않는다 — 예전에는 여기서 FK 위반 500이 났다.
      const [batch] = await tx
        .select({ id: schema.categoryRecategorizeBatches.id })
        .from(schema.categoryRecategorizeBatches)
        .where(eq(schema.categoryRecategorizeBatches.toCategoryId, id))
        .limit(1);
      const [item] = await tx
        .select({ batchId: schema.categoryRecategorizeItems.batchId })
        .from(schema.categoryRecategorizeItems)
        .where(eq(schema.categoryRecategorizeItems.previousCategoryId, id))
        .limit(1);
      const [snapshot] = await tx
        .select({ id: schema.datasetSnapshotItems.id })
        .from(schema.datasetSnapshotItems)
        .innerJoin(
          schema.merchantCategoryRules,
          eq(schema.merchantCategoryRules.id, schema.datasetSnapshotItems.merchantCategoryRuleId),
        )
        .where(eq(schema.merchantCategoryRules.categoryId, id))
        .limit(1);
      if (batch || item || snapshot) {
        throw new ConflictException('지난 분류 변경 기록에 쓰인 카테고리라 지울 수 없어요. 이름을 바꿔 계속 쓸 수 있어요.');
      }

      // 이 카테고리를 쓰던 거래는 '미분류'로 되돌린다.
      await tx
        .update(schema.cardTransactions)
        .set({ categoryId: null })
        .where(eq(schema.cardTransactions.categoryId, id));
      // 이 카테고리를 가리키는 가맹점 자동분류 규칙 제거.
      await tx
        .delete(schema.merchantCategoryRules)
        .where(eq(schema.merchantCategoryRules.categoryId, id));
      // 이 카테고리에 묶인 카테고리-스코프 예산 제거(고아 방지).
      await tx
        .delete(schema.budgets)
        .where(
          and(
            eq(schema.budgets.scopeType, 'category'),
            eq(schema.budgets.scopeRefId, id),
          ),
        );
      await tx
        .delete(schema.expenseCategories)
        .where(eq(schema.expenseCategories.id, id));
    });
    // 거래가 미분류로 되돌아가고 예산/규칙이 정리되므로 가족 화면에 힌트 발행.
    void this.realtimePublisher.publish(householdId, 'categories.changed');
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Enforces that `userId` is an active member of `householdId` (403 otherwise,
   * without disclosing whether the household exists — PRD §26).
   */
  /** 활성 구성원의 역할. 구성원이 아니면 403(요구 사항은 requireMembership과 같다). */
  private async memberRole(householdId: string, userId: string): Promise<string> {
    const [member] = await this.db
      .select({ role: schema.householdMembers.role })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.userId, userId),
          eq(schema.householdMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (!member) throw new ForbiddenException('not a household member');
    return member.role;
  }

  private async requireMembership(
    householdId: string,
    userId: string,
  ): Promise<void> {
    const [member] = await this.db
      .select({ id: schema.householdMembers.id })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.userId, userId),
          eq(schema.householdMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (!member) throw new ForbiddenException('not a household member');
  }

  /** Loads a category by id, ensuring it is an editable household custom one. */
  private async getCustomOrThrow(id: string): Promise<schema.ExpenseCategory> {
    const [cat] = await this.db
      .select()
      .from(schema.expenseCategories)
      .where(eq(schema.expenseCategories.id, id))
      .limit(1);
    if (!cat) throw new NotFoundException('category not found');
    if (cat.isSystem || cat.householdId == null) {
      throw new ForbiddenException('시스템 카테고리는 수정/삭제할 수 없어요');
    }
    return cat;
  }

  /** Rejects a name already used by a system or this household's category. */
  private async assertNameAvailable(
    householdId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const norm = (s: string) => s.trim().toLowerCase();
    const existing = await this.queryCategories(householdId);
    const clash = existing.some(
      (c) => c.id !== excludeId && norm(c.name) === norm(name),
    );
    if (clash) throw new ConflictException('이미 있는 카테고리 이름이에요');
  }
}
