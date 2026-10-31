import { QueryClient } from "@tanstack/react-query";
import type { TransactionSummary } from "@family/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { TRANSACTION_SCOPE_KEYS } from "./invalidation-scope";
import { cancelTransactionReads, replaceTransactionInCache, transactionDetailKey, writeTransactionResult } from "./transaction-detail-cache";

const clients: QueryClient[] = [];
function client() { const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc); return qc; }
afterEach(() => clients.splice(0).forEach((qc) => qc.clear()));
const oldRow = { id: "synthetic-old-month", householdId: "synthetic-household", amount: 1000, memo: "before" } as TransactionSummary;
const updated = { ...oldRow, amount: 2000, memo: "after" };

describe("transaction response cache reconciliation", () => {
  it("immediately replaces an off-list deep link detail with the confirmed PATCH result", () => {
    const qc = client(); const key = transactionDetailKey(oldRow.householdId, oldRow.id);
    qc.setQueryData(key, oldRow); writeTransactionResult(qc, updated);
    expect(qc.getQueryData(key)).toEqual(updated);
  });

  it("updates existing list/infinite rows while preserving pages, cursors and other household caches", () => {
    const qc = client();
    const key = ["transactions", oldRow.householdId, { from: "synthetic-range" }, "infinite"];
    qc.setQueryData(key, { pageParams: [null, "cursor"], pages: [
      { items: [oldRow], nextCursor: "cursor" }, { items: [{ ...oldRow, id: "other" }], nextCursor: null },
    ] });
    const otherKey = ["transactions", "other-household", {}];
    qc.setQueryData(otherKey, { items: [oldRow], nextCursor: null });
    writeTransactionResult(qc, updated);
    expect(qc.getQueryData(key)).toEqual({ pageParams: [null, "cursor"], pages: [
      { items: [updated], nextCursor: "cursor" }, { items: [{ ...oldRow, id: "other" }], nextCursor: null },
    ] });
    expect(qc.getQueryData(otherKey)).toEqual({ items: [oldRow], nextCursor: null });
  });

  it("does not insert a changed transaction into unrelated filtered results", () => {
    expect(replaceTransactionInCache({ items: [], nextCursor: null }, updated))
      .toEqual({ items: [], nextCursor: null });
    expect(replaceTransactionInCache(undefined, updated)).toBeUndefined();
  });

  it("prevents a GET started before PATCH from replacing the confirmed edit with stale data", async () => {
    const qc = client(); const key = transactionDetailKey(oldRow.householdId, oldRow.id);
    let resolve!: (row: TransactionSummary) => void;
    const oldFetch = qc.fetchQuery({ queryKey: key, queryFn: () => new Promise<TransactionSummary>((yes) => { resolve = yes; }) })
      .catch(() => undefined);
    await cancelTransactionReads(qc, oldRow.householdId, oldRow.id);
    writeTransactionResult(qc, updated);
    resolve(oldRow); await oldFetch; await Promise.resolve();
    expect(qc.getQueryData(key)).toEqual(updated);
  });

  it("includes off-list detail in the actual transaction mutation/realtime invalidation scope", async () => {
    const qc = client(); const key = transactionDetailKey(oldRow.householdId, oldRow.id);
    qc.setQueryData(key, oldRow);
    await Promise.all(TRANSACTION_SCOPE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
