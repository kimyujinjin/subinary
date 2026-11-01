import { manualFinanceDateSchema } from "@family/contracts";

/** Home links intentionally start a complete, all-time review view. */
export const HOME_REVIEW_HREF = "/transactions?review=1";

export function visibleReviewCount({
  count,
  loading,
  error,
}: {
  count: number;
  loading: boolean;
  error: boolean;
}): number | null {
  return !loading && !error && Number.isSafeInteger(count) && count > 0
    ? count
    : null;
}

/** Manual KRW values are decimal strings. Never round them through Number. */
export function manualKrwText(value: string | null | undefined): string {
  if (value == null || !/^-?(0|[1-9]\d*)$/.test(value)) return "— 원";
  return `${new Intl.NumberFormat("ko-KR").format(BigInt(value))}원`;
}

/** Keep a stored calendar date as a calendar date, without a timezone shift. */
export function manualDateText(value: string | null | undefined): string {
  if (!value || !manualFinanceDateSchema.safeParse(value).success) return "미입력";
  return value;
}
