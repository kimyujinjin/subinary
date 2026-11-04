import { describe, expect, it } from "vitest";
import { assetBreakdown, type ConnectedHolding } from "./net-worth";

const toss: ConnectedHolding = { id: "t", label: "토스증권", krw: "0", usd: "10294.66", usdInKrw: 13842124n, totalKrw: 13842124n, stale: false };

describe("assetBreakdown", () => {
  it("groups assets by kind with connected holdings under 주식, and loans by item", () => {
    const result = assetBreakdown(
      [
        { id: "a", kind: "account", label: "월급통장", amount: "1000000" },
        { id: "b", kind: "account", label: "비상금", amount: null },
        { id: "l", kind: "loan", label: "신한 중도금 대출", amount: "111440000" },
      ],
      [],
      [toss]
    );
    expect(result.assets).toEqual([
      { key: "account", label: "통장·현금", amount: 1000000n, missing: 1 },
      { key: "stock", label: "주식", amount: 13842124n, missing: 0 },
    ]);
    expect(result.assetsTotal).toBe(14842124n);
    expect(result.debts).toEqual([{ key: "l", label: "신한 중도금 대출", amount: 111440000n, missing: 0 }]);
    expect(result.debtsTotal).toBe(111440000n);
  });

  it("does not double count a manual loan replaced by an imported one", () => {
    const result = assetBreakdown(
      [{ id: "m", kind: "loan", label: "옛 대출", amount: "100" }],
      [{ id: "i", label: "가져온 대출", outstandingPrincipalKrw: "90", includedInTotals: true, totalMode: "replacement", replacesManualAssetId: "m" }],
      []
    );
    expect(result.debts.map((part) => part.label)).toEqual(["가져온 대출"]);
    expect(result.debtsTotal).toBe(90n);
  });

  it("keeps an all-blank group as null instead of zero", () => {
    const result = assetBreakdown([{ id: "s", kind: "saving", label: "적금", amount: null }], [], []);
    expect(result.assets).toEqual([{ key: "saving", label: "적금", amount: null, missing: 1 }]);
    expect(result.assetsTotal).toBeNull();
    expect(result.debtsTotal).toBeNull();
  });
});
