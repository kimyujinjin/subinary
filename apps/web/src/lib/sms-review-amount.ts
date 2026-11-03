import { currencyExponent } from "@family/shared";

/** 저장된 최소 통화 단위 금액을 사람이 입력하는 통화 금액 문자열로 바꾼다. */
export function smsReviewAmountInput(amount: number | null, currency: string): string {
  if (amount === null || !Number.isSafeInteger(amount) || amount < 0) return "";
  const exponent = currencyExponent(currency);
  const digits = String(amount).padStart(exponent + 1, "0");
  return exponent === 0 ? digits : `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** 입력 통화 금액을 반올림 없이 저장 단위로 바꾼다. 잘못된 금액은 null로 남긴다. */
export function smsReviewAmountMinorUnits(value: string, currency: string): number | null {
  const normalized = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.replaceAll(",", "").split(".");
  const exponent = currencyExponent(currency);
  if (fraction.length > exponent) return null;
  const amount = Number(`${whole}${fraction.padEnd(exponent, "0")}`);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
