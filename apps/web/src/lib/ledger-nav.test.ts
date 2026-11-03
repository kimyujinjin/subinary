import { describe, expect, it } from "vitest";

import { ledgerNavItems } from "./ledger-nav";

describe("ledger navigation", () => {
  it("uses existing transaction, budget and task URLs with the analysis destination", () => {
    expect(ledgerNavItems().map(({ href }) => href)).toEqual([
      "/transactions",
      "/ledger/analysis",
      "/budgets",
      "/todo",
    ]);
  });

  it("preserves the same selected month across the month-scoped sections", () => {
    for (const item of ledgerNavItems("2026-07").filter(
      ({ key }) => key !== "todo"
    )) {
      const url = new URL(item.href, "https://example.test");
      expect([...url.searchParams.entries()]).toEqual([["month", "2026-07"]]);
    }
  });

  it("keeps the task backlog on every period instead of the selected month", () => {
    // 월을 실으면 지난달에 밀린 문자가 화면에서 사라진다 — `/todo`가 해결한 바로 그 문제다.
    expect(
      ledgerNavItems("2026-07").find(({ key }) => key === "todo")?.href
    ).toBe("/todo");
  });

  it.each([
    "",
    "2026-00",
    "2026-13",
    "2026-7",
    "2026-07&txn=other",
    "2026-07?q=private",
  ])(
    "rejects malformed month %s instead of propagating detail/search state",
    (month) => {
      expect(
        ledgerNavItems(month).every(({ href }) => !href.includes("?"))
      ).toBe(true);
    }
  );
});
