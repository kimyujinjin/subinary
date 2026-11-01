import { describe, expect, it } from "vitest";

import { ledgerNavItems } from "./ledger-nav";

describe("ledger navigation", () => {
  it("uses existing transaction and budget URLs with the new analysis destination", () => {
    expect(ledgerNavItems().map(({ href }) => href)).toEqual(["/transactions", "/ledger/analysis", "/budgets"]);
  });

  it("preserves the same selected month across all three sections", () => {
    for (const item of ledgerNavItems("2026-07")) {
      const url = new URL(item.href, "https://example.test");
      expect([...url.searchParams.entries()]).toEqual([["month", "2026-07"]]);
    }
  });

  it.each(["", "2026-00", "2026-13", "2026-7", "2026-07&txn=other", "2026-07?q=private"])("rejects malformed month %s instead of propagating detail/search state", (month) => {
    expect(ledgerNavItems(month).every(({ href }) => !href.includes("?"))).toBe(true);
  });
});
