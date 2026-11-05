import { describe, expect, it } from "vitest";

import {
  countsInDayTotal,
  dayTotalNote,
  transactionChips,
} from "./list-status";

const approval = {
  transactionType: "approval" as const,
  status: "approved" as const,
  excludedAt: null,
  currency: "KRW",
};

const labels = (input: Parameters<typeof transactionChips>[0]) =>
  transactionChips(input).map((chip) => chip.label);

describe("transactionChips — 목록과 상세가 같은 이름을 쓴다", () => {
  it("승인은 아무것도 붙이지 않는다", () => {
    expect(transactionChips(approval)).toEqual([]);
  });

  it("취소된 원래 결제는 '취소됨'·'부분 취소'다", () => {
    expect(labels({ ...approval, status: "cancelled" })).toEqual(["취소됨"]);
    expect(labels({ ...approval, status: "partially_cancelled" })).toEqual([
      "부분 취소",
    ]);
  });

  it("취소로 생긴 기록은 '환불'이고 맨 글자 '취소'를 쓰지 않는다", () => {
    const refund = { ...approval, transactionType: "cancellation" as const };
    expect(labels(refund)).toEqual(["환불"]);
    expect(labels({ ...refund, status: "pending_review" })).toEqual([
      "환불",
      "확인 필요",
    ]);
    for (const status of [
      "approved",
      "pending_review",
      "duplicate_suspected",
    ] as const) {
      expect(labels({ ...refund, status })).not.toContain("취소");
    }
  });

  it("확인 상태는 띄어 쓴다", () => {
    expect(labels({ ...approval, status: "pending_review" })).toEqual([
      "확인 필요",
    ]);
    expect(labels({ ...approval, status: "duplicate_suspected" })).toEqual([
      "중복 의심",
    ]);
  });

  it("합계에서 뺀 거래는 '합계 제외'만 말한다(이미 답한 확인 상태는 다시 묻지 않는다)", () => {
    expect(
      labels({
        ...approval,
        status: "duplicate_suspected",
        excludedAt: "2026-11-05T00:00:00Z",
      })
    ).toEqual(["합계 제외"]);
  });

  it("옛 이름(제외됨·합계에서 제외됨·취소 거래)을 쓰지 않는다", () => {
    const all = [
      approval,
      { ...approval, status: "cancelled" as const },
      { ...approval, excludedAt: "2026-11-05T00:00:00Z" },
      { ...approval, transactionType: "cancellation" as const },
    ].flatMap(labels);
    for (const old of [
      "제외됨",
      "합계에서 제외됨",
      "취소 거래",
      "확인필요",
      "중복의심",
    ]) {
      expect(all).not.toContain(old);
    }
  });
});

describe("날짜 소계", () => {
  it("원화 승인만 더한다", () => {
    expect(countsInDayTotal(approval)).toBe(true);
    expect(
      countsInDayTotal({ ...approval, transactionType: "cancellation" })
    ).toBe(false);
    expect(countsInDayTotal({ ...approval, currency: "USD" })).toBe(false);
    expect(
      countsInDayTotal({ ...approval, excludedAt: "2026-11-05T00:00:00Z" })
    ).toBe(false);
  });

  it("빠지는 줄에는 보이는 글자로 '소계 제외'를 붙인다 — 합계 제외 거래는 칩이 이미 말한다", () => {
    expect(dayTotalNote(approval)).toBeNull();
    expect(
      dayTotalNote({
        ...approval,
        transactionType: "cancellation",
        parentTransactionId: null,
      })
    ).toBe("소계 제외");
    expect(dayTotalNote({ ...approval, currency: "USD" })).toBe("소계 제외");
    expect(
      dayTotalNote({ ...approval, excludedAt: "2026-11-05T00:00:00Z" })
    ).toBeNull();
  });

  it("원래 결제에 연결된 환불은 그 결제 금액에서 이미 빠졌다고 말한다", () => {
    expect(
      dayTotalNote({
        ...approval,
        transactionType: "cancellation",
        parentTransactionId: "approval-1",
      })
    ).toBe("원래 결제에 반영");
  });
});
