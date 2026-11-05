import { describe, expect, it } from "vitest";
import { TODO_SECTION_IDS } from "@/components/widgets/todo-counts";
import {
  HOME_TODO_ORDER,
  homeFxWaitRow,
  homeProcessingSource,
  homeProcessingText,
  homeTodoRows,
  homeTodoSources,
  manualKrwText,
  visibleReviewCount,
  type HomeTodoCountsInput,
} from "./home-finance-summary";

const known = (count: number, truncated = false) => ({ count, loading: false, error: false, truncated });
const items = (n: number) => Array.from({ length: n }, (_, index) => index);
type WaitReason = "parsing" | "processing" | "fx_snapshot_missing";
/** 처리 대기 문자 한 건(반영 상태만). 사유가 없으면 반영 상태를 주지 않는 옛 API 응답이다. */
const wait = (reason?: WaitReason): HomeTodoCountsInput["processing"][number] => ({
  posting: reason ? { status: "pending", reason, transactionId: null, transactionStatus: null } : undefined,
});
const waits = (n: number, reason?: WaitReason) => Array.from({ length: n }, () => wait(reason));
const todo = (over: Partial<HomeTodoCountsInput> = {}): HomeTodoCountsInput => ({
  declines: [], declinesLoading: false, declinesError: false,
  reviews: [], reviewsLoading: false, reviewsError: false, reviewsTruncated: false,
  sms: [], smsLoading: false, smsError: false, smsTruncated: false,
  unpostedNeedsReview: [], unpostedLoading: false, unpostedError: false, unpostedTruncated: false,
  processing: [], processingLoading: false, processingError: false, processingTruncated: false,
  ...over,
});

describe("home to-do rows", () => {
  it("uses the to-do screen order and links every row to its own to-do section, never a month", () => {
    expect(HOME_TODO_ORDER).toEqual(["declines", "requests", "reviews", "sms"]);
    const rows = homeTodoRows({ reviews: known(1), sms: known(1), requests: known(1), declines: known(1) });
    expect(rows.map((row) => row.key)).toEqual(["declines", "requests", "reviews", "sms"]);
    for (const row of rows) {
      expect(row.href).toBe(`/todo?section=${row.key}`);
      expect(TODO_SECTION_IDS).toContain(row.key);
      expect(row.href).not.toMatch(/month|status|q=/);
    }
  });

  it("hides zero, loading, failed and missing axes instead of turning unknown into zero", () => {
    expect(homeTodoRows({})).toEqual([]);
    expect(homeTodoRows({
      declines: known(0),
      requests: { ...known(2), loading: true },
      sms: { ...known(3), error: true },
      reviews: known(Number.NaN),
    })).toEqual([]);
  });

  it("marks a scan-limited count with + and labels each row in short Korean", () => {
    const rows = homeTodoRows({ declines: known(2), requests: known(1), sms: known(100, true), reviews: known(1234, true) });
    expect(rows.map((row) => row.text)).toEqual([
      "결제 실패 2건",
      "가족이 물어본 결제 1건",
      "확인할 거래 1,234+건",
      "확인할 문자 100+건",
    ]);
  });

  it("counts SMS as both review sources together, and only when both are known", () => {
    const sources = homeTodoSources(todo({ sms: items(2), unpostedNeedsReview: items(3) }));
    expect(sources.sms).toEqual({ count: 5, loading: false, error: false, truncated: false });
    expect(homeTodoSources(todo({ sms: items(2), unpostedLoading: true })).sms?.loading).toBe(true);
    expect(homeTodoSources(todo({ sms: items(2), unpostedError: true })).sms?.error).toBe(true);
    expect(homeTodoSources(todo({ sms: items(2), smsError: true })).sms?.error).toBe(true);
    expect(homeTodoSources(todo({ sms: items(2), unpostedTruncated: true })).sms?.truncated).toBe(true);
  });

  it("passes family requests through as their own axis without mixing them into to-do counts", () => {
    const requests = known(4);
    const sources = homeTodoSources(todo({ declines: items(1) }), requests);
    expect(sources.requests).toBe(requests);
    expect(homeTodoSources(todo()).requests).toBeUndefined();
  });
});

describe("home processing status", () => {
  it("states automatic waits as a fact, with + when scan-limited", () => {
    expect(homeProcessingText(homeProcessingSource(todo({ processing: waits(3, "processing") })))).toBe("문자 3건을 거래에 반영하는 중이에요");
    expect(homeProcessingText(homeProcessingSource(todo({ processing: waits(100, "parsing"), processingTruncated: true })))).toBe("문자 100+건을 거래에 반영하는 중이에요");
    // 반영 상태가 없는 옛 응답(파싱 대기)은 환율 대기로 짐작하지 않는다.
    expect(homeProcessingText(homeProcessingSource(todo({ processing: waits(2) })))).toBe("문자 2건을 거래에 반영하는 중이에요");
  });

  it("says nothing when there is no wait or the wait count is unknown", () => {
    expect(homeProcessingText(undefined)).toBeNull();
    expect(homeProcessingText(known(0))).toBeNull();
    expect(homeProcessingText(homeProcessingSource(todo({ processing: waits(3, "processing"), processingLoading: true })))).toBeNull();
    expect(homeProcessingText(homeProcessingSource(todo({ processing: waits(3, "processing"), processingError: true })))).toBeNull();
  });

  it("splits FX-stalled SMS from SMS being posted instead of calling both 'posting'", () => {
    const source = homeProcessingSource(todo({
      processing: [wait("processing"), wait("fx_snapshot_missing"), wait("parsing"), wait("fx_snapshot_missing"), wait("fx_snapshot_missing")],
    }));
    expect(source).toMatchObject({ count: 2, fxMissing: 3 });
    expect(homeProcessingText(source)).toBe("문자 2건을 거래에 반영하는 중이에요");
    expect(homeFxWaitRow(source)).toEqual({
      text: "문자 3건은 그날 환율이 없어 아직 반영하지 못했어요",
      href: "/todo?section=processing",
    });
  });

  it("does not claim FX-stalled SMS are being posted when every wait is an FX wait", () => {
    const source = homeProcessingSource(todo({ processing: waits(2, "fx_snapshot_missing") }));
    expect(homeProcessingText(source)).toBeNull();
    expect(homeFxWaitRow(source)?.text).toBe("문자 2건은 그날 환율이 없어 아직 반영하지 못했어요");
    expect(homeFxWaitRow(homeProcessingSource(todo({ processing: waits(2, "processing") })))).toBeNull();
  });

  it("marks a scan-limited FX count with + and hides it while the count is unknown", () => {
    const fx = waits(100, "fx_snapshot_missing");
    expect(homeFxWaitRow(homeProcessingSource(todo({ processing: fx, processingTruncated: true })))?.text).toBe("문자 100+건은 그날 환율이 없어 아직 반영하지 못했어요");
    expect(homeFxWaitRow(homeProcessingSource(todo({ processing: fx, processingLoading: true })))).toBeNull();
    expect(homeFxWaitRow(homeProcessingSource(todo({ processing: fx, processingError: true })))).toBeNull();
    expect(homeFxWaitRow(undefined)).toBeNull();
    // fxMissing을 주지 않는 원천(예전 HomeCountSource)은 환율 대기 0건이다.
    expect(homeFxWaitRow(known(3))).toBeNull();
  });

  it("keeps FX waits out of the to-do rows", () => {
    expect(homeTodoRows(homeTodoSources(todo({ processing: waits(4, "fx_snapshot_missing") })))).toEqual([]);
  });
});

describe("home record summaries", () => {

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
});
