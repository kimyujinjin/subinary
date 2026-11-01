import { describe, expect, it } from "vitest";

import { activeTabFor, isTabRoot, isUnder, normalizePath, parentTabHref, PRIMARY_TABS, TAB_ROOTS } from "./nav-tabs";

describe("path boundaries", () => {
  it("normalizes Capacitor trailing slashes without changing root", () => {
    expect(normalizePath("/more/privacy/")).toBe("/more/privacy");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  it("does not classify unrelated prefix matches", () => {
    expect(isUnder("/more/privacy", "/more")).toBe(true);
    expect(isUnder("/ai-operations", "/ai")).toBe(false);
    for (const path of ["/assets-archive", "/plans", "/transactions-archive", "/unknown"]) {
      expect(activeTabFor(path)).toBeNull();
    }
  });
});

describe("V2 primary destinations", () => {
  it("keeps the agreed order, routes and labels", () => {
    expect(PRIMARY_TABS.map(({ href, label }) => [href, label])).toEqual([
      ["/dashboard", "홈"], ["/assets", "자산"], ["/transactions", "가계부"],
      ["/plan", "계획"], ["/more", "전체"],
    ]);
    expect(TAB_ROOTS).toHaveLength(5);
    for (const tab of PRIMARY_TABS) {
      expect(activeTabFor(tab.href)).toBe(tab.key);
      expect(isTabRoot(tab.href + "/")).toBe(true);
    }
  });

  it.each([
    ["/cards", "assets"], ["/cards/abc/", "assets"], ["/assets/accounts", "assets"],
    ["/budgets", "ledger"], ["/ledger/analysis/", "ledger"], ["/transactions/abc", "ledger"],
    ["/plan/housing", "plan"], ["/plan/funding/", "plan"],
    ["/todo", "more"], ["/declines", "more"], ["/ai/", "more"],
    ["/ai-operations", "more"], ["/play/app/", "more"], ["/household", "more"],
    ["/devices", "more"], ["/categories", "more"], ["/notifications", "more"],
    ["/more/merchants", "more"], ["/more/recurring", "more"],
    ["/more/category-rules", "more"], ["/more/privacy/", "more"],
    ["/more/notifications", "more"], ["/more/password", "more"],
  ])("preserves legacy route %s under %s", (path, expected) => {
    expect(activeTabFor(path)).toBe(expected);
    expect(isTabRoot(path)).toBe(false);
  });
});

describe("cold-entry parent destinations", () => {
  it("keeps failed payments inside their existing task flow", () => {
    expect(parentTabHref("/declines/")).toBe("/todo");
    expect(parentTabHref("/todo")).toBe("/more");
  });

  it("all legacy subpages reach a primary destination without a loop", () => {
    for (const path of ["/declines", "/cards", "/budgets", "/ledger/analysis", "/todo", "/ai", "/more/privacy", "/plan/housing"]) {
      const visited = new Set<string>();
      let current = path;
      while (!isTabRoot(current)) {
        expect(visited.has(current)).toBe(false);
        visited.add(current);
        current = parentTabHref(current);
      }
      expect(visited.size).toBeLessThanOrEqual(2);
    }
  });

  it("unknown cold-entry routes have a safe existing fallback", () => {
    expect(parentTabHref("/unknown")).toBe("/dashboard");
  });
});
