/**
 * Payment-card domain service (Phase 4 Build Spec §5.1).
 *
 * Authorization is enforced *here* in the service layer against `actorUserId`
 * (PRD §26/§8) — controllers never make trust decisions. Every path resolves
 * the caller's active household membership first (a lightweight
 * `requireMembership` helper), so a non-member always receives a 403 and never
 * learns whether the household or card exists.
 *
 * `maskedNumber` hygiene: this value is used only to auto-link parsed card-SMS
 * to a card by its **last 4 digits** (spec §1.5; parser emits `****1234`).
 * Callers SHOULD persist only the last 4 digits (e.g. `'1234'`) — never a full
 * PAN. The value and any other PII are never logged.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';

import type {
  CardCreateRequest,
  CardLast4CorrectionRequest,
  CardSummary,
  CardUpdateRequest,
} from '@family/contracts';
import { cardLast4CorrectionRequestSchema } from '@family/contracts';
import { schema, type Db } from '@family/database';
import { resolvePaymentCardLink } from '@family/shared';

/**
 * Card registration result: the card plus how many previously-unlinked
 * transactions this registration retroactively linked (backfill). Kept out of
 * the shared `CardSummary` because it is meaningful only on create.
 */
export type CardCreateResult = CardSummary & {
  linkedTransactionCount: number;
};

import { DB } from '../database/database.constants';

/** Roles permitted to manage a card they do not personally own (spec §5.1). */
const MANAGER_ROLES: readonly schema.HouseholdMember['role'][] = [
  'owner',
  'admin',
];

/** Projects a payment-card row onto its public-safe summary (no fingerprint). */
function toCardSummary(card: schema.PaymentCard): CardSummary {
  return {
    id: card.id,
    householdId: card.householdId,
    ownerMemberId: card.ownerMemberId,
    issuer: card.issuer,
    alias: card.alias,
    maskedNumber: card.maskedNumber,
    visibility: card.visibility,
    isShared: card.isShared,
    status: card.status,
    createdAt: card.createdAt.toISOString(),
  };
}

@Injectable()
export class CardService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ---------------------------------------------------------------------- */
  /* Authorization helper                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Enforces that `userId` is an active member of `householdId`. Non-members
   * get a 403 that does not disclose whether the household exists (PRD §26).
   * Returns the membership so callers can apply owner/role checks.
   */
  private async requireMembership(
    householdId: string,
    userId: string,
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
    return member;
  }

  /**
   * Validates that `memberId` is an **active** member of `householdId` — used to
   * guard card owner assignment/reassignment. A card's owner drives its icon
   * color and owner-scoped permissions, so an owner outside the household (or
   * inactive) must be rejected. 400 rather than 404 (client sent a bad owner).
   */
  private async assertActiveMember(
    householdId: string,
    memberId: string,
  ): Promise<void> {
    const [member] = await this.db
      .select({ id: schema.householdMembers.id })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.id, memberId),
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (!member) {
      throw new BadRequestException('owner must be an active household member');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Card management                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * 호출자의 가구에 카드를 등록한다. 소유자는 명시한 활성 구성원이며 생략 시
   * 등록자 본인이다. 등록 후 원본 구성원·발급사·번호가 유일하게 일치하는 미연결
   * 거래만 소급 연결하고, 실제 연결 건수를 반환한다.
   */
  async create(
    userId: string,
    input: CardCreateRequest,
  ): Promise<CardCreateResult> {
    const membership = await this.requireMembership(input.householdId, userId);

    // 소유자: 지정 없으면 등록자 본인. 다른 구성원 지정 시 같은 household의 활성
    // 구성원인지 검증한다(아이콘 색·소유자 권한이 여기서 결정됨).
    const ownerMemberId = input.ownerMemberId ?? membership.id;
    if (ownerMemberId !== membership.id) {
      await this.assertActiveMember(input.householdId, ownerMemberId);
    }

    const [created] = await this.db
      .insert(schema.paymentCards)
      .values({
        householdId: input.householdId,
        ownerMemberId,
        issuer: input.issuer,
        alias: input.alias,
        // 저장 권장: 카드번호 뒤 4자리만(자동연결은 뒤 4자리 매칭, §1.5). 전체 PAN 금지.
        maskedNumber: input.maskedNumber ?? null,
        visibility: input.visibility,
        createdBy: userId,
      })
      .returning();

    if (!created) {
      throw new Error('failed to create payment card');
    }

    const linkedTransactionCount = await this.backfillUnlinked(created);
    return { ...toCardSummary(created), linkedTransactionCount };
  }

  /**
   * Retroactively links previously-unlinked transactions to a newly registered
   * card by matching the card's last 4 digits against each transaction's source
   * SMS (`card_sms_events.maskedCardNumber`). Auto-linking is not retroactive on
   * its own (promotion only sees cards that existed at the time), so without this
   * a card registered after its transactions arrived would never claim them.
   *
   * Safeguards mirror the promotion path:
   * - 원본 구성원 소유 카드 또는 공용 카드 중 발급사·뒤 4자리로 유일한 카드만 연결;
   * - 번호 없는 문자도 같은 구성원 범위를 지키며 공통 판정 함수를 사용;
   * - only `cardId IS NULL` rows, and never `pending_review` rows (those were
   *   flagged for human review and must not be silently claimed);
   * - linked rows inherit the card's visibility (consistent with promotion and
   *   manual assignment — linking a card means its visibility applies).
   *
   * Best-effort: a failure here never fails card creation (returns 0).
   */
  private async backfillUnlinked(
    card: schema.PaymentCard,
  ): Promise<number> {
    try {
      const activeCards = await this.db
        .select({
          id: schema.paymentCards.id,
          maskedNumber: schema.paymentCards.maskedNumber,
          issuer: schema.paymentCards.issuer,
          ownerMemberId: schema.paymentCards.ownerMemberId,
          isShared: schema.paymentCards.isShared,
          visibility: schema.paymentCards.visibility,
        })
        .from(schema.paymentCards)
        .where(
          and(
            eq(schema.paymentCards.householdId, card.householdId),
            eq(schema.paymentCards.status, 'active'),
          ),
        );

      // cardId=null·비검토 거래 + 원본 SMS의 뒤 4자리·발급사.
      const candidates = await this.db
        .select({
          id: schema.cardTransactions.id,
          memberId: schema.cardSmsEvents.memberId,
          maskedCardNumber: schema.cardSmsEvents.maskedCardNumber,
          issuer: schema.cardSmsEvents.issuer,
        })
        .from(schema.cardTransactions)
        .innerJoin(
          schema.cardSmsEvents,
          eq(schema.cardSmsEvents.id, schema.cardTransactions.sourceEventId),
        )
        .where(
          and(
            eq(schema.cardTransactions.householdId, card.householdId),
            eq(schema.cardTransactions.memberId, schema.cardSmsEvents.memberId),
            isNull(schema.cardTransactions.cardId),
            ne(schema.cardTransactions.status, 'pending_review'),
          ),
        );

      const matchIds = new Set<string>();
      for (const c of candidates) {
        const link = resolvePaymentCardLink(c, activeCards);
        if (link.cardId === card.id) {
          matchIds.add(c.id);
        }
      }
      if (matchIds.size === 0) {
        return 0;
      }

      const linked = await this.db
        .update(schema.cardTransactions)
        .set({
          cardId: card.id,
          visibility: card.visibility,
          updatedAt: new Date(),
        })
        .where(and(
          inArray(schema.cardTransactions.id, [...matchIds]),
          isNull(schema.cardTransactions.cardId),
          ne(schema.cardTransactions.status, 'pending_review'),
        ))
        .returning({ id: schema.cardTransactions.id });

      // 조회 후 사용자가 직접 연결했거나 검토로 바꾼 거래는 덮어쓰지 않는다.
      return linked.length;
    } catch {
      return 0;
    }
  }

  /** Lists every card in the caller's household (any active member). */
  async list(userId: string, householdId: string): Promise<CardSummary[]> {
    await this.requireMembership(householdId, userId);

    const rows = await this.db
      .select()
      .from(schema.paymentCards)
      .where(eq(schema.paymentCards.householdId, householdId))
      .orderBy(desc(schema.paymentCards.createdAt));

    return rows.map(toCardSummary);
  }

  /** Returns a single card scoped to the caller's household membership. */
  async get(userId: string, id: string): Promise<CardSummary> {
    const card = await this.loadCard(id);
    await this.requireMembership(card.householdId, userId);
    return toCardSummary(card);
  }

  /**
   * Updates a card's `alias` / `visibility` / `status`. Permitted for the card
   * owner (its `ownerMemberId` is the caller's membership) or a household
   * owner/admin (spec §5.1). Everyone else gets a 403.
   */
  async update(
    userId: string,
    id: string,
    input: CardUpdateRequest,
  ): Promise<CardSummary> {
    const card = await this.loadCard(id);
    const membership = await this.requireMembership(card.householdId, userId);

    const isOwner = membership.id === card.ownerMemberId;
    const isManager = MANAGER_ROLES.includes(membership.role);
    if (!isOwner && !isManager) {
      throw new ForbiddenException('insufficient permission');
    }

    const patch: {
      alias?: string;
      visibility?: schema.PaymentCard['visibility'];
      isShared?: boolean;
      status?: schema.PaymentCard['status'];
      ownerMemberId?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (input.isShared !== undefined) {
      /**
       * 공용 표시는 **거래를 건드리지 않는다.** 구성원별 집계가 조인 시점에 이 플래그를
       * 읽으므로 켜는 순간 과거까지 함께 '공용'으로 묶이고, 끄면 그대로 돌아온다.
       * UPDATE가 없는 설계가 소급을 가장 안전하게 만든다.
       *
       * `private`과는 함께 성립하지 않는다 — "같이 쓰는데 나만 본다"는 모순이고, 집계가
       * 공용으로 묶은 금액을 정작 다른 사용자는 볼 수 없어 합계가 사람마다 달라진다.
       */
      if (input.isShared && (input.visibility ?? card.visibility) === 'private') {
        throw new BadRequestException(
          '나만 보기 카드는 공용으로 표시할 수 없어요. 공개 범위를 먼저 바꿔 주세요.',
        );
      }
      patch.isShared = input.isShared;
    }
    if (input.alias !== undefined) {
      patch.alias = input.alias;
    }
    if (input.visibility !== undefined) {
      patch.visibility = input.visibility;
    }
    if (input.status !== undefined) {
      patch.status = input.status;
    }
    // 소유자 재지정: 같은 household의 활성 구성원만 허용. 아이콘 색이 새 소유자
    // 색으로 바뀐다. 권한은 위 isOwner/isManager 게이트를 그대로 따른다.
    if (input.ownerMemberId !== undefined) {
      await this.assertActiveMember(card.householdId, input.ownerMemberId);
      patch.ownerMemberId = input.ownerMemberId;
    }

    const [updated] = await this.db
      .update(schema.paymentCards)
      .set(patch)
      .where(eq(schema.paymentCards.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('card not found');
    }
    return toCardSummary(updated);
  }

  /**
   * A correction is independent of create/backfill. The household FOR UPDATE lock
   * serializes corrections and conflicts with the FK KEY SHARE of card INSERTs.
   * READ COMMITTED then observes an INSERT that committed before our lock was acquired.
   * Lock order: household -> active actor membership -> cards ordered by id.
   * Later row locks use NOWAIT: existing promotion writers lock a card before
   * their household FK check, so waiting while holding this household can deadlock.
   */
  async correctLast4(userId: string, id: string, input: CardLast4CorrectionRequest): Promise<CardSummary> {
    // This service can also be called directly, without the HTTP validation pipe.
    const parsed = cardLast4CorrectionRequestSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('카드 뒤 4자리와 변경 전 번호를 확인해 주세요.');
    const { last4, expectedLast4 } = parsed.data;
    const initial = await this.loadCard(id);
    const initialMember = await this.requireMembership(initial.householdId, userId);
    this.assertCanCorrectLast4(initialMember, initial);

    try {
      return await this.db.transaction(async (tx) => {
        const [household] = await tx.select({ id: schema.households.id }).from(schema.households)
          .where(and(eq(schema.households.id, initial.householdId), isNull(schema.households.deletedAt)))
          .for('update').limit(1);
        if (!household) throw new ForbiddenException('not a household member');
        const [member] = await tx.select().from(schema.householdMembers).where(and(
          eq(schema.householdMembers.householdId, initial.householdId),
          eq(schema.householdMembers.userId, userId), eq(schema.householdMembers.status, 'active'),
        )).for('share', { noWait: true }).limit(1);
        if (!member) throw new ForbiddenException('not a household member');
        const cards = await tx.select().from(schema.paymentCards)
          .where(eq(schema.paymentCards.householdId, initial.householdId))
          .orderBy(asc(schema.paymentCards.id)).for('update', { noWait: true });
        const target = cards.find(card => card.id === id);
        if (!target) throw new NotFoundException('card not found');
        this.assertCanCorrectLast4(member, target);

        // Legacy decoration such as ****1234 is understood, but a PAN or malformed
        // non-null value is never truncated or guessed to mean an unregistered card.
        const digits = target.maskedNumber?.replace(/[^0-9]/g, '') ?? null;
        if (digits !== null && digits.length !== 4) throw this.last4Stale();
        const currentLast4 = digits;
        if (currentLast4 === last4) return toCardSummary(target); // also safe after a lost response
        if (currentLast4 !== expectedLast4) throw this.last4Stale();

        if (target.status === 'active') {
          for (const other of cards) {
            if (other.id === id || other.status !== 'active') continue;
            // Either shared card overlaps the other owner's matching scope. Reuse
            // the normal issuer/tail matcher rather than duplicating its normalization.
            const source = { memberId: target.isShared ? other.ownerMemberId : target.ownerMemberId,
              issuer: target.issuer, maskedCardNumber: last4 };
            const otherDigits = other.maskedNumber?.replace(/[^0-9]/g, '') ?? null;
            if (otherDigits !== null && otherDigits.length !== 4) {
              // Compare only issuer/owner overlap with an identical synthetic tail.
              // The malformed stored value is never truncated into guessed digits.
              if (resolvePaymentCardLink(source, [{ ...other, maskedNumber: last4 }]).cardId === other.id) {
                throw this.last4Stale();
              }
              continue;
            }
            if (resolvePaymentCardLink(source, [other]).cardId === other.id) {
              throw new ConflictException({ code: 'card_last4_conflict',
                message: '같은 조건으로 자동 연결되는 카드가 이미 있어요. 카드 목록을 확인해 주세요.' });
            }
          }
        }
        const [updated] = await tx.update(schema.paymentCards).set({ maskedNumber: last4, updatedAt: new Date() })
          .where(and(eq(schema.paymentCards.id, id), eq(schema.paymentCards.householdId, target.householdId),
            target.maskedNumber === null ? isNull(schema.paymentCards.maskedNumber)
              : eq(schema.paymentCards.maskedNumber, target.maskedNumber)))
          .returning();
        if (!updated) throw this.last4Stale();
        return toCardSummary(updated);
      }, { isolationLevel: 'read committed' });
    } catch (error) {
      // Drizzle wraps the driver's SQLSTATE in cause. Do not expose SQL or binds.
      let cause: unknown = error;
      for (let depth = 0; depth < 4 && cause !== null && typeof cause === 'object'; depth += 1) {
        const record = cause as { code?: unknown; cause?: unknown };
        if (record.code === '55P03') throw this.last4Stale();
        cause = record.cause;
      }
      throw error;
    }
  }

  private assertCanCorrectLast4(member: schema.HouseholdMember, card: schema.PaymentCard): void {
    if (member.id !== card.ownerMemberId && !MANAGER_ROLES.includes(member.role)) {
      throw new ForbiddenException('insufficient permission');
    }
  }

  private last4Stale(): ConflictException {
    return new ConflictException({ code: 'card_last4_stale',
      message: '카드 정보가 변경됐거나 번호를 확인할 수 없어요. 카드 목록을 다시 확인해 주세요.' });
  }

  /* ---------------------------------------------------------------------- */
  /* Internal loaders                                                        */
  /* ---------------------------------------------------------------------- */

  private async loadCard(id: string): Promise<schema.PaymentCard> {
    const [card] = await this.db
      .select()
      .from(schema.paymentCards)
      .where(eq(schema.paymentCards.id, id))
      .limit(1);
    if (!card) {
      throw new NotFoundException('card not found');
    }
    return card;
  }
}
