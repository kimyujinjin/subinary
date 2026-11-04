import { InjectQueue } from "@nestjs/bullmq";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  reviewRequestCreateSchema,
  reviewRequestResolveSchema,
  type ReviewRequestListResponse,
  type ReviewRequestResolveResponse,
  type ReviewRequestSummary,
} from "@family/contracts";
import type { Db } from "@family/database";
import { QUEUE_NAMES, type NotificationDispatchJob } from "@family/shared";

import { DB } from "../database/database.constants";

type Executor = Pick<Db, "execute">;
type Time = Date | string;
interface MemberRow {
  id: string;
  user_id: string;
  name: string;
}
interface RequestRow {
  id: string;
  household_id: string;
  transaction_id: string;
  requester_member_id: string;
  requester_name: string;
  assignee_member_id: string;
  assignee_name: string;
  merchant_normalized: string | null;
  merchant_raw: string | null;
  amount: number | string;
  currency: string | null;
  occurred_at: Time;
  created_at: Time;
}
interface OpenRow {
  id: string;
  requester_member_id: string;
  assignee_member_id: string;
  requester_user_id: string;
  transaction_id: string;
  resolved_at: Time | null;
}
interface TransactionRow {
  id: string;
  visibility: string;
  merchant_normalized: string | null;
  merchant_raw: string | null;
  amount: number | string;
  currency: string | null;
}

const uuid = z.string().uuid();
const iso = (value: Time): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();
const merchantOf = (row: {
  merchant_normalized: string | null;
  merchant_raw: string | null;
}) => row.merchant_normalized ?? row.merchant_raw ?? null;

/**
 * 가족에게 결제 물어보기(확인 요청). 거래를 바꾸지 않고 "누가 누구에게 무엇을 물었나"만 남긴다.
 *
 * - 가족 공개(`household`) 결제만 물어볼 수 있다. 공개 범위가 나중에 바뀌면 목록에서 빠진다.
 * - 열린 요청은 (결제, 받는 사람)당 하나다(부분 유니크 인덱스). 다시 눌러도 알림이 두 번 가지 않는다.
 * - 알림은 커밋 **뒤에** 넣는다. 롤백된 요청의 알림이 나가면 안 된다. 알림 실패는 요청을 되돌리지 않는다
 *   — 받은 사람은 홈의 '가족이 물어본 결제' 줄로도 본다.
 */
@Injectable()
export class ReviewRequestsService {
  private readonly logger = new Logger(ReviewRequestsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_DISPATCH)
    private readonly notifications: Queue
  ) {}

  private parse<T>(contract: z.ZodType<T>, input: unknown): T {
    const parsed = contract.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("요청 형식을 확인해 주세요.");
    return parsed.data;
  }

  private async rows<T>(db: Executor, query: SQL): Promise<T[]> {
    return (await db.execute(query)) as unknown as T[];
  }

  private async me(
    db: Executor,
    householdId: string,
    userId: string
  ): Promise<MemberRow> {
    const [row] = await this.rows<MemberRow>(
      db,
      sql`select m.id, m.user_id, u.name from household_members m
      join users u on u.id = m.user_id
      where m.household_id = ${householdId} and m.user_id = ${userId} and m.status = 'active' and u.deleted_at is null limit 1`
    );
    if (!row) throw new ForbiddenException("가족 구성원만 쓸 수 있어요.");
    return row;
  }

  /** 열린 요청 + 이름·결제 요약. `involving`이 있으면 그 구성원이 보내거나 받은 것만. */
  private async open(
    db: Executor,
    householdId: string,
    filter: SQL,
    involving: string | null
  ): Promise<RequestRow[]> {
    const mine = involving
      ? sql`and (r.assignee_member_id = ${involving} or r.requester_member_id = ${involving})`
      : sql``;
    return this.rows<RequestRow>(
      db,
      sql`select r.id, r.household_id, r.transaction_id,
        r.requester_member_id, ru.name as requester_name, r.assignee_member_id, au.name as assignee_name,
        t.merchant_normalized, t.merchant_raw, t.amount, t.currency,
        coalesce(t.approved_at, t.cancelled_at, t.created_at) as occurred_at, r.created_at
      from transaction_review_requests r
      join household_members rm on rm.id = r.requester_member_id join users ru on ru.id = rm.user_id
      join household_members am on am.id = r.assignee_member_id join users au on au.id = am.user_id
      join card_transactions t on t.id = r.transaction_id and t.household_id = r.household_id
      where r.household_id = ${householdId} and r.resolved_at is null and t.visibility = 'household'
        ${mine} and ${filter}
      order by r.created_at desc, r.id desc limit 50`
    );
  }

  private dto(row: RequestRow, meId: string): ReviewRequestSummary {
    return {
      id: row.id,
      householdId: row.household_id,
      transactionId: row.transaction_id,
      requesterMemberId: row.requester_member_id,
      requesterName: row.requester_name,
      assigneeMemberId: row.assignee_member_id,
      assigneeName: row.assignee_name,
      direction: row.assignee_member_id === meId ? "received" : "sent",
      merchant: merchantOf(row),
      amount: Number(row.amount),
      currency: row.currency ?? "KRW",
      occurredAt: iso(row.occurred_at),
      createdAt: iso(row.created_at),
    };
  }

  private async notify(
    job: NotificationDispatchJob,
    key: string
  ): Promise<void> {
    try {
      await this.notifications.add("dispatch", job, {
        jobId: `notif_review_${key}`,
        removeOnComplete: true,
      });
    } catch {
      // 금액·가맹점·이름은 남기지 않는다.
      this.logger.warn(`review notification enqueue failed (key=${key})`);
    }
  }

  async list(
    userId: string,
    householdId: unknown,
    transactionId?: unknown
  ): Promise<ReviewRequestListResponse> {
    const household = this.parse(uuid, householdId);
    const transaction =
      transactionId == null || transactionId === ""
        ? null
        : this.parse(uuid, transactionId);
    const me = await this.me(this.db, household, userId);
    const rows = await this.open(
      this.db,
      household,
      transaction ? sql`r.transaction_id = ${transaction}` : sql`true`,
      me.id
    );
    return { items: rows.map((row) => this.dto(row, me.id)) };
  }

  async create(userId: string, input: unknown): Promise<ReviewRequestSummary> {
    const value = this.parse(reviewRequestCreateSchema, input);
    const outcome = await this.db.transaction(async (tx) => {
      const me = await this.me(tx, value.householdId, userId);
      if (me.id === value.assigneeMemberId)
        throw new BadRequestException("본인에게는 물어볼 수 없어요.");
      const [assignee] = await this.rows<MemberRow>(
        tx,
        sql`select m.id, m.user_id, u.name from household_members m
        join users u on u.id = m.user_id
        where m.id = ${value.assigneeMemberId} and m.household_id = ${value.householdId} and m.status = 'active' and u.deleted_at is null`
      );
      if (!assignee)
        throw new NotFoundException("물어볼 가족을 찾지 못했어요.");
      const [transaction] = await this.rows<TransactionRow>(
        tx,
        sql`select id, visibility, merchant_normalized, merchant_raw, amount, currency
        from card_transactions where id = ${value.transactionId} and household_id = ${value.householdId}`
      );
      if (!transaction) throw new NotFoundException("결제를 찾지 못했어요.");
      if (transaction.visibility !== "household")
        throw new BadRequestException("가족 공개 결제만 물어볼 수 있어요.");
      const inserted = await this.rows<{ id: string }>(
        tx,
        sql`insert into transaction_review_requests
          (household_id, transaction_id, requester_member_id, assignee_member_id)
        values (${value.householdId}, ${value.transactionId}, ${me.id}, ${assignee.id})
        on conflict (transaction_id, assignee_member_id) where resolved_at is null do nothing returning id`
      );
      // 이미 열린 요청이 있으면(다시 누름·다른 가족이 먼저 물음) 그 요청을 그대로 돌려준다.
      const [row] = await this.open(
        tx,
        value.householdId,
        sql`r.transaction_id = ${value.transactionId} and r.assignee_member_id = ${assignee.id}`,
        null
      );
      if (!row) throw new NotFoundException("물어본 결제를 찾지 못했어요.");
      return { row, me, assignee, transaction, created: inserted.length > 0 };
    });
    if (outcome.created) {
      await this.notify(
        {
          kind: "review",
          phase: "requested",
          householdId: value.householdId,
          userId: outcome.assignee.user_id,
          requestId: outcome.row.id,
          transactionId: value.transactionId,
          actorName: outcome.me.name,
          merchant: merchantOf(outcome.transaction),
          amount: Number(outcome.transaction.amount),
          currency: outcome.transaction.currency ?? "KRW",
        },
        `${outcome.row.id}_requested`
      );
    }
    return this.dto(outcome.row, outcome.me.id);
  }

  /** 받은 사람은 '확인했어요'(물어본 사람에게 알림), 물어본 사람은 취소(알림 없음). 이미 닫혔으면 그대로 성공. */
  async resolve(
    userId: string,
    id: unknown,
    input: unknown
  ): Promise<ReviewRequestResolveResponse> {
    const requestId = this.parse(uuid, id);
    const value = this.parse(reviewRequestResolveSchema, input);
    const outcome = await this.db.transaction(async (tx) => {
      const me = await this.me(tx, value.householdId, userId);
      const [row] = await this.rows<OpenRow>(
        tx,
        sql`select r.id, r.requester_member_id, r.assignee_member_id, r.transaction_id, r.resolved_at,
          rm.user_id as requester_user_id
        from transaction_review_requests r join household_members rm on rm.id = r.requester_member_id
        where r.id = ${requestId} and r.household_id = ${value.householdId} for update of r`
      );
      if (
        !row ||
        (row.assignee_member_id !== me.id && row.requester_member_id !== me.id)
      ) {
        throw new NotFoundException("물어본 결제를 찾지 못했어요.");
      }
      if (row.resolved_at) return null;
      await tx.execute(sql`update transaction_review_requests set resolved_at = now(), resolved_by_member_id = ${me.id}
        where id = ${requestId} and resolved_at is null`);
      if (row.assignee_member_id !== me.id) return null;
      const [transaction] = await this.rows<TransactionRow>(
        tx,
        sql`select id, visibility, merchant_normalized, merchant_raw, amount, currency
        from card_transactions where id = ${row.transaction_id}`
      );
      return { row, me, transaction };
    });
    if (outcome?.transaction) {
      await this.notify(
        {
          kind: "review",
          phase: "resolved",
          householdId: value.householdId,
          userId: outcome.row.requester_user_id,
          requestId,
          transactionId: outcome.row.transaction_id,
          actorName: outcome.me.name,
          merchant: merchantOf(outcome.transaction),
          amount: Number(outcome.transaction.amount),
          currency: outcome.transaction.currency ?? "KRW",
        },
        `${requestId}_resolved`
      );
    }
    return { resolved: true };
  }
}
