import type { QueryClient } from "@tanstack/react-query";
import type { TransactionSummary } from "@family/contracts";

export const transactionDetailKey = (householdId: string | null, id: string | null) =>
  ["transaction-detail", householdId, id] as const;

/** Preserve pagination/filter boundaries: replace existing rows, never append. */
export function replaceTransactionInCache(data: unknown, updated: TransactionSummary): unknown {
  if (!data || typeof data !== "object") return data;
  const value = data as Record<string, unknown>;
  if (Array.isArray(value.pages)) {
    return { ...value, pages: value.pages.map((page) => replaceTransactionInCache(page, updated)) };
  }
  if (Array.isArray(value.items)) {
    return { ...value, items: value.items.map((item: unknown) =>
      item && typeof item === "object" && (item as { id?: unknown }).id === updated.id ? updated : item) };
  }
  return data;
}

/** Ignore GETs that started before the PATCH, even when fetch cannot be aborted. */
export async function cancelTransactionReads(qc: QueryClient, householdId: string | null, id: string) {
  await Promise.all([
    qc.cancelQueries({ queryKey: transactionDetailKey(householdId, id) }),
    qc.cancelQueries({ queryKey: ["transactions", householdId] }),
  ]);
}

export function writeTransactionResult(qc: QueryClient, updated: TransactionSummary): void {
  qc.setQueryData(transactionDetailKey(updated.householdId, updated.id), updated);
  qc.setQueriesData({ queryKey: ["transactions", updated.householdId] },
    (old: unknown) => replaceTransactionInCache(old, updated));
}
