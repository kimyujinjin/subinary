import type { QueryClient } from "@tanstack/react-query";

export function isManualFinanceHint(data: string): boolean {
  try {
    const value: unknown = JSON.parse(data);
    return value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "manual-finance.changed" &&
      (value as { v?: unknown }).v === 1;
  } catch { return false; }
}

/** Clear shared values before refetch, so a revoked value cannot survive an offline GET. */
export function resetSharedManualFinanceQueries(qc: QueryClient, householdId: string) {
  return qc.resetQueries({
    queryKey: ["manual-finance", householdId],
    predicate: query => query.queryKey[3] === "household",
  });
}

/** Missed hints converge on the existing foreground safety interval. */
export function refreshManualFinanceQueries(qc: QueryClient, householdId: string) {
  return qc.invalidateQueries({ queryKey: ["manual-finance", householdId] });
}
