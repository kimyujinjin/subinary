import type { QueryClient } from "@tanstack/react-query";

export function isManualFinanceHint(data: string): boolean {
  try {
    const value: unknown = JSON.parse(data);
    return value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "manual-finance.changed" &&
      (value as { v?: unknown }).v === 1;
  } catch { return false; }
}

/** Clear shared values and membership-bound connection views before authorization refetch. */
export function resetSharedManualFinanceQueries(qc: QueryClient, householdId: string) {
  return qc.resetQueries({
    queryKey: ["manual-finance", householdId],
    predicate: query => query.queryKey[3] === "household" ||
      (query.queryKey[3] === "owner" && query.queryKey[4] === "finance-connections"),
  });
}

/** Missed hints converge on the existing foreground safety interval. */
export function refreshManualFinanceQueries(qc: QueryClient, householdId: string) {
  const queryKey = ["manual-finance", householdId];
  // Provider connection views must also drop previously allowed data before a
  // missed-revocation authorization check. All other records keep their existing behavior.
  const isConnection = (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[3] === "owner" && query.queryKey[4] === "finance-connections";
  return Promise.all([
    qc.resetQueries({ queryKey, predicate: isConnection }),
    qc.invalidateQueries({ queryKey, predicate: query => !isConnection(query) }),
  ]).then(() => undefined);
}
