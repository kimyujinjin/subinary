import { describe, expect, it } from "vitest";
import { initialTransactionMonth, transactionReviewPeriodQuery } from "./transaction-review-filter";

describe("review filter links and period persistence", () => {
  it("opens the complete review queue across months", () => {
    expect(initialTransactionMonth(new URLSearchParams("review=1"), "2026-10")).toBe("");
    expect(initialTransactionMonth(new URLSearchParams(), "2026-10")).toBe("2026-10");
  });
  it("respects an explicitly chosen period without losing review on reload", () => {
    for (const month of ["", "2026-09", "2026-10"]) {
      for (const review of [true, false]) {
        const query = transactionReviewPeriodQuery(month, review, "2026-10");
        expect(initialTransactionMonth(query, "2026-10")).toBe(month);
        expect(query.get("review") === "1").toBe(review);
      }
    }
  });
  it("keeps old empty month URLs and rejects invalid month values", () => {
    expect(initialTransactionMonth(new URLSearchParams("month="), "2026-10")).toBe("");
    expect(initialTransactionMonth(new URLSearchParams("month=2026-99"), "2026-10")).toBe("2026-10");
    expect(initialTransactionMonth(new URLSearchParams("month=2026-99&review=1"), "2026-10")).toBe("");
  });
});
