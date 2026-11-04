import { describe, expect, it } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Db } from "@family/database";
import {
  NOTIFICATION_CHANNELS,
  notificationDeepLink,
  type NotificationDispatchJob,
} from "@family/shared";

import type { FcmService } from "../notifications/fcm.service";
import {
  composeReview,
  NotificationDispatchProcessor,
} from "./notification-dispatch.processor";

const job = (
  phase: "requested" | "resolved"
): Extract<NotificationDispatchJob, { kind: "review" }> => ({
  kind: "review",
  householdId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  requestId: "00000000-0000-4000-8000-000000000003",
  transactionId: "00000000-0000-4000-8000-000000000004",
  phase,
  actorName: "배우자",
  merchant: "스타벅스",
  amount: 5600,
  currency: "KRW",
});

describe("가족 확인 요청 알림", () => {
  it("받는 사람 한 명에게 확인 요청 채널로 결제 상세를 연다", async () => {
    const processor = new NotificationDispatchProcessor(
      {} as Db,
      { enabled: false } as unknown as FcmService,
      { get: () => ({ nodeEnv: "test" }) } as unknown as ConfigService
    );
    const build = (
      processor as unknown as {
        buildContext: (data: NotificationDispatchJob) => Promise<{
          candidateUserIds: string[];
          channelId: string;
          deepLink: string;
          amount?: number;
          composeFor: (userId: string) => { title: string; body: string };
        } | null>;
      }
    ).buildContext.bind(processor);
    const ctx = await build(job("requested"));
    expect(ctx).toMatchObject({
      candidateUserIds: ["00000000-0000-4000-8000-000000000002"],
      channelId: NOTIFICATION_CHANNELS.review,
      deepLink: "/transactions?txn=00000000-0000-4000-8000-000000000004",
    });
    // 결제 금액 필터(minAmount)는 사람이 물어본 알림에 적용하지 않는다.
    expect(ctx?.amount).toBeUndefined();
    expect(ctx?.composeFor("x")).toEqual({
      title: "가족이 결제를 물어봤어요",
      body: "배우자님이 물어봤어요 · 스타벅스 5,600원",
    });
    expect(notificationDeepLink(job("resolved"))).toBe(
      "/transactions?txn=00000000-0000-4000-8000-000000000004"
    );
  });

  it("확인 문구는 확인한 사람 이름을 앞에 두고, 가맹점을 모르면 지어내지 않는다", () => {
    expect(
      composeReview("resolved", "이수빈", "스타벅스", 5600, "KRW")
    ).toEqual({
      title: "물어본 결제를 확인했어요",
      body: "이수빈님이 확인했어요 · 스타벅스 5,600원",
    });
    expect(composeReview("requested", "이수빈", null, 12000, "KRW").body).toBe(
      "이수빈님이 물어봤어요 · 결제 12,000원"
    );
  });
});
