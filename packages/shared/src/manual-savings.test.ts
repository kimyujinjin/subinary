import { describe, expect, it } from "vitest";

import { manualSavingsView, projectManualSavings } from "./manual-savings";

const plan = (
  over: Partial<{
    monthlyAmount: string;
    day: number;
    endDate: string | null;
  }> = {}
) => ({
  monthlyAmount: "500000",
  day: 15,
  endDate: null,
  ...over,
});

describe("적금 자동 납입 — 현재 적립액", () => {
  it("기준일 다음 날부터 매월 납입일마다 더하고, 마지막 납입일을 기준일로 쓴다", () => {
    expect(
      projectManualSavings(
        { amount: "1000000", asOfDate: "2026-01-01" },
        plan(),
        "2026-11-04"
      )
    ).toEqual({
      amount: "6000000",
      asOfDate: "2026-10-15",
      contributions: 10,
    });
  });

  it("기준일 당일 납입은 기준 금액에 들어 있다고 보고, 오늘이 납입일이면 오늘 것까지 더한다", () => {
    expect(
      projectManualSavings(
        { amount: "0", asOfDate: "2026-10-15" },
        plan(),
        "2026-11-15"
      )
    ).toEqual({
      amount: "500000",
      asOfDate: "2026-11-15",
      contributions: 1,
    });
    expect(
      projectManualSavings(
        { amount: "0", asOfDate: "2026-10-15" },
        plan(),
        "2026-11-14"
      )
    ).toEqual({
      amount: "0",
      asOfDate: "2026-10-15",
      contributions: 0,
    });
  });

  it("그 달에 없는 납입일은 말일로 본다(윤년 포함)", () => {
    const base = { amount: "0", asOfDate: "2028-01-31" };
    expect(projectManualSavings(base, plan({ day: 31 }), "2028-02-29")).toEqual(
      {
        amount: "500000",
        asOfDate: "2028-02-29",
        contributions: 1,
      }
    );
    expect(
      projectManualSavings(
        { amount: "0", asOfDate: "2027-01-31" },
        plan({ day: 31 }),
        "2027-03-01"
      ).asOfDate
    ).toBe("2027-02-28");
  });

  it("만기일까지만 더하고, 만기일이 기준일보다 앞이면 더하지 않는다", () => {
    expect(
      projectManualSavings(
        { amount: "0", asOfDate: "2026-01-01" },
        plan({ endDate: "2026-03-20" }),
        "2026-11-04"
      )
    ).toEqual({
      amount: "1500000",
      asOfDate: "2026-03-15",
      contributions: 3,
    });
    expect(
      projectManualSavings(
        { amount: "700", asOfDate: "2026-05-01" },
        plan({ endDate: "2026-04-30" }),
        "2026-11-04"
      )
    ).toEqual({
      amount: "700",
      asOfDate: "2026-05-01",
      contributions: 0,
    });
  });

  it("20자리를 넘기면 거기서 멈춰 응답 계약을 깨지 않는다", () => {
    const result = projectManualSavings(
      { amount: "99999999999999999000", asOfDate: "2026-01-01" },
      plan({ monthlyAmount: "400" }),
      "2026-12-31"
    );
    expect(result.amount).toBe("99999999999999999800");
    expect(result.contributions).toBe(2);
  });

  it("잘못된 계획은 조용히 0으로 만들지 않고 거부한다", () => {
    expect(() =>
      projectManualSavings(
        { amount: "0", asOfDate: "2026-01-01" },
        plan({ monthlyAmount: "0" }),
        "2026-11-04"
      )
    ).toThrow(RangeError);
    expect(() =>
      projectManualSavings(
        { amount: "0", asOfDate: "2026-02-30" },
        plan(),
        "2026-11-04"
      )
    ).toThrow(RangeError);
    expect(() =>
      projectManualSavings(
        { amount: "0", asOfDate: "2026-01-01" },
        plan({ day: 32 }),
        "2026-11-04"
      )
    ).toThrow(RangeError);
  });
});

describe("응답용 보기", () => {
  const row = {
    kind: "saving",
    amount: "1000000",
    asOfDate: "2026-01-01",
    contributionAmount: "500000",
    contributionDay: 15,
    contributionEndDate: null,
  };

  it("계획이 있으면 현재 값과 기준·횟수를 함께 준다", () => {
    expect(manualSavingsView(row, "2026-11-04")).toEqual({
      amount: "6000000",
      asOfDate: "2026-10-15",
      savingsPlan: {
        monthlyAmount: "500000",
        day: 15,
        endDate: null,
        baseAmount: "1000000",
        baseAsOfDate: "2026-01-01",
        contributions: 10,
      },
    });
  });

  it("계획이 없으면 저장된 값 그대로이고 savingsPlan 키를 만들지 않는다(옛 앱 번들 호환)", () => {
    const view = manualSavingsView(
      { ...row, contributionAmount: null, contributionDay: null },
      "2026-11-04"
    );
    expect(view).toEqual({ amount: "1000000", asOfDate: "2026-01-01" });
    expect(Object.keys(view)).not.toContain("savingsPlan");
    expect(
      Object.keys(manualSavingsView({ ...row, kind: "account" }, "2026-11-04"))
    ).not.toContain("savingsPlan");
  });
});
