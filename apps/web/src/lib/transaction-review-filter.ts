import { isMonthKey } from "./month";

type Params = Pick<URLSearchParams, "get" | "has">;

/** Review links span all dates unless the caller explicitly supplies a period. */
export function initialTransactionMonth(params: Params, thisMonth: string): string {
  const month = params.get("month");
  if (month === "all" || (params.has("month") && month === "")) return "";
  if (month && isMonthKey(month)) return month;
  return params.get("review") === "1" ? "" : thisMonth;
}

export function transactionReviewPeriodQuery(month: string, review: boolean, thisMonth: string): URLSearchParams {
  const params = new URLSearchParams();
  if (month === "") {
    if (!review) params.set("month", "all");
  } else if (review || month !== thisMonth) params.set("month", month);
  if (review) params.set("review", "1");
  return params;
}
