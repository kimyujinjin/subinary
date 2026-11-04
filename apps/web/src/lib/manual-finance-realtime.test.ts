import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { isManualFinanceHint, refreshManualFinanceQueries, resetSharedManualFinanceQueries, revalidateSharedManualFinanceQueries } from "./manual-finance-realtime";

describe("manual finance shared cache revocation", () => {
  it("recognizes only the explicit v1 metadata hint", () => {
    expect(isManualFinanceHint('{"type":"manual-finance.changed","v":1}')).toBe(true);
    for (const data of ["invalid", "null", "[]", '{"type":"transactions.changed","v":1}', '{"type":"manual-finance.changed","v":2}']) expect(isManualFinanceHint(data)).toBe(false);
  });
  it("immediately clears shared data while preserving private and other household caches", async () => {
    const qc = new QueryClient();
    const shared = ["manual-finance", "hh-a", "user-a", "household", "assets"];
    const privateKey = ["manual-finance", "hh-a", "user-a", "private", "assets"];
    const other = ["manual-finance", "hh-b", "user-a", "household", "assets"];
    for (const key of [shared, privateKey, other]) qc.setQueryData(key, { label: "synthetic previous value" });
    await resetSharedManualFinanceQueries(qc, "hh-a");
    expect(qc.getQueryData(shared)).toBeUndefined();
    expect(qc.getQueryData(privateKey)).toEqual({ label: "synthetic previous value" });
    expect(qc.getQueryData(other)).toEqual({ label: "synthetic previous value" });
    qc.clear();
  });
  it("does not let an old in-flight response resurrect a revoked shared record", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["manual-finance", "hh-a", "user-a", "household", "housing-plans"];
    qc.setQueryData(key, { label: "synthetic old record" });
    let resolve!: (value: unknown) => void;
    const pending = qc.fetchQuery({ queryKey: key, queryFn: () => new Promise(done => { resolve = done; }) }).catch(() => undefined);
    await resetSharedManualFinanceQueries(qc, "hh-a");
    resolve({ label: "synthetic old record" }); await pending;
    expect(qc.getQueryData(key)).toBeUndefined(); qc.clear();
  });
  it("clears only this family's owner connection views on the existing SSE/foreground reset", async () => {
    const qc = new QueryClient();
    const own = ["manual-finance", "hh-a", "user-a", "owner", "finance-connections"];
    const otherFamily = ["manual-finance", "hh-b", "user-a", "owner", "finance-connections"];
    const otherOwnerData = ["manual-finance", "hh-a", "user-a", "owner", "loan-import-records"];
    for (const key of [own, otherFamily, otherOwnerData]) qc.setQueryData(key, { synthetic: true });
    await resetSharedManualFinanceQueries(qc, "hh-a");
    expect(qc.getQueryData(own)).toBeUndefined();
    expect(qc.getQueryData(otherFamily)).toEqual({ synthetic: true });
    expect(qc.getQueryData(otherOwnerData)).toEqual({ synthetic: true });
    qc.clear();
  });
  it("drops connection snapshots on the existing authorization tick while only invalidating other records", async () => {
    const qc = new QueryClient();
    const connection = ["manual-finance", "hh-a", "user-a", "owner", "finance-connections"];
    const asset = ["manual-finance", "hh-a", "user-a", "household", "assets"];
    qc.setQueryData(connection, { synthetic: true });
    qc.setQueryData(asset, { synthetic: true });
    await refreshManualFinanceQueries(qc, "hh-a");
    expect(qc.getQueryData(connection)).toBeUndefined();
    expect(qc.getQueryData(asset)).toEqual({ synthetic: true });
    expect(qc.getQueryState(asset)?.isInvalidated).toBe(true);
    qc.clear();
  });
  it("앱 복귀는 공유 값을 지우지 않고 다시 확인만 한다 — 연결 계좌 화면만 비운다", async () => {
    const qc = new QueryClient();
    const shared = ["manual-finance", "hh-a", "user-a", "household", "overview"];
    const privateKey = ["manual-finance", "hh-a", "user-a", "private", "assets"];
    const connection = ["manual-finance", "hh-a", "user-a", "owner", "finance-connections"];
    const other = ["manual-finance", "hh-b", "user-a", "household", "assets"];
    for (const key of [shared, privateKey, connection, other]) qc.setQueryData(key, { synthetic: true });
    await revalidateSharedManualFinanceQueries(qc, "hh-a");
    // 보여 주던 값은 남고(로딩으로 번쩍이지 않음) 다시 받을 대상으로만 표시된다.
    expect(qc.getQueryData(shared)).toEqual({ synthetic: true });
    expect(qc.getQueryState(shared)?.isInvalidated).toBe(true);
    expect(qc.getQueryData(connection)).toBeUndefined();
    expect(qc.getQueryState(privateKey)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(other)?.isInvalidated).toBe(false);
    qc.clear();
  });
});
