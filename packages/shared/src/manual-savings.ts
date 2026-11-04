/**
 * 적금 자동 납입 — 현재 적립액 계산(2026-11-04).
 *
 * 사용자가 확인한 기준 금액·기준일에서, 기준일 **다음 날부터** 매월 납입일마다 같은 금액을 더한다.
 * - 기준일 당일 납입은 기준 금액에 이미 들어 있다고 본다.
 * - 납입일이 그 달에 없으면(31일 → 2월) 말일로 본다(카드 결제일과 같은 규칙).
 * - 만기일이 있으면 그날까지의 납입일만 센다.
 * - 원금만 더한다. 이자는 넣지 않는다.
 *
 * 서버가 읽을 때마다 계산하므로 배치 작업이나 DB 자동 수정이 없다. 사용자가 금액을 다시 적으면
 * 그 값이 새 기준이 된다(화면은 계산된 현재 값을 기준으로 보여 주므로 그대로 저장해도 같은 값이다).
 */

export interface ManualSavingsPlanInput {
  /** 매월 넣는 금액(원, 정수 문자열, 1 이상). */
  monthlyAmount: string;
  /** 납입일(1~31). */
  day: number;
  /** 만기일(YYYY-MM-DD). 없으면 계속 더한다. */
  endDate: string | null;
}

export interface ManualSavingsProjection {
  amount: string;
  /** 마지막으로 더한 납입일. 더한 것이 없으면 기준일. */
  asOfDate: string;
  contributions: number;
}

/** numeric(20,0) 최댓값. 이를 넘기면 응답 계약(20자리)이 깨지므로 납입 횟수를 거기서 멈춘다. */
const MAX_KRW = 99_999_999_999_999_999_999n;

function isCalendarDate(value: string): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= lastDay(year, month)
  );
}

function lastDay(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ]!;
}

/** 월 번호(연*12 + 월-1)의 납입일. 날짜 문자열은 0 채움 고정폭이라 문자열 비교가 날짜 비교다. */
function contributionDate(monthIndex: number, day: number): string {
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const date = Math.min(day, lastDay(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0"
  )}-${String(date).padStart(2, "0")}`;
}

function monthIndexOf(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

export function projectManualSavings(
  base: { amount: string; asOfDate: string },
  plan: ManualSavingsPlanInput,
  today: string
): ManualSavingsProjection {
  if (
    !/^(0|[1-9]\d{0,19})$/.test(base.amount) ||
    !/^[1-9]\d{0,19}$/.test(plan.monthlyAmount) ||
    !Number.isInteger(plan.day) ||
    plan.day < 1 ||
    plan.day > 31 ||
    !isCalendarDate(base.asOfDate) ||
    !isCalendarDate(today) ||
    (plan.endDate !== null && !isCalendarDate(plan.endDate))
  ) {
    throw new RangeError("manual_savings_invalid_plan");
  }
  const limit =
    plan.endDate !== null && plan.endDate < today ? plan.endDate : today;
  let first = monthIndexOf(base.asOfDate);
  if (contributionDate(first, plan.day) <= base.asOfDate) first += 1;
  let last = monthIndexOf(limit);
  if (contributionDate(last, plan.day) > limit) last -= 1;
  const baseAmount = BigInt(base.amount);
  const monthly = BigInt(plan.monthlyAmount);
  let contributions = last >= first ? last - first + 1 : 0;
  if (
    contributions > 0 &&
    baseAmount + monthly * BigInt(contributions) > MAX_KRW
  ) {
    contributions = Number((MAX_KRW - baseAmount) / monthly);
  }
  if (contributions <= 0)
    return { amount: base.amount, asOfDate: base.asOfDate, contributions: 0 };
  return {
    amount: (baseAmount + monthly * BigInt(contributions)).toString(),
    asOfDate: contributionDate(first + contributions - 1, plan.day),
    contributions,
  };
}

/** DB 행(수동 자산)에 저장된 자동 납입 열. 셋 다 null이면 계획이 없다. */
export interface ManualSavingsRow {
  kind: string;
  amount: string | null;
  asOfDate: string | null;
  contributionAmount: string | null;
  contributionDay: number | null;
  contributionEndDate: string | null;
}

export interface ManualSavingsStatus extends ManualSavingsPlanInput {
  baseAmount: string;
  baseAsOfDate: string;
  contributions: number;
}

/**
 * 응답에 쓸 금액·기준일과 자동 납입 상태. 계획이 없으면 저장된 값을 그대로 돌려주고
 * `savingsPlan` 키를 만들지 않는다 — 계약이 strict라 옛 앱 번들은 모르는 키에서 응답 전체를
 * 거부한다. 계획이 있는 자산에만 키가 붙는다.
 */
export function manualSavingsView(
  row: ManualSavingsRow,
  today: string
): {
  amount: string | null;
  asOfDate: string | null;
  savingsPlan?: ManualSavingsStatus;
} {
  if (
    row.kind !== "saving" ||
    row.contributionAmount === null ||
    row.contributionDay === null ||
    row.amount === null ||
    row.asOfDate === null
  ) {
    return { amount: row.amount, asOfDate: row.asOfDate };
  }
  const plan = {
    monthlyAmount: row.contributionAmount,
    day: row.contributionDay,
    endDate: row.contributionEndDate,
  };
  const projected = projectManualSavings(
    { amount: row.amount, asOfDate: row.asOfDate },
    plan,
    today
  );
  return {
    amount: projected.amount,
    asOfDate: projected.asOfDate,
    savingsPlan: {
      ...plan,
      baseAmount: row.amount,
      baseAsOfDate: row.asOfDate,
      contributions: projected.contributions,
    },
  };
}
