/**
 * 입력 검사 오류를 칸 아래에 붙이는 연결(2026-11-05 HIG 검수 4단계).
 * model.ts의 검사가 실제로 내는 문구로 확인한다 — 문구가 바뀌면 오류가 칸을 잃고 창 아래로 떨어지므로 여기서 먼저 깨진다.
 */
import { describe, expect, it } from "vitest";

import { assetErrorField, planFieldError } from "./field-errors";
import {
  assetDraft,
  assetRequest,
  paymentDraft,
  planDraft,
  planRequest,
} from "./model";

const id = "8f3c2b8e-7a51-4f0e-9a51-0c9e2f1b7d10";
const householdId = "4d1f3c22-1e6b-4b5f-8a3e-2a9b6c7d8e90";
const paymentId = "c6a5d4e3-2b1a-4f9e-8d7c-6b5a4e3d2c1b";

function assetFailure(patch: Partial<ReturnType<typeof assetDraft>>): string {
  const result = assetRequest(
    { ...assetDraft(), label: "생활비 통장", ...patch },
    id,
    householdId
  );
  if (result.ok) throw new Error("검사를 통과해 버렸다");
  return result.message;
}

describe("자산 폼 검사 오류 → 칸", () => {
  it.each([
    [{ label: "  " }, "label"],
    [{ amount: "1.5" }, "amount"],
    [{ amount: "", asOfDate: "2026-11-01" }, "asOfDate"],
    [{ amount: "1000", asOfDate: "" }, "asOfDate"],
    [
      {
        kind: "saving" as const,
        amount: "",
        autoSave: true,
        monthlyAmount: "100",
        contributionDay: "5",
      },
      "amount",
    ],
    [
      {
        kind: "saving" as const,
        amount: "1000",
        asOfDate: "2026-11-01",
        autoSave: true,
        monthlyAmount: "",
        contributionDay: "5",
      },
      "monthlyAmount",
    ],
    [
      {
        kind: "saving" as const,
        amount: "1000",
        asOfDate: "2026-11-01",
        autoSave: true,
        monthlyAmount: "100",
        contributionDay: "",
      },
      "contributionDay",
    ],
  ] as const)("%j 는 %s 칸 아래에 붙는다", (patch, field) => {
    expect(assetErrorField(assetFailure(patch))).toBe(field);
  });

  it("미래 기준일 오류는 기준일 칸에 붙는다", () => {
    expect(
      assetErrorField(assetFailure({ amount: "1000", asOfDate: "2999-01-01" }))
    ).toBe("asOfDate");
  });

  it("칸을 모르는 문구와 오류 없음은 null — 창 아래 한 줄로 남는다", () => {
    expect(
      assetErrorField("이름·메모의 길이와 금액·공개 범위를 확인해 주세요.")
    ).toBeNull();
    expect(assetErrorField("저장된 내용이나 이전 요청과 달라요.")).toBeNull();
    expect(assetErrorField(null)).toBeNull();
  });
});

function planFailure(draft: ReturnType<typeof planDraft>): string {
  const result = planRequest(draft, id, householdId);
  if (result.ok) throw new Error("검사를 통과해 버렸다");
  return result.message;
}

describe("주택 계획 폼 검사 오류 → 칸", () => {
  const base = { ...planDraft(), label: "합성 주택" };
  const payment = (patch: Partial<ReturnType<typeof paymentDraft>>) => ({
    ...paymentDraft(paymentId),
    ...patch,
  });

  it("이름과 입주연도", () => {
    const label = planFailure({ ...base, label: " " });
    expect(planFieldError(label, [])).toEqual({
      field: "label",
      message: label,
    });
    const year = planFailure({ ...base, occupancyYear: "20x8" });
    expect(planFieldError(year, [])).toEqual({
      field: "occupancyYear",
      message: year,
    });
  });

  it("몇 번째 일정의 어느 금액 칸인지 찾는다", () => {
    const payments = [
      payment({ amount: "1000" }),
      payment({ id: id, amount: "1000", paidAmount: "1.5" }),
    ];
    const message = planFailure({ ...base, payments });
    expect(message).toContain("2번째");
    expect(planFieldError(message, payments)).toEqual({
      field: "paidAmount",
      paymentId: id,
      message,
    });
    const first = [payment({ amount: "12a" })];
    expect(
      planFieldError(planFailure({ ...base, payments: first }), first)
    ).toMatchObject({ field: "amount", paymentId });
  });

  it("회차 오류는 그 일정의 회차 칸", () => {
    const payments = [payment({ installment: "0" })];
    expect(
      planFieldError(planFailure({ ...base, payments }), payments)
    ).toMatchObject({ field: "installment", paymentId });
  });

  it("일정 전체 검사 오류도 문제가 된 일정·칸을 다시 찾아 쉬운 말로 붙인다", () => {
    const over = [
      payment({ amount: "1000", paidAmount: "2000", paidDate: "2026-11-01" }),
    ];
    expect(
      planFieldError(planFailure({ ...base, payments: over }), over)
    ).toEqual({
      field: "paidAmount",
      paymentId,
      message: "낸 금액은 예정 금액보다 클 수 없어요.",
    });
    const noDate = [payment({ amount: "1000", paidAmount: "500" })];
    expect(
      planFieldError(planFailure({ ...base, payments: noDate }), noDate)
    ).toEqual({
      field: "paidDate",
      paymentId,
      message: "낸 금액이 있으면 실제 납부일도 적어 주세요.",
    });
    const dateOnly = [
      payment({ amount: "1000", paidAmount: "0", paidDate: "2026-11-01" }),
    ];
    expect(
      planFieldError(planFailure({ ...base, payments: dateOnly }), dateOnly)
    ).toEqual({
      field: "paidDate",
      paymentId,
      message: "낸 금액이 없으면 실제 납부일은 비워 주세요.",
    });
    const noPlanned = [payment({ paidAmount: "500", paidDate: "2026-11-01" })];
    expect(
      planFieldError(planFailure({ ...base, payments: noPlanned }), noPlanned)
    ).toMatchObject({
      field: "paidAmount",
      message: "낸 금액이 있으면 예정 금액도 적어 주세요.",
    });
  });

  it("칸을 모르면 null", () => {
    expect(planFieldError(null, [])).toBeNull();
    expect(planFieldError("저장 결과를 확인하지 못했어요.", [])).toBeNull();
    expect(planFieldError("3번째 납부 금액을 확인해 주세요.", [])).toBeNull();
  });
});
