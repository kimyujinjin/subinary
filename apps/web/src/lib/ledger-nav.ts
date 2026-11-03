import { isMonthKey } from "./month";

export type LedgerSection = "transactions" | "analysis" | "budgets" | "todo";

const LEDGER_DESTINATIONS = [
  { key: "transactions", href: "/transactions", label: "거래" },
  { key: "analysis", href: "/ledger/analysis", label: "분석" },
  { key: "budgets", href: "/budgets", label: "예산" },
  { key: "todo", href: "/todo", label: "할 일" },
] as const satisfies ReadonlyArray<{
  key: LedgerSection;
  href: string;
  label: string;
}>;

/**
 * 전 기간 백로그라 월을 싣지 않는 섹션.
 *
 * 할 일에 월을 붙이면 "이번 달에 처리할 것"으로 읽힌다. 그 순간 지난달에 밀린 문자가
 * 화면에서 사라지고, `/todo`가 애초에 해결한 드리프트(홈 3일 창에서 조용히 사라지던
 * 문자)가 월 단위로 되살아난다.
 */
const ALL_TIME_SECTIONS: ReadonlySet<LedgerSection> = new Set(["todo"]);

/** Month travels between ledger sections; transaction-only filters do not. */
export function ledgerNavItems(month?: string) {
  const query =
    month && isMonthKey(month)
      ? `?${new URLSearchParams({ month }).toString()}`
      : "";
  return LEDGER_DESTINATIONS.map((item) => ({
    ...item,
    href: ALL_TIME_SECTIONS.has(item.key) ? item.href : item.href + query,
  }));
}
