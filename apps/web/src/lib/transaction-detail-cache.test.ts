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

  it("removes resolved/excluded rows from review caches even when the refresh fails", async () => {
    for (const patch of [{ status: "approved" as const }, { status: "pending_review" as const, excludedAt: "2026-10-31T00:00:00.000Z" }, { status: "pending_review" as const, masked: true }]) {
      const qc = client();
      const before = { ...oldRow, status: "pending_review" as const, excludedAt: null };
      const reviewKey = ["transactions", oldRow.householdId, { review: "1" }];
      const infiniteKey = [...reviewKey, "infinite"];
      const generalKey = ["transactions", oldRow.householdId, {}];
      qc.setQueryData(reviewKey, { items: [before], nextCursor: null });
      qc.setQueryData(infiniteKey, { pageParams: [null], pages: [{ items: [before], nextCursor: "next" }] });
      qc.setQueryData(generalKey, { items: [before], nextCursor: null });
      const after = { ...before, ...patch };
      writeTransactionResult(qc, after);
      await qc.fetchQuery({ queryKey: reviewKey, queryFn: async () => { throw new Error("synthetic offline"); } }).catch(() => undefined);
      expect(qc.getQueryData(reviewKey)).toEqual({ items: [], nextCursor: null });
      expect(qc.getQueryData(infiniteKey)).toEqual({ pageParams: [null], pages: [{ items: [], nextCursor: "next" }] });
      expect(qc.getQueryData(generalKey)).toEqual({ items: [after], nextCursor: null });
      expect(qc.getQueryData(transactionDetailKey(after.householdId, after.id))).toEqual(after);
    }
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
