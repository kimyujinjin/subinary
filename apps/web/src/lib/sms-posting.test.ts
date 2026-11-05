import { describe, expect, it } from "vitest";
import { pollAcceptedPosting, postingConfirmed, postingMessage, shouldKeepUnpostedSummary, shouldPollPosting, smsPostingDisposition, todoSmsTaskText, type PostingStatus } from "./sms-posting";

const pending: PostingStatus = { parseStatus: "parsed", transactionType: "approval", posting: { status: "pending", transactionId: null, transactionStatus: null, reason: "processing" } };
const posted: PostingStatus = { ...pending, posting: { status: "posted", transactionId: "synthetic-id", transactionStatus: "approved", reason: null } };

describe("unposted list compatibility boundary", () => {
  it.each(["pending", "parse_failed", "quarantined", "pending_review"])("preserves legacy %s when posting metadata is absent", parseStatus => {
    expect(shouldKeepUnpostedSummary({ parseStatus })).toBe(true);
  });
  it.each(["parsed", "ignored", "unknown", ""])("does not guess that legacy %s is an unposted transaction", parseStatus => {
    expect(shouldKeepUnpostedSummary({ parseStatus })).toBe(false);
  });
  it.each(["pending", "needs_review"] as const)("keeps explicit %s even when an old parse projection says parsed", status => {
    expect(shouldKeepUnpostedSummary({ parseStatus: "parsed", posting: { ...pending.posting!, status } })).toBe(true);
  });
  it.each(["pending", "parse_failed", "quarantined", "pending_review"])("posted state overrides stale legacy %s", parseStatus => {
    expect(shouldKeepUnpostedSummary({ parseStatus, posting: { ...posted.posting!, transactionId: null } })).toBe(false);
  });
  it.each(["ignored", "declined", "unsupported_message"] as const)("does not revive explicit non-applicable %s as manual review", reason => {
    expect(shouldKeepUnpostedSummary({ parseStatus: "quarantined", posting: { ...pending.posting!, status: "not_applicable", reason } })).toBe(false);
  });
  it("does not fall back to a manual parse flag for an unrecognized explicit rejected state", () => {
    const rejected = { ...pending.posting!, status: "rejected" } as unknown as NonNullable<PostingStatus["posting"]>;
    expect(shouldKeepUnpostedSummary({ parseStatus: "parse_failed", posting: rejected })).toBe(false);
  });
});

describe("SMS posting feedback", () => {
  it("does not claim completion from parsing or an old server alone", () => {
    expect(postingConfirmed({ parseStatus: "parsed", transactionType: "approval" })).toBe(false);
    expect(postingMessage({ parseStatus: "parsed", transactionType: "approval" })).toContain("반영은 아직 확인되지 않았어요");
  });
  it("confirms only an actual linked transaction", () => {
    expect(postingConfirmed(posted)).toBe(true);
    expect(postingConfirmed({ ...posted, posting: { ...posted.posting!, transactionId: null } })).toBe(false);
  });
  it("explains review and duplicate states after a transaction exists", () => {
    expect(postingMessage({ ...posted, posting: { ...posted.posting!, transactionStatus: "pending_review" } })).toContain("확인이 필요");
    expect(postingMessage({ ...posted, posting: { ...posted.posting!, transactionStatus: "duplicate_suspected" } })).toContain("중복");
    expect(postingMessage({ ...posted, posting: { ...posted.posting!, transactionStatus: "pending_review" } })).toContain("가계부");
    expect(postingMessage({ ...posted, posting: { ...posted.posting!, transactionStatus: "duplicate_suspected" } })).not.toContain("할 일");
  });
  it("does not promise a date or automatic recovery for missing FX", () => {
    const detail = { ...pending, posting: { ...pending.posting!, reason: "fx_snapshot_missing" as const } };
    expect(shouldPollPosting(detail)).toBe(false);
    expect(postingMessage(detail)).toContain("반영되지 않았어요");
    expect(postingMessage(detail)).not.toContain("곧");
    expect(postingMessage(detail)).toContain("다시 등록하지 않아도 돼요");
    expect(postingMessage(detail)).not.toContain("할 일");
  });
  it.each(["parse_failed", "quarantined", "pending_review", "ignored"])("explains %s without claiming a posting", (parseStatus) => {
    expect(postingConfirmed({ parseStatus, transactionType: "approval" })).toBe(false);
    expect(postingMessage({ parseStatus, transactionType: "approval" })).not.toBe("거래에 반영됐어요.");
  });
  it("treats a declined message as non-spend", () => {
    expect(postingMessage({ parseStatus: "parsed", transactionType: "declined" })).toContain("지출에는 포함하지 않아요");
  });
  it("결제 실패 문자는 상태 이름 '결제 실패'로 말한다(문자 확인 창 토스트와 같은 말)", () => {
    const viaReason: PostingStatus = { parseStatus: "parsed", transactionType: "approval", posting: { status: "not_applicable", transactionId: null, transactionStatus: null, reason: "declined" } };
    for (const detail of [{ parseStatus: "parsed", transactionType: "declined" }, viaReason]) {
      expect(postingMessage(detail)).toBe("결제 실패 문자로 정리했어요. 지출에는 포함하지 않아요.");
      expect(postingMessage(detail)).not.toContain("거절");
    }
  });
  it("processing posting overrides a stale parsing review flag without asking for user approval", () => {
    const detail = { ...pending, parseStatus: "pending_review" };
    expect(smsPostingDisposition(detail)).toBe("processing");
    expect(postingMessage(detail)).toContain("반영하는 중");
    expect(postingMessage(detail)).not.toContain("할 일에서 확인");
  });
  it("preserves an explicit needs_review even when the parsed summary says success", () => {
    const detail = { ...pending, posting: { ...pending.posting!, status: "needs_review" as const, reason: "quarantined" as const } };
    expect(smsPostingDisposition(detail)).toBe("needs_review");
    expect(postingMessage(detail)).toContain("확인이 필요");
  });
  it("terminal posted/not-applicable states override stale review parse metadata", () => {
    expect(smsPostingDisposition({ ...posted, parseStatus: "parse_failed" })).toBe("posted");
    expect(smsPostingDisposition({ ...pending, parseStatus: "quarantined", posting: { ...pending.posting!, status: "not_applicable" } })).toBe("not_applicable");
    expect(postingMessage({ ...posted, parseStatus: "parse_failed", posting: { ...posted.posting!, transactionId: null } })).not.toContain("읽지 못했어요");
  });
  it("polls past parsed until the transaction exists", async () => {
    let reads = 0;
    const result = await pollAcceptedPosting(async () => ++reads === 1 ? pending : posted, async () => {});
    expect(reads).toBe(2);
    expect(result.detail).toEqual(posted);
  });
  it("limits polling and never re-ingests", async () => {
    let reads = 0;
    const result = await pollAcceptedPosting(async () => { reads++; return pending; }, async () => {}, 2);
    expect(reads).toBe(3);
    expect(postingConfirmed(result.detail)).toBe(false);
  });
  it("preserves acceptance when a status read fails", async () => {
    const result = await pollAcceptedPosting(async () => { throw Error("synthetic status timeout"); }, async () => {});
    expect(result).toEqual({ detail: null, statusUnavailable: true });
    expect(postingMessage(result.detail)).toContain("다시 등록하지 않아도");
  });
});

describe("할 일 화면의 문자 줄 부제", () => {
  it("이미 할 일 화면이라 '할 일에서 확인'으로 보내지 않고 할 동작을 말한다", () => {
    const readFailed: PostingStatus = { parseStatus: "parse_failed", transactionType: null };
    const prefilled: PostingStatus = { parseStatus: "quarantined", transactionType: "approval" };
    expect(todoSmsTaskText(readFailed)).toBe("받은 문자를 보고 금액·가맹점을 입력해 주세요");
    expect(todoSmsTaskText(prefilled)).toBe("금액·가맹점이 맞는지 확인해 주세요");
    expect(todoSmsTaskText(readFailed)).not.toContain("할 일");
    expect(todoSmsTaskText(prefilled)).not.toContain("할 일");
  });
  it("반영 상태가 '못 읽음'이면 옛 파싱 상태와 상관없이 직접 입력을 안내한다", () => {
    const detail = { ...pending, posting: { ...pending.posting!, status: "needs_review" as const, reason: "parse_failed" as const } };
    expect(todoSmsTaskText(detail)).toContain("입력해 주세요");
  });
  it("할 일 화면 밖(문자 붙여넣기)의 안내는 그대로 할 일 화면을 가리킨다", () => {
    expect(postingMessage({ parseStatus: "parse_failed", transactionType: null })).toContain("할 일에서 확인해 주세요");
    expect(postingMessage({ parseStatus: "quarantined", transactionType: "approval" })).toContain("할 일에서 확인해 주세요");
  });
  it("확인할 일이 아닌 상태는 반영 상태 문구를 그대로 쓴다", () => {
    expect(todoSmsTaskText(pending)).toBe(postingMessage(pending));
  });
});
