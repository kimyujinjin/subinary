import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardSmsDeclineGroup, CardSmsEventSummary, TransactionSummary } from "@family/contracts";
import { homeFxWaitRow, homeProcessingSource, homeProcessingText, homeTodoRows, homeTodoSources } from "@/lib/home-finance-summary";
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

const decline = (merchant: string, over: Partial<CardSmsDeclineGroup> = {}): CardSmsDeclineGroup => ({
  merchant, amount: 9_900, currency: "KRW", reason: null, issuer: null, maskedCardNumber: null, attempts: 1,
  firstAttemptAt: "2026-10-01T00:00:00Z", lastAttemptAt: "2026-10-01T00:00:00Z", resolvedAt: null, dismissedAt: null, ...over,
});
const txn = (id: string, status: TransactionSummary["status"]): TransactionSummary => ({
  id, householdId: "h1", memberId: "m1", cardId: null, transactionType: "approval", status, amount: 1_000, cancelledAmount: 0, netAmount: 1_000,
  currency: "KRW", originalAmount: null, originalCurrency: null, exchangeRate: null, merchantRaw: null, merchantNormalized: null, categoryId: null,
  categorySlug: null, approvedAt: "2026-10-01T00:00:00Z", cancelledAt: null, installmentMonths: null, parentTransactionId: null, visibility: "household",
  memo: null, masked: false, excludedAt: null, createdAt: "2026-10-01T00:00:00Z",
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
  it("gives home rows the same total as the to-do screen, leaving out family requests and automatic waits", () => {
    hooks.useDeclineList.mockReturnValue(query({ items: [decline("a"), decline("b"), decline("done", { resolvedAt: "2026-10-02T00:00:00Z" })] }));
    hooks.useTransactions.mockReturnValue(query({ items: [txn("r1", "pending_review"), txn("r2", "duplicate_suspected"), txn("ok", "approved")], nextCursor: null }));
    hooks.useCardSmsReviewInbox.mockReturnValue(query([event("same", "needs_review"), event("inbox", "needs_review")]));
    hooks.useUnpostedSms.mockReturnValue(query([event("same", "needs_review"), event("extra", "needs_review"), event("fx", "pending")]));
    const result = useTodoCounts();
    const rows = homeTodoRows(homeTodoSources(result, { count: 5, loading: false, error: false }));
    expect(rows.map((row) => [row.key, row.count])).toEqual([["declines", 2], ["requests", 5], ["reviews", 2], ["sms", 3]]);
    const homeTodoSum = rows.filter((row) => row.key !== "requests").reduce((sum, row) => sum + row.count, 0);
    expect(result.total).toBe(7);
    expect(homeTodoSum).toBe(result.total);
    // 대기 문자(fx)는 환율이 없어 멈춘 것이라 '반영하는 중'이라고 하지 않고, 할 일 합계 밖의 줄로만 나온다.
    const processing = homeProcessingSource(result);
    expect(homeProcessingText(processing)).toBeNull();
    expect(homeFxWaitRow(processing)).toEqual({
      text: "문자 1건은 그날 환율이 없어 아직 반영하지 못했어요",
      href: "/todo?section=processing",
    });
  });
  it("splits automatic waits into SMS being posted and FX-stalled SMS for the home", () => {
    const posting: CardSmsEventSummary = {
      ...event("post", "pending"),
      posting: { status: "pending", reason: "processing", transactionId: null, transactionStatus: null },
    };
    hooks.useUnpostedSms.mockReturnValue(query([posting, event("fx", "pending")]));
    const result = useTodoCounts();
    expect(result.total).toBe(0);
    const processing = homeProcessingSource(result);
    expect(homeProcessingText(processing)).toBe("문자 1건을 거래에 반영하는 중이에요");
    expect(homeFxWaitRow(processing)?.text).toBe("문자 1건은 그날 환율이 없어 아직 반영하지 못했어요");
  });
  it("keeps a raw scan limit marker although automatic waits are outside the task total", () => {
    hooks.useUnpostedSms.mockReturnValue(query(Array.from({ length: 100 }, (_, index) => event(`wait-${index}`, "pending"))));
    const result = useTodoCounts();
    expect(result.total).toBe(0);
    expect(result.processing).toHaveLength(100);
    expect(result.processingTruncated).toBe(true);
  });
});
