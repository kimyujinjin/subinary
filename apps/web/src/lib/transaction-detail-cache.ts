import type { QueryClient } from "@tanstack/react-query";
import type { TransactionSummary } from "@family/contracts";

export const transactionDetailKey = (householdId: string | null, id: string | null) =>
  ["transaction-detail", householdId, id] as const;

/** Preserve pagination/filter boundaries: replace existing rows, never append. */
export function replaceTransactionInCache(data: unknown, updated: TransactionSummary, keepUpdated = true): unknown {
  if (!data || typeof data !== "object") return data;
  const value = data as Record<string, unknown>;
  if (Array.isArray(value.pages)) {
    return { ...value, pages: value.pages.map((page) => replaceTransactionInCache(page, updated, keepUpdated)) };
  }
  if (Array.isArray(value.items)) {
    return { ...value, items: value.items.flatMap((item: unknown) =>
      item && typeof item === "object" && (item as { id?: unknown }).id === updated.id
        ? keepUpdated ? [updated] : [] : [item]) };
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
  for (const [key] of qc.getQueriesData({ queryKey: ["transactions", updated.householdId] })) {
    const filter = key[2] as { review?: unknown } | undefined;
    const keep = filter?.review !== "1" || (updated.masked !== true && updated.excludedAt == null &&
      (updated.status === "pending_review" || updated.status === "duplicate_suspected"));
    qc.setQueryData(key, (old: unknown) => replaceTransactionInCache(old, updated, keep));
  }
}
