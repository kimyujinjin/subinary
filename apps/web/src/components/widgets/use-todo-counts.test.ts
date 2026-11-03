import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardSmsEventSummary } from "@family/contracts";
import { useTodoCounts } from "./use-todo-counts";

const hooks = vi.hoisted(() => ({ useDeclineList: vi.fn(), useTransactions: vi.fn(), useCardSmsReviewInbox: vi.fn(), useUnpostedSms: vi.fn() }));
vi.mock("@/lib/queries", () => ({ REVIEW_SCAN_LIMIT: 100, ...hooks }));
vi.mock("react", () => ({ useMemo: (factory: () => unknown) => factory() }));
const query = (data?: unknown, extra = {}) => ({ data, isLoading: false, isError: false, ...extra });
const event = (id: string, status: "needs_review" | "pending"): CardSmsEventSummary => ({
  id, eventId: id, sender: "synthetic-sender", receivedAt: "2026-10-01T00:00:00Z", parseStatus: status === "needs_review" ? "quarantined" : "parsed",
  transactionType: "approval", posting: { status, reason: status === "needs_review" ? "quarantined" : "fx_snapshot_missing", transactionId: null, transactionStatus: null },
  issuer: null, amount: null, currency: "USD", merchantRaw: null, occurredAt: null, installmentMonths: null, confidence: null, parseError: null, createdAt: "2026-10-01T00:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useDeclineList.mockReturnValue(query({ items: [] }));
  hooks.useTransactions.mockReturnValue(query({ items: [], nextCursor: null }));
  hooks.useCardSmsReviewInbox.mockReturnValue(query([]));
  hooks.useUnpostedSms.mockReturnValue(query([]));
});

describe("useTodoCounts query wiring", () => {
  it("requests one all-review union and preserves its truncation marker", () => {
    hooks.useTransactions.mockReturnValue(query({ items: [], nextCursor: "next-review" }));
    const result = useTodoCounts({ refetchInterval: 30_000 });
    expect(hooks.useTransactions).toHaveBeenCalledExactlyOnceWith({ review: "1", limit: 100 }, { refetchInterval: 30_000 });
    expect(result.reviewsTruncated).toBe(true);
  });
  it("counts genuine SMS review once across queries and exposes automatic waits separately", () => {
    hooks.useCardSmsReviewInbox.mockReturnValue(query([event("same", "needs_review")]));
    hooks.useUnpostedSms.mockReturnValue(query([event("same", "needs_review"), event("extra", "needs_review"), event("fx", "pending")]));
    const result = useTodoCounts();
    expect(result.total).toBe(2);
    expect(result.sms.map(row => row.id)).toEqual(["same"]);
    expect(result.unpostedNeedsReview.map(row => row.id)).toEqual(["extra"]);
    expect(result.processing.map(row => row.id)).toEqual(["fx"]);
  });
  it("retains status read failures and loading rather than declaring zero waits confirmed", () => {
    hooks.useUnpostedSms.mockReturnValue(query(undefined, { isLoading: true, isError: true }));
    const result = useTodoCounts();
    expect(result.total).toBe(0);
    expect(result.processingLoading).toBe(true);
    expect(result.processingError).toBe(true);
    expect(result.unpostedError).toBe(true);
  });
  it("keeps a raw scan limit marker although automatic waits are outside the task total", () => {
    hooks.useUnpostedSms.mockReturnValue(query(Array.from({ length: 100 }, (_, index) => event(`wait-${index}`, "pending"))));
    const result = useTodoCounts();
    expect(result.total).toBe(0);
    expect(result.processing).toHaveLength(100);
    expect(result.processingTruncated).toBe(true);
  });
});
