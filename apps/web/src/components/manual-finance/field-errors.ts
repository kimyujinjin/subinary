/**
 * 입력 검사 문구 → 오류를 붙일 칸(2026-11-05 HIG 검수 4단계).
 *
 * 예전에는 검사 실패가 창 아래(푸터)에 한 줄로만 떠서, 긴 폼에서는 어느 칸이 틀렸는지 찾아야 했다.
 * 검사 자체(`model.ts`의 assetRequest·planRequest)는 그대로 두고, 그 문구가 어느 칸 것인지만 여기서 정한다.
 * 목록에 없는 문구(이름·메모 길이 등)는 null — 지금처럼 창 아래 한 줄로 남는다.
 * 문구가 바뀌면 칸을 잃고 창 아래로 떨어질 뿐 사라지지는 않는다. 테스트가 문구 하나하나를 고정한다.
 */
import { manualHousingPaymentInputSchema } from "@family/contracts";

import { parseManualKrwInput } from "./model";

export type AssetField =
  | "label"
  | "amount"
  | "asOfDate"
  | "monthlyAmount"
  | "contributionDay"
  | "endDate";

const ASSET_FIELDS: Readonly<Record<string, AssetField>> = {
  "자산 이름을 입력해 주세요.": "label",
  "금액은 0원 이상, 소수점 없이 입력해 주세요. 최대 20자리까지 가능해요.":
    "amount",
  "자동 납입을 쓰려면 현재 적립액과 기준일을 입력해 주세요.": "amount",
  "금액을 입력하지 않았다면 기준일도 비워 주세요.": "asOfDate",
  "금액을 확인한 날짜를 입력해 주세요. 미래 날짜는 사용할 수 없어요.":
    "asOfDate",
  "매월 넣는 금액을 1원 이상, 소수점 없이 입력해 주세요.": "monthlyAmount",
  "매월 넣는 날을 골라 주세요.": "contributionDay",
  "자동 납입의 만기일을 확인해 주세요.": "endDate",
};

/** 자산 폼 검사 문구가 가리키는 칸. 칸을 모르면 null. */
export function assetErrorField(message: string | null): AssetField | null {
  return message ? ASSET_FIELDS[message] ?? null : null;
}

export type PlanPaymentField =
  | "installment"
  | "amount"
  | "dueDate"
  | "paidAmount"
  | "paidDate";

export type PlanFieldError =
  | { field: "label" | "occupancyYear"; message: string }
  | { field: PlanPaymentField; paymentId: string; message: string };

interface PaymentDraftLike {
  id: string;
  kind: string;
  installment: string;
  dueDate: string;
  amount: string;
  paidAmount: string;
  paidDate: string;
}

/** planRequest가 납부 일정을 통째로 검사하고 내는 문구 — 어느 일정인지 여기서 다시 찾는다. */
const PLAN_SCHEMA_MESSAGE =
  "납부 날짜와 금액을 확인해 주세요. 낸 금액은 예정 금액을 넘을 수 없어요. 실제 납부액이 있으면 납부일도 입력해 주세요.";

function paymentIssue(
  payment: PaymentDraftLike
): { field: PlanPaymentField; message: string } | null {
  const amount = parseManualKrwInput(payment.amount);
  const paidAmount = parseManualKrwInput(payment.paidAmount);
  // planRequest와 같은 모양으로 한 일정씩 계약 스키마에 넣어 본다.
  const result = manualHousingPaymentInputSchema.safeParse({
    id: payment.id,
    kind: payment.kind,
    installment: payment.installment ? Number(payment.installment) : null,
    dueDate: payment.dueDate || null,
    amount: amount ?? null,
    paidAmount: paidAmount ?? null,
    paidDate: payment.paidDate || null,
  });
  if (result.success) return null;
  const field = result.error.issues
    .map((issue) => issue.path[0])
    .find(
      (key): key is PlanPaymentField =>
        key === "paidAmount" ||
        key === "paidDate" ||
        key === "dueDate" ||
        key === "amount" ||
        key === "installment"
    );
  if (field === "paidAmount")
    return {
      field,
      message:
        amount === null
          ? "낸 금액이 있으면 예정 금액도 적어 주세요."
          : "낸 금액은 예정 금액보다 클 수 없어요.",
    };
  if (field === "paidDate")
    return {
      field,
      message:
        paidAmount !== null && paidAmount !== "0" && !payment.paidDate
          ? "낸 금액이 있으면 실제 납부일도 적어 주세요."
          : payment.paidDate && (paidAmount === null || paidAmount === "0")
          ? "낸 금액이 없으면 실제 납부일은 비워 주세요."
          : "실제 납부일을 확인해 주세요. 앞으로의 날짜는 적을 수 없어요.",
    };
  if (field === "dueDate")
    return { field, message: "납부 예정일을 확인해 주세요." };
  return null;
}

/** 주택 계획 폼 검사 문구가 가리키는 칸(납부 일정이면 그 일정의 칸). 칸을 모르면 null. */
export function planFieldError(
  message: string | null,
  payments: readonly PaymentDraftLike[]
): PlanFieldError | null {
  if (!message) return null;
  if (message === "주택 이름을 입력해 주세요.")
    return { field: "label", message };
  if (message.startsWith("입주연도를 확인해 주세요."))
    return { field: "occupancyYear", message };
  const numbered = /^(\d+)번째 납부 (금액|일정의 회차)/.exec(message);
  if (numbered) {
    const payment = payments[Number(numbered[1]) - 1];
    if (!payment) return null;
    if (numbered[2] === "일정의 회차")
      return { field: "installment", paymentId: payment.id, message };
    return {
      field:
        parseManualKrwInput(payment.amount) === undefined
          ? "amount"
          : "paidAmount",
      paymentId: payment.id,
      message,
    };
  }
  if (message === PLAN_SCHEMA_MESSAGE) {
    for (const payment of payments) {
      const issue = paymentIssue(payment);
      if (issue) return { ...issue, paymentId: payment.id };
    }
  }
  return null;
}
