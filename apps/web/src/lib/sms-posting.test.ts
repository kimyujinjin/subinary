import { describe, expect, it } from "vitest";
import { pollAcceptedPosting, postingConfirmed, postingMessage, shouldPollPosting, type PostingStatus } from "./sms-posting";

const pending: PostingStatus = { parseStatus: "parsed", transactionType: "approval", posting: { status: "pending", transactionId: null, transactionStatus: null, reason: "processing" } };
const posted: PostingStatus = { ...pending, posting: { status: "posted", transactionId: "synthetic-id", transactionStatus: "approved", reason: null } };

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
  });
  it("does not promise a date or automatic recovery for missing FX", () => {
    const detail = { ...pending, posting: { ...pending.posting!, reason: "fx_snapshot_missing" as const } };
    expect(shouldPollPosting(detail)).toBe(false);
    expect(postingMessage(detail)).toContain("반영되지 않았어요");
    expect(postingMessage(detail)).not.toContain("곧");
  });
  it.each(["parse_failed", "quarantined", "pending_review", "ignored"])("explains %s without claiming a posting", (parseStatus) => {
    expect(postingConfirmed({ parseStatus, transactionType: "approval" })).toBe(false);
    expect(postingMessage({ parseStatus, transactionType: "approval" })).not.toBe("거래에 반영됐어요.");
  });
  it("treats a declined message as non-spend", () => {
    expect(postingMessage({ parseStatus: "parsed", transactionType: "declined" })).toContain("지출에는 포함하지 않아요");
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
    expect(postingMessage(result.detail)).toContain("다시 등록하지 말고");
  });
});
