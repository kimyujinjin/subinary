import type { TransactionFx } from "@family/contracts";
import { currencyExponent } from "@family/shared";
import React from "react";

import { formatMonthDay } from "@/lib/format";

/*
 * 해외 결제의 환율 한 줄(2026-11-05 HIG 검수 3·4단계).
 * 예전에는 '환산 기준 보기'를 펼치면 적용 기준일·출처('운영자 보충 스냅샷'·'저장된 스냅샷')·환산 기준
 * ('고정된 참고환율')·저장된 환율이 표로 나왔다 — 내부 용어였고, 사용자가 알고 싶은 것(얼마에 바꿨나, 언제 기준인가)은
 * 표 속에 묻혀 있었다. 이제 '1달러 = 1,324.63원 · 10월 22일 기준' 한 줄과 청구액 안내만 둔다.
 * 기록에 없는 값(기준일·환율)은 지어내지 않는다 — 날짜는 기준이 확인된 기록에서만, 환율은 저장된 값만 쓴다.
 */

/** 통화 한 단위의 이름('1달러'). 목록에 없는 통화는 코드 그대로('1 GBP'). */
const UNIT_NAMES: Readonly<Record<string, string>> = {
  USD: "달러",
  EUR: "유로",
  JPY: "엔",
  CNY: "위안",
};

const rateFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
});
/**
 * 1원보다 작은 환율(VND 0.0543·IDR 0.0874)은 소수 둘째 자리에서 자르면 0.05·0.09로 8%까지 틀어진다 —
 * 유효숫자 4자리로 쓴다. `roundingPriority`는 오래된 Android WebView가 모를 수 있어 값으로 나눈다.
 */
const smallRateFormatter = new Intl.NumberFormat("ko-KR", {
  maximumSignificantDigits: 4,
});

function formatRate(rate: number): string {
  return Math.abs(rate) < 1
    ? smallRateFormatter.format(rate)
    : rateFormatter.format(rate);
}

type FxEvidence = Readonly<{
  currency: string;
  exchangeRate: number | null;
  fx?: TransactionFx | null;
}>;

/** 외화 원금 표기 — 'USD 12.34'. '$'는 여러 나라가 같이 써서 통화 코드로 쓴다(금액 칸 단위와 같은 이유). */
export function foreignAmountLabel(minor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  const exp = currencyExponent(code);
  const major = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / 10 ** exp);
  return `${code} ${major}`;
}

/** 환율 한 줄 — '1달러 = 1,324.63원 · 10월 22일 기준'. 환율 기록이 없으면 그렇다고 말한다. */
export function fxRateLine(
  { currency, exchangeRate, fx }: FxEvidence,
  now?: Date
): string {
  const code = currency.trim().toUpperCase();
  const stored =
    fx?.rate ??
    (exchangeRate !== null && Number.isFinite(exchangeRate)
      ? String(exchangeRate)
      : null);
  const rate = stored !== null && Number.isFinite(Number(stored)) ? Number(stored) : null;
  const unit = UNIT_NAMES[code] ? `1${UNIT_NAMES[code]}` : `1 ${code}`;
  const parts = [
    rate !== null ? `${unit} = ${formatRate(rate)}원` : "환율 기록이 없어요",
  ];
  if (fx && fx.basis !== "unknown" && fx.asOfDate) {
    parts.push(`${formatMonthDay(fx.asOfDate, now)} 기준`);
  }
  return parts.join(" · ");
}

/** 상세의 '해외 결제' 줄 아래 한 줄. 위 원화 금액은 이 환율로 바꾼 추정값이라 청구액과 다를 수 있다고 함께 말한다. */
export function TransactionFxDetails(props: FxEvidence) {
  return <p>{fxRateLine(props)} · 카드 청구액과 다를 수 있어요</p>;
}
