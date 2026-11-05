import { describe, expect, it } from "vitest";

import {
  initialRestoreMonth,
  leaveReviewPeriod,
  pickReviewMonth,
  toggleReviewPeriod,
  type ReviewPeriodState,
} from "./review-period";

const november: ReviewPeriodState = {
  reviewOnly: false,
  month: "2026-11",
  restoreMonth: null,
};

describe("'확인할 거래' 칩과 기간", () => {
  it("켜면 전체 기간으로 바꾸고, 끄면 켜기 전 달로 돌아간다", () => {
    const on = toggleReviewPeriod(november);
    expect(on).toEqual({
      reviewOnly: true,
      month: "",
      restoreMonth: "2026-11",
    });
    expect(toggleReviewPeriod(on)).toEqual(november);
  });

  it("지난달을 보다 켜고 끄면 지난달로 돌아간다", () => {
    const october = { ...november, month: "2026-10" };
    expect(toggleReviewPeriod(toggleReviewPeriod(october))).toEqual(october);
  });

  it("전체 기간에서 켜고 끄면 전체 기간 그대로다", () => {
    const all = { ...november, month: "" };
    expect(toggleReviewPeriod(toggleReviewPeriod(all)).month).toBe("");
  });

  it("켜 둔 동안 달을 직접 고르면 끌 때 그 달을 지킨다", () => {
    const picked = pickReviewMonth(toggleReviewPeriod(november), "2026-09");
    expect(picked).toEqual({
      reviewOnly: true,
      month: "2026-09",
      restoreMonth: null,
    });
    expect(leaveReviewPeriod(picked)).toEqual({
      reviewOnly: false,
      month: "2026-09",
      restoreMonth: null,
    });
  });

  it("칩이 꺼져 있을 때 달을 고르거나 끄기를 불러도 다른 값은 그대로다", () => {
    expect(pickReviewMonth(november, "2026-08")).toEqual({
      ...november,
      month: "2026-08",
    });
    expect(leaveReviewPeriod(november)).toBe(november);
  });

  it("기간 없이 확인할 거래 링크로 들어왔으면 끌 때 이번 달로 돌아간다", () => {
    const params = new URLSearchParams("review=1");
    expect(initialRestoreMonth(params, "2026-11")).toBe("2026-11");
    const state: ReviewPeriodState = {
      reviewOnly: true,
      month: "",
      restoreMonth: initialRestoreMonth(params, "2026-11"),
    };
    expect(leaveReviewPeriod(state).month).toBe("2026-11");
  });

  it("링크가 기간을 직접 정했으면 그 기간을 지킨다", () => {
    expect(
      initialRestoreMonth(
        new URLSearchParams("review=1&month=2026-10"),
        "2026-11"
      )
    ).toBeNull();
    expect(
      initialRestoreMonth(new URLSearchParams("review=1&month=all"), "2026-11")
    ).toBeNull();
    expect(initialRestoreMonth(new URLSearchParams(""), "2026-11")).toBeNull();
  });
});
