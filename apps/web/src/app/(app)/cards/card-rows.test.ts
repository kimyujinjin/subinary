import type { MemberSummary } from "@family/contracts";
import { describe, expect, it } from "vitest";

import {
  billingDayLabel,
  cardMonthSpend,
  cardRowChips,
  cardRowSubtitle,
  cardUpdateBody,
  lastFour,
  ownerOptionsFor,
  spendByCardId,
} from "./card-rows";

function member(changes: Partial<MemberSummary>): MemberSummary {
  return {
    memberId: "m-1",
    userId: "u-1",
    name: "수빈",
    email: "subin@example.com",
    role: "owner",
    status: "active",
    color: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    ...changes,
  };
}

const MEMBERS = [
  member({}),
  member({
    memberId: "m-2",
    userId: "u-2",
    name: "민수",
    role: "member",
    status: "removed",
  }),
  member({ memberId: "m-3", userId: "u-3", name: "지은", role: "admin" }),
];

describe("ownerOptionsFor", () => {
  it("offers only active members, marking me", () => {
    expect(ownerOptionsFor(MEMBERS, "u-1")).toEqual([
      { memberId: "m-1", name: "수빈 (나)" },
      { memberId: "m-3", name: "지은" },
    ]);
  });

  it("keeps a departed current owner visible but not selectable", () => {
    expect(ownerOptionsFor(MEMBERS, "u-1", "m-2")).toEqual([
      { memberId: "m-1", name: "수빈 (나)" },
      { memberId: "m-3", name: "지은" },
      { memberId: "m-2", name: "민수 (나간 구성원)", disabled: true },
    ]);
  });

  it("adds nothing when the current owner is active or members are not loaded", () => {
    expect(ownerOptionsFor(MEMBERS, "u-1", "m-3")).toHaveLength(2);
    expect(ownerOptionsFor([], "u-1", "m-2")).toEqual([]);
  });
});

describe("cardUpdateBody", () => {
  const draft = {
    alias: "  생활비카드 ",
    visibility: "household" as const,
    ownerMemberId: "m-2",
    isShared: false,
    billingDay: "15",
  };

  it("does not resend an unchanged owner — a departed owner's card stays editable", () => {
    const body = cardUpdateBody({ ownerMemberId: "m-2" }, draft);
    expect(body).toEqual({
      alias: "생활비카드",
      visibility: "household",
      isShared: false,
      billingDay: 15,
    });
    expect("ownerMemberId" in body).toBe(false);
  });

  it("sends the owner only when it changed", () => {
    expect(
      cardUpdateBody(
        { ownerMemberId: "m-2" },
        { ...draft, ownerMemberId: "m-3" }
      )
    ).toMatchObject({ ownerMemberId: "m-3" });
  });

  it("clears the billing day with null and never sends an empty owner", () => {
    const body = cardUpdateBody(
      { ownerMemberId: "m-2" },
      { ...draft, ownerMemberId: "", billingDay: "" }
    );
    expect(body.billingDay).toBeNull();
    expect("ownerMemberId" in body).toBe(false);
  });
});

describe("row text", () => {
  const names = new Map([
    ["m-1", "수빈"],
    ["m-2", "민수"],
  ]);

  it("puts owner, issuer and last four on one line", () => {
    expect(
      cardRowSubtitle(
        { ownerMemberId: "m-1", issuer: "신한", maskedNumber: "****1234" },
        names
      )
    ).toBe("수빈 · 신한 •••• 1234");
    expect(
      cardRowSubtitle(
        { ownerMemberId: "m-2", issuer: "KB국민", maskedNumber: null },
        names
      )
    ).toBe("민수 · KB국민 · 뒤 4자리 미등록");
  });

  it("reads only the last four digits", () => {
    expect(lastFour("1234-5678")).toBe("5678");
    expect(lastFour(null)).toBe("");
  });

  it("shows billing day only when set", () => {
    expect(billingDayLabel({ billingDay: 25 })).toBe("매월 25일 결제");
    expect(billingDayLabel({ billingDay: null })).toBeNull();
  });

  it("draws no chip for the default state and keeps privacy visible", () => {
    expect(
      cardRowChips({
        status: "active",
        isShared: false,
        visibility: "household",
      })
    ).toEqual([]);
    expect(
      cardRowChips({
        status: "inactive",
        isShared: false,
        visibility: "private",
      }).map((c) => c.label)
    ).toEqual(["비활성", "나만 보기"]);
    expect(
      cardRowChips({
        status: "active",
        isShared: true,
        visibility: "summary_only",
      }).map((c) => c.label)
    ).toEqual(["공용", "요약만 공유"]);
  });
});

describe("cardMonthSpend", () => {
  const spend = spendByCardId([
    { cardId: "c-1", net: 120000 },
    { cardId: null, net: 5000 },
  ]);
  const card = (
    changes: Partial<{
      id: string;
      ownerMemberId: string;
      visibility: "household" | "summary_only" | "private";
    }>
  ) => ({
    id: "c-1",
    ownerMemberId: "m-1",
    visibility: "household" as const,
    ...changes,
  });

  it("ignores the unlinked bucket", () => {
    expect([...spend.keys()]).toEqual(["c-1"]);
  });

  it("shows the aggregated amount", () => {
    expect(cardMonthSpend(card({}), spend, "m-1")).toBe(120000);
  });

  it("writes 0원 only for cards whose spend I could see", () => {
    expect(cardMonthSpend(card({ id: "c-9" }), spend, "m-1")).toBe(0);
    expect(
      cardMonthSpend(card({ id: "c-9", visibility: "private" }), spend, "m-1")
    ).toBe(0);
    expect(
      cardMonthSpend(
        card({ id: "c-9", visibility: "private", ownerMemberId: "m-2" }),
        spend,
        "m-1"
      )
    ).toBeNull();
  });

  it("stays empty until the aggregate arrives", () => {
    expect(cardMonthSpend(card({}), null, "m-1")).toBeNull();
  });
});
