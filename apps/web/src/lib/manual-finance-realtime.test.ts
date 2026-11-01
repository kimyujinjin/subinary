import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { isManualFinanceHint, resetSharedManualFinanceQueries } from "./manual-finance-realtime";

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
});
