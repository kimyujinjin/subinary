import { QueryClient } from "@tanstack/react-query";
import type { CardSummary } from "@family/contracts";
import { describe, expect, it, vi } from "vitest";
import { acceptsLast4Insertion, canCorrectCardLast4, cardLast4, correctionError, correctionRequest, createCardCorrectionReadGate, hasUnknownCardLast4, writeCorrectedCard } from "./card-last4-correction";
import { createTransactionEditSession } from "./transaction-edit";
import { dispatchTransactionDetailBack, registerTransactionDetailBack } from "./transaction-detail-back";

const card = { id: "synthetic-card", householdId: "synthetic-family", ownerMemberId: "synthetic-owner", alias: "합성 카드", issuer: "합성", maskedNumber: "1234" } as CardSummary;
vi.mock("./native", () => ({ isNative: () => false }));

describe("card last4 correction boundary", () => {
  it.each(["", "123", "12345", "4111111111111111", "12 34", "１２３４", "١٢٣٤", "1e03", "••••1234"])("rejects %j without truncating or filtering", (draft) => {
    expect(correctionRequest(draft, "5678").ok).toBe(false);
  });
  it("preserves leading zeroes, captures the old key, and sends only two allowed fields", () => {
    expect(correctionRequest("0012", "1234")).toEqual({ ok: true, body: { last4: "0012", expectedLast4: "1234" } });
    expect(correctionRequest("0000", null)).toEqual({ ok: true, body: { last4: "0000", expectedLast4: null } });
    expect(correctionRequest("1234", "1234").ok).toBe(false);
    expect(correctionRequest("0012", "4111111111111111").ok).toBe(false);
  });
  it("reads masked historical formats but never derives last4 from a full PAN", () => {
    expect(cardLast4("•••• 0012")).toBe("0012");
    expect(cardLast4("****1234")).toBe("1234");
    expect(cardLast4(null)).toBeNull();
    expect(cardLast4("4111111111111111")).toBeNull();
    expect(hasUnknownCardLast4(null)).toBe(false);
    expect(hasUnknownCardLast4("****1234")).toBe(false);
    expect(hasUnknownCardLast4("4111111111111111")).toBe(true);
    expect(hasUnknownCardLast4("")).toBe(true);
  });
  it("rejects a full PAN paste before maxlength could silently truncate it", () => {
    expect(acceptsLast4Insertion("", "4111111111111111")).toBe(false);
    expect(acceptsLast4Insertion("12", "5678")).toBe(false);
    expect(acceptsLast4Insertion("1234", "0007", 0, 4)).toBe(true);
    expect(acceptsLast4Insertion("12", "34")).toBe(true);
    expect(acceptsLast4Insertion("", "１２３４")).toBe(false);
  });
  it("shows the action only for the owner or a household owner/admin", () => {
    expect(canCorrectCardLast4(card, "synthetic-owner", "member")).toBe(true);
    expect(canCorrectCardLast4(card, "other", "owner")).toBe(true);
    expect(canCorrectCardLast4(card, "other", "admin")).toBe(true);
    expect(canCorrectCardLast4(card, "other", "member")).toBe(false);
    expect(canCorrectCardLast4(card, null, undefined)).toBe(false);
  });
  it("provides safe conflict, permission and network errors instead of server payload text", () => {
    expect(correctionError({ status: 409, message: "synthetic private" }).refresh).toBe(true);
    expect(correctionError({ status: 403 }).message).toContain("권한");
    expect(correctionError(new TypeError("synthetic network")).message).toContain("입력은 그대로");
    expect(correctionError({ status: 409, body: { private: "SYNTHETIC_MARKER" } }).message).not.toContain("SYNTHETIC_MARKER");
    expect(correctionError({ status: 409, body: { code: "card_last4_stale" } }).message).toContain("변경");
    expect(correctionError({ status: 409, body: { code: "card_last4_conflict" } }).message).toContain("활성 카드");
    expect(correctionError({ status: 409, serverMessage: "card_last4_stale" }).message).toContain("변경");
    expect(correctionError({ status: 409, serverMessage: "duplicate card" }).message).toContain("활성 카드");
    expect(correctionError({ status: 409, serverMessage: "같은 조건으로 자동 연결되는 카드가 이미 있어요. 카드 목록을 확인해 주세요." }).message).toContain("활성 카드");
    expect(correctionError({ status: 409, serverMessage: "카드 정보가 변경됐거나 번호를 확인할 수 없어요. 카드 목록을 다시 확인해 주세요." }).message).toContain("변경");
  });
  it("calls only the dedicated endpoint and strips unrelated owner/alias fields before transport", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://synthetic.invalid");
    const fetch = vi.fn(async () => new Response(JSON.stringify(card), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      const { api } = await import("./api-client");
      const body = { last4: "0012", expectedLast4: "1234", ownerMemberId: "must-not-send", alias: "must-not-send" };
      await api.cards.correctLast4("synthetic-token", "synthetic/card", body);
      const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://synthetic.invalid/v1/cards/synthetic%2Fcard/last4");
      expect(options.method).toBe("PATCH");
      expect(JSON.parse(String(options.body))).toEqual({ last4: "0012", expectedLast4: "1234" });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});

describe("household cache and correction lifecycle", () => {
  it("requires a current-state read for network/500 results while keeping ordinary 400/403 errors editable", () => {
    for (const failure of [new TypeError("synthetic lost response"), { status: 500 }]) {
      expect(correctionError(failure)).toMatchObject({ refresh: true, readRequired: true });
      expect(correctionError(failure).message).toContain("다시 보내기 전에");
    }
    expect(correctionError({ status: 400 }).readRequired).not.toBe(true);
    expect(correctionError({ status: 403 }).readRequired).not.toBe(true);
  });
  it("keeps the resubmit gate locked through draft edits and failed reads until a successful GET confirms state", () => {
    const gate = createCardCorrectionReadGate();
    gate.failed(new TypeError("synthetic lost response"));
    expect(gate.required).toBe(true);
    expect(correctionRequest("0012", "1234").ok).toBe(true);
    expect(gate.required).toBe(true);
    gate.failed({ status: 403 }); expect(gate.required).toBe(true);
    gate.failed({ status: 500 }); expect(gate.required).toBe(true);
    gate.confirmed(); expect(gate.required).toBe(false);
  });
  it("writes the confirmed result to the original household only and invalidates its labels", () => {
    const qc = new QueryClient();
    const updated = { ...card, maskedNumber: "0012" };
    qc.setQueryData(["cards", card.householdId], [card]);
    qc.setQueryData(["cards", "other-household"], [card]);
    qc.setQueryData(["analytics", "cards", card.householdId], {});
    qc.setQueryData(["analytics", "cards", "other-household"], {});
    writeCorrectedCard(qc, updated);
    expect(qc.getQueryData(["cards", card.householdId])).toEqual([updated]);
    expect(qc.getQueryData(["cards", "other-household"])).toEqual([card]);
    expect(qc.getQueryState(["analytics", "cards", card.householdId])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["analytics", "cards", "other-household"])?.isInvalidated).toBe(false);
    qc.clear();
  });
  it("locks repeated submissions, preserves a failed draft, and allows retry", async () => {
    const session = createTransactionEditSession();
    let reject!: (reason: unknown) => void;
    const request = vi.fn(() => new Promise<CardSummary>((_resolve, no) => { reject = no; }));
    const draft = "0012";
    const failure = vi.fn();
    const pending = session.save(request, vi.fn(), failure);
    expect(await session.save(request, vi.fn(), failure)).toBe("busy");
    reject({ status: 409 }); expect(await pending).toBe("failed");
    expect(request).toHaveBeenCalledTimes(1);
    expect(draft).toBe("0012"); expect(failure).toHaveBeenCalledWith({ status: 409 });
    expect(await session.save(async () => card, vi.fn(), failure)).toBe("saved");
  });
  it("cleans up native back and ignores a late response after browser/household navigation", async () => {
    const target = new EventTarget(); const session = createTransactionEditSession();
    let resolve!: (value: CardSummary) => void;
    const saved = vi.fn();
    const pending = session.save(() => new Promise<CardSummary>((yes) => { resolve = yes; }), saved, vi.fn());
    const cleanup = registerTransactionDetailBack(target, (source) => { if (source === "browser") session.invalidate(); });
    expect(dispatchTransactionDetailBack(target)).toBe(false);
    target.dispatchEvent(new Event("popstate")); cleanup(); session.invalidate();
    resolve(card); expect(await pending).toBe("stale"); expect(saved).not.toHaveBeenCalled();
    expect(dispatchTransactionDetailBack(target)).toBe(true);
  });
});
