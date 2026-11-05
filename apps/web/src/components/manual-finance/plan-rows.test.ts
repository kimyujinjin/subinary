import { describe, expect, it } from "vitest";

import { planRowSubtitle } from "./plan-rows";

describe("planRowSubtitle", () => {
  it("입주연도와 계약 단계만 쓴다 — 공개 범위·출처는 줄마다 반복하지 않는다(§8)", () => {
    const text = planRowSubtitle({
      occupancyYear: 2028,
      contractStage: "중도금 내는 중",
    });
    expect(text).toBe("2028년 입주 · 중도금 내는 중");
    expect(text).not.toContain("가족 공개");
    expect(text).not.toContain("직접 입력");
  });

  it("모르는 입주연도는 0이나 빈칸이 아니라 '미입력'", () => {
    expect(planRowSubtitle({ occupancyYear: null, contractStage: null })).toBe(
      "입주연도 미입력"
    );
  });
});
