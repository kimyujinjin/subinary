/**
 * 거래 추가 창(`add-transaction-dialog.tsx`)의 직접 입력 계산 — 화면 없이 시험하려고 따로 둔다.
 *
 * 직접 입력은 원화 전용이다(서버 계약은 통화를 받지만 이 창은 외화 금액·환율을 묻지 않는다).
 * 금액 칸은 `AmountInput`이라 값은 콤마 없는 숫자 문자열(raw)로 들어온다.
 */

export type ManualFieldName = "amount" | "merchant" | "occurredAt";
export type ManualFieldErrors = Partial<Record<ManualFieldName, string>>;

export const MANUAL_FIELD_MESSAGES = {
  amount: "금액을 1원 이상 입력해 주세요.",
  merchant: "가맹점을 입력해 주세요.",
  occurredAt: "날짜와 시간을 다시 골라 주세요.",
} as const satisfies Record<ManualFieldName, string>;

/** `datetime-local` 칸 값(`YYYY-MM-DDTHH:mm`). 칸이 이 기기 시간대로 읽고 쓰므로 로컬 시각으로 만든다. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 빈 값·0원·잘못된 날짜를 칸마다 한 문장으로 알린다. 오류가 없으면 빈 객체. */
export function manualFieldErrors({
  amount,
  merchant,
  occurredAt,
}: {
  amount: string;
  merchant: string;
  occurredAt: string;
}): ManualFieldErrors {
  const errors: ManualFieldErrors = {};
  const amountInt = Number(amount.replace(/[,\s]/g, ""));
  if (
    amount.trim() === "" ||
    !Number.isSafeInteger(amountInt) ||
    amountInt <= 0
  ) {
    errors.amount = MANUAL_FIELD_MESSAGES.amount;
  }
  if (merchant.trim().length === 0)
    errors.merchant = MANUAL_FIELD_MESSAGES.merchant;
  if (
    occurredAt.trim() === "" ||
    Number.isNaN(new Date(occurredAt).getTime())
  ) {
    errors.occurredAt = MANUAL_FIELD_MESSAGES.occurredAt;
  }
  return errors;
}

type PreviewFields = {
  amount: number | null;
  currency: string | null;
  merchantRaw: string | null;
  occurredAt: string | null;
};

/**
 * 문자에서 읽은 값을 직접 입력 칸에 옮긴다. 가맹점·날짜는 읽은 게 있을 때만 바꾸고(없으면 칸 값을 둔다),
 * 금액은 늘 다시 정한다 — 외화 금액(minor units)을 원화 칸에 그대로 넣으면 다른 금액으로 저장되므로 비운다.
 */
export function previewPrefill(preview: PreviewFields): {
  amount: string;
  merchant?: string;
  occurredAt?: string;
} {
  const krw = (preview.currency ?? "KRW") === "KRW";
  const amount =
    krw && preview.amount != null && preview.amount > 0
      ? String(preview.amount)
      : "";
  const next: { amount: string; merchant?: string; occurredAt?: string } = {
    amount,
  };
  if (preview.merchantRaw) next.merchant = preview.merchantRaw;
  if (preview.occurredAt) {
    const date = new Date(preview.occurredAt);
    if (!Number.isNaN(date.getTime()))
      next.occurredAt = toLocalInputValue(date);
  }
  return next;
}
