import { describe, expect, it } from "vitest";
import { HOME_REVIEW_HREF, manualDateText, manualKrwText, visibleReviewCount } from "./home-finance-summary";

describe("home record summaries", () => {
  it("keeps review navigation independent from the visible month and old list filters", () => {
    expect(HOME_REVIEW_HREF).toBe("/transactions?review=1");
    expect(HOME_REVIEW_HREF).not.toMatch(/month|status|q=/);
  });

  it("requires a known positive review count instead of showing an empty or failed inbox", () => {
    expect(visibleReviewCount({ count: 0, loading: false, error: false })).toBeNull();
    expect(visibleReviewCount({ count: 2, loading: true, error: false })).toBeNull();
    expect(visibleReviewCount({ count: 2, loading: false, error: true })).toBeNull();
    expect(visibleReviewCount({ count: Number.NaN, loading: false, error: false })).toBeNull();
    expect(visibleReviewCount({ count: 2, loading: false, error: false })).toBe(2);
  });

  it("displays unknown manual amounts as unknown and preserves explicit zero", () => {
    expect(manualKrwText(null)).toBe("— 원");
    expect(manualKrwText(undefined)).toBe("— 원");
    expect(manualKrwText("")).toBe("— 원");
    expect(manualKrwText("1e9")).toBe("— 원");
    expect(manualKrwText("0")).toBe("0원");
  });

  it("never loses decimal-string precision beyond the safe integer limit", () => {
    expect(manualKrwText("90071992547409931234")).toBe("90,071,992,547,409,931,234원");
    expect(manualKrwText("-90071992547409931234")).toBe("-90,071,992,547,409,931,234원");
  });

  it("does not invent today or shift the stored calendar day", () => {
    expect(manualDateText(null)).toBe("미입력");
    expect(manualDateText("2026-11-01")).toBe("2026-11-01");
    expect(manualDateText("not-a-date")).toBe("미입력");
    expect(manualDateText("2026-02-31")).toBe("미입력");
    expect(manualDateText("2026-10-00")).toBe("미입력");
  });
});
