/**
 * 종류별 끄기(0074 `disabled_kinds`) — 끈 종류는 **푸시만** 건너뛰고 알림함에는 남긴다.
 *
 * `process()`를 처음부터 끝까지 돌린다(DB·FCM 경계만 가짜). 지켜야 하는 것:
 *  - 끈 사람에게는 FCM을 부르지 않는다.
 *  - 그래도 알림함 이력은 수신 대상 전원에게 저장된다(설정 화면 문구가 그렇게 약속한다).
 *  - 다른 종류와 다른 가족 구성원의 발송은 그대로다.
 */
import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { getTableName, type Table } from "drizzle-orm";
import type { Db } from "@family/database";
import type { NotificationDispatchJob } from "@family/shared";
import type { Job } from "bullmq";

import type { FcmMessage, FcmService } from "../notifications/fcm.service";
import { NotificationDispatchProcessor } from "./notification-dispatch.processor";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const ME = "00000000-0000-4000-8000-000000000002";
const PARTNER = "00000000-0000-4000-8000-000000000003";

interface Pref {
  userId: string;
  disabledKinds: string[];
}

function harness(prefs: Pref[], members: string[] = [ME, PARTNER]) {
  const history: Array<Record<string, unknown>> = [];
  const rowsFor = (table: string): unknown[] => {
    if (table === "notification_preferences") {
      return prefs.map((pref) => ({
        pushEnabled: true,
        minAmount: null,
        quietStartMinute: null,
        quietEndMinute: null,
        notifyOwnCollected: false,
        ...pref,
      }));
    }
    if (table === "push_subscriptions") {
      return members.map((userId) => ({
        id: `sub-${userId}`,
        userId,
        token: `token-${userId}`,
      }));
    }
    if (table === "household_members") {
      return members.map((userId) => ({ userId }));
    }
    return [];
  };
  const db = {
    select: () => ({
      from: (table: Table) => ({
        where: async () => rowsFor(getTableName(table)),
      }),
    }),
    insert: (table: Table) => ({
      values: (rows: Array<Record<string, unknown>>) => ({
        onConflictDoNothing: async () => {
          if (getTableName(table) === "notifications") history.push(...rows);
        },
      }),
    }),
  } as unknown as Db;
  const send = vi.fn(async (_message: FcmMessage) => ({ ok: true as const }));
  const processor = new NotificationDispatchProcessor(
    db,
    { enabled: true, send } as unknown as FcmService,
    { get: () => ({ nodeEnv: "test" }) } as unknown as ConfigService
  );
  const run = (data: NotificationDispatchJob, id: string) =>
    processor.process({
      id,
      data,
      updateData: vi.fn(async () => undefined),
    } as unknown as Job<NotificationDispatchJob>);
  return { run, send, history };
}

const reminder: NotificationDispatchJob = {
  kind: "reminder",
  householdId: HOUSEHOLD,
  userId: ME,
  count: 2,
};

const budget: NotificationDispatchJob = {
  kind: "budget",
  householdId: HOUSEHOLD,
  budgetId: "00000000-0000-4000-8000-000000000009",
  budgetName: "식비",
  threshold: 80,
};

describe("종류별 끄기 — 푸시만 건너뛰고 알림함에는 남긴다", () => {
  it("이 종류를 끈 사람에게는 FCM을 부르지 않지만 알림함 이력은 저장한다", async () => {
    const { run, send, history } = harness([
      { userId: ME, disabledKinds: ["reminder"] },
    ]);
    const result = await run(reminder, "notif_reminder_1");
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "reminder",
      outcome: "skipped",
      sentCount: 0,
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      userId: ME,
      kind: "reminder",
      sourceKey: "notif_reminder_1",
      title: "확인할 거래",
    });
  });

  it("다른 종류를 끈 것은 이 알림에 영향을 주지 않는다", async () => {
    const { run, send } = harness([
      { userId: ME, disabledKinds: ["budget", "summary"] },
    ]);
    const result = await run(reminder, "notif_reminder_2");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ token: `token-${ME}` });
    expect(result).toMatchObject({ outcome: "sent", sentCount: 1 });
  });

  it("가족 알림은 끈 사람만 빠지고, 알림함에는 둘 다 남는다", async () => {
    const { run, send, history } = harness([
      { userId: ME, disabledKinds: ["budget"] },
      { userId: PARTNER, disabledKinds: [] },
    ]);
    const result = await run(budget, "notif_budget_1_80");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      token: `token-${PARTNER}`,
    });
    expect(result).toMatchObject({ outcome: "sent", recipientCount: 1 });
    expect(history.map((row) => row.userId).sort()).toEqual(
      [ME, PARTNER].sort()
    );
  });

  it("설정 행이 없는 사람은 기본값(모든 종류 받음)으로 받는다", async () => {
    const { run, send } = harness([]);
    await run(budget, "notif_budget_2_100");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
