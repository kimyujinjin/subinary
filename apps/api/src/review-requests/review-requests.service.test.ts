import { describe, expect, it, vi } from "vitest";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@family/database";
import { reviewRequestSummarySchema } from "@family/contracts";

import { ReviewRequestsService } from "./review-requests.service";

const id = (n: number) =>
  `${String(n).padStart(8, "0")}-2222-4222-8222-222222222222`;
const home = id(1),
  me = id(2),
  partner = id(3),
  meUser = id(4),
  partnerUser = id(5),
  txnId = id(6),
  requestId = id(7),
  stranger = id(8);
const created = new Date("2026-11-04T10:00:00.000Z");
const dialect = new PgDialect();

interface Answers {
  me?: unknown[];
  assignee?: unknown[];
  transaction?: unknown[];
  insert?: unknown[];
  open?: unknown[];
  lock?: unknown[];
}

function openRow(over: Record<string, unknown> = {}) {
  return {
    id: requestId,
    household_id: home,
    transaction_id: txnId,
    requester_member_id: me,
    requester_name: "이수빈",
    assignee_member_id: partner,
    assignee_name: "배우자",
    merchant_normalized: "스타벅스",
    merchant_raw: "STARBUCKS",
    amount: "5600",
    currency: "KRW",
    occurred_at: created,
    created_at: created,
    ...over,
  };
}

/** DB 경계만 대체한다. 실제 서비스 분기와 Drizzle SQL 변환을 그대로 거친다. */
function harness(answers: Answers, queue = { add: vi.fn(async () => ({})) }) {
  const statements: string[] = [];
  const execute = vi.fn(async (query: SQL) => {
    const rendered = dialect.sqlToQuery(query);
    if (rendered.params.some((value) => value instanceof Date))
      throw new Error("raw_timestamp_requires_iso_string");
    const text = rendered.sql;
    statements.push(text);
    if (
      /from household_members m\s+join users u on u.id = m.user_id\s+where m.household_id/.test(
        text
      )
    )
      return answers.me ?? [];
    if (/where m.id = \$1 and m.household_id/.test(text))
      return answers.assignee ?? [];
    if (/^select id, visibility/.test(text)) return answers.transaction ?? [];
    if (/^insert into transaction_review_requests/.test(text))
      return answers.insert ?? [];
    if (/for update of r/.test(text)) return answers.lock ?? [];
    if (/^update transaction_review_requests/.test(text)) return [];
    if (/from transaction_review_requests r/.test(text))
      return answers.open ?? [];
    throw new Error(`unexpected sql: ${text.slice(0, 60)}`);
  });
  const db = {
    execute,
    transaction: async (
      work: (tx: { execute: typeof execute }) => Promise<unknown>
    ) => work({ execute }),
  };
  const service = new ReviewRequestsService(
    db as unknown as Db,
    queue as unknown as Queue
  );
  return { service, execute, queue, statements };
}

const meRow = { id: me, user_id: meUser, name: "이수빈" };
const partnerRow = { id: partner, user_id: partnerUser, name: "배우자" };
const visible = {
  id: txnId,
  visibility: "household",
  merchant_normalized: "스타벅스",
  merchant_raw: "STARBUCKS",
  amount: "5600",
  currency: "KRW",
};
const input = {
  householdId: home,
  transactionId: txnId,
  assigneeMemberId: partner,
};

describe("가족에게 결제 물어보기", () => {
  it("가족 공개 결제를 물어보면 받는 사람에게 한 번 알리고 보낸 요청으로 돌려준다", async () => {
    const { service, queue } = harness({
      me: [meRow],
      assignee: [partnerRow],
      transaction: [visible],
      insert: [{ id: requestId }],
      open: [openRow()],
    });
    const result = await service.create(meUser, input);
    expect(reviewRequestSummarySchema.parse(result)).toMatchObject({
      direction: "sent",
      merchant: "스타벅스",
      amount: 5600,
      assigneeName: "배우자",
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      "dispatch",
      expect.objectContaining({
        kind: "review",
        phase: "requested",
        userId: partnerUser,
        actorName: "이수빈",
        transactionId: txnId,
        merchant: "스타벅스",
        amount: 5600,
      }),
      { jobId: `notif_review_${requestId}_requested`, removeOnComplete: true }
    );
  });

  it("이미 열린 요청이면 새로 만들지 않고 다시 알리지 않는다", async () => {
    const { service, queue } = harness({
      me: [meRow],
      assignee: [partnerRow],
      transaction: [visible],
      insert: [],
      open: [openRow()],
    });
    expect((await service.create(meUser, input)).id).toBe(requestId);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("나만 보기·요약 공개 결제와 본인 지정, 비구성원은 거절한다", async () => {
    for (const visibility of ["private", "summary_only"]) {
      const { service, statements } = harness({
        me: [meRow],
        assignee: [partnerRow],
        transaction: [{ ...visible, visibility }],
      });
      await expect(service.create(meUser, input)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(statements.some((text) => text.startsWith("insert"))).toBe(false);
    }
    await expect(
      harness({ me: [meRow] }).service.create(meUser, {
        ...input,
        assigneeMemberId: me,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      harness({ me: [] }).service.create(meUser, input)
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      harness({ me: [meRow], assignee: [] }).service.create(meUser, input)
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      harness({}).service.create(meUser, { ...input, extra: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("알림을 넣지 못해도 요청은 남는다", async () => {
    const failing = {
      add: vi.fn(async () => {
        throw new Error("redis down");
      }),
    };
    const { service } = harness(
      {
        me: [meRow],
        assignee: [partnerRow],
        transaction: [visible],
        insert: [{ id: requestId }],
        open: [openRow()],
      },
      failing
    );
    await expect(service.create(meUser, input)).resolves.toMatchObject({
      id: requestId,
    });
  });

  it("받은 사람이 확인하면 닫고 물어본 사람에게 알린다", async () => {
    const lock = [
      {
        id: requestId,
        requester_member_id: me,
        assignee_member_id: partner,
        transaction_id: txnId,
        resolved_at: null,
        requester_user_id: meUser,
      },
    ];
    const { service, queue, statements } = harness({
      me: [partnerRow],
      lock,
      transaction: [visible],
    });
    await expect(
      service.resolve(partnerUser, requestId, { householdId: home })
    ).resolves.toEqual({ resolved: true });
    expect(
      statements.some((text) =>
        text.startsWith("update transaction_review_requests")
      )
    ).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      "dispatch",
      expect.objectContaining({
        kind: "review",
        phase: "resolved",
        userId: meUser,
        actorName: "배우자",
      }),
      { jobId: `notif_review_${requestId}_resolved`, removeOnComplete: true }
    );
  });

  it("물어본 사람이 취소하면 알리지 않고, 이미 닫힌 요청은 그대로 성공한다", async () => {
    const lock = (resolved: Date | null) => [
      {
        id: requestId,
        requester_member_id: me,
        assignee_member_id: partner,
        transaction_id: txnId,
        resolved_at: resolved,
        requester_user_id: meUser,
      },
    ];
    const cancel = harness({ me: [meRow], lock: lock(null) });
    await expect(
      cancel.service.resolve(meUser, requestId, { householdId: home })
    ).resolves.toEqual({ resolved: true });
    expect(cancel.queue.add).not.toHaveBeenCalled();
    const done = harness({ me: [partnerRow], lock: lock(created) });
    await expect(
      done.service.resolve(partnerUser, requestId, { householdId: home })
    ).resolves.toEqual({ resolved: true });
    expect(done.statements.some((text) => text.startsWith("update"))).toBe(
      false
    );
    expect(done.queue.add).not.toHaveBeenCalled();
  });

  it("요청과 관계없는 가족은 닫을 수 없다", async () => {
    const lock = [
      {
        id: requestId,
        requester_member_id: me,
        assignee_member_id: partner,
        transaction_id: txnId,
        resolved_at: null,
        requester_user_id: meUser,
      },
    ];
    const { service } = harness({
      me: [{ id: stranger, user_id: id(9), name: "다른 가족" }],
      lock,
    });
    await expect(
      service.resolve(id(9), requestId, { householdId: home })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("목록은 나 기준 방향을 붙이고, 가족 공개 결제의 열린 요청만 읽는다", async () => {
    const { service, statements } = harness({
      me: [partnerRow],
      open: [
        openRow(),
        openRow({
          id: id(10),
          requester_member_id: partner,
          assignee_member_id: me,
        }),
      ],
    });
    const result = await service.list(partnerUser, home, txnId);
    expect(result.items.map((item) => item.direction)).toEqual([
      "received",
      "sent",
    ]);
    const query =
      statements.find((text) =>
        text.includes("from transaction_review_requests r")
      ) ?? "";
    expect(query).toContain("t.visibility = 'household'");
    expect(query).toContain("r.resolved_at is null");
    expect(query).toMatch(
      /r.assignee_member_id = \$\d+ or r.requester_member_id = \$\d+/
    );
    await expect(
      service.list(partnerUser, "not-a-uuid")
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
