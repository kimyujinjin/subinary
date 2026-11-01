import { isMonthKey } from "./month";

export type LedgerSection = "transactions" | "analysis" | "budgets";

const LEDGER_DESTINATIONS = [
  { key: "transactions", href: "/transactions", label: "거래" },
  { key: "analysis", href: "/ledger/analysis", label: "분석" },
  { key: "budgets", href: "/budgets", label: "예산" },
] as const;

/** Month travels between ledger sections; transaction-only filters do not. */
export function ledgerNavItems(month?: string) {
  const query = month && isMonthKey(month)
    ? `?${new URLSearchParams({ month }).toString()}`
    : "";
  return LEDGER_DESTINATIONS.map((item) => ({ ...item, href: item.href + query }));
}
