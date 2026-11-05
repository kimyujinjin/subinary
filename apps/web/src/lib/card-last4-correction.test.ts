import { MutationObserver, onlineManager, QueryClient } from "@tanstack/react-query";
import type { CardSummary } from "@family/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { acceptsLast4Insertion, assertCardCorrectionReady, beginCardCorrectionRead, canCorrectCardLast4, CardCorrectionPendingError, CardCorrectionReadRequiredError, cardCorrectionIsPending, cardCorrectionRequiresRead, cardLast4, cardLast4MutationOptions, correctionError, correctionRequest, createCardCorrectionReadGate, hasUnknownCardLast4, markCardCorrectionUncertain, subscribeCardCorrectionState, writeCorrectedCard } from "./card-last4-correction";
import { createTransactionEditSession } from "./transaction-edit";
import { dispatchTransactionDetailBack, registerTransactionDetailBack } from "./transaction-detail-back";
import { cardLast4DiscardDescription } from "@/components/card-last4-correction-dialog";

const ownerId = "11111111-1111-4111-8111-111111111111";
const card = { id: "synthetic-card", householdId: "synthetic-family", ownerMemberId: ownerId, alias: "합성 카드", issuer: "합성", maskedNumber: "1234" } as CardSummary;
vi.mock("./native", () => ({ isNative: () => false }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("card last4 correction boundary", () => {
  it.each([[true, false], [false, true], [true, true]])("does not claim an uncertain remote request was unsaved when closing (%s/%s)", (globalRead, localRead) => {
    const message = cardLast4DiscardDescription(globalRead, localRead);
    expect(message).toContain("입력한 내용은 닫으면 사라져요");
    expect(message).toContain("정정이 반영됐는지는 다시 열어 '카드 정보 다시 불러오기'로 확인해 주세요");
    expect(message).not.toContain("저장되지 않아요");
  });
  it("names the discard confirm buttons like the other discard confirms: '계속 입력하기' stays, '버리기' discards", () => {
    // 확인 시트는 상태로 열려 node에서 그릴 수 없다 — 소스를 직접 확인한다.
    const source = readFileSync(join(process.cwd(), "src/components/card-last4-correction-dialog.tsx"), "utf8");
    expect(source).toContain("<AlertDialogCancel>계속 입력하기</AlertDialogCancel>");
    expect(source).toMatch(/<AlertDialogAction variant="destructive"[^\n]*?>버리기<\/AlertDialogAction>/);
    expect(source).not.toContain("버리고 닫기");
    expect(source).not.toMatch(/<AlertDialogCancel>\s*닫기\s*</);
  });
  it("retains the ordinary unsent-draft cancellation meaning", () => {
    expect(cardLast4DiscardDescription(false, false)).toBe("입력한 뒤 4자리는 저장되지 않아요.");
  });
  it.each(["", "123", "12345", "4111111111111111", "12 34", "１２３４", "١٢٣٤", "1e03", "••••1234"])("rejects %j without truncating or filtering", (draft) => {
    expect(correctionRequest(draft, "5678", ownerId).ok).toBe(false);
  });
  it("preserves leading zeroes and captures both the displayed old number and owner", () => {
    expect(correctionRequest("0012", "1234", ownerId)).toEqual({ ok: true, body: { last4: "0012", expectedLast4: "1234", expectedOwnerMemberId: ownerId } });
    expect(correctionRequest("0000", null, ownerId)).toEqual({ ok: true, body: { last4: "0000", expectedLast4: null, expectedOwnerMemberId: ownerId } });
    expect(correctionRequest("1234", "1234", ownerId).ok).toBe(false);
    expect(correctionRequest("0012", "4111111111111111", ownerId).ok).toBe(false);
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
    expect(canCorrectCardLast4(card, ownerId, "member")).toBe(true);
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
    expect(correctionError({ status: 409, body: { code: "card_last4_stale" } }).message).toContain("확인하지 못");
    expect(correctionError({ status: 409, body: { code: "card_last4_conflict" } }).message).toContain("활성 카드");
    expect(correctionError({ status: 409, serverMessage: "card_last4_stale" }).message).toContain("확인하지 못");
    expect(correctionError({ status: 409, serverMessage: "duplicate card" }).message).toContain("활성 카드");
    expect(correctionError({ status: 409, serverMessage: "같은 조건으로 자동 연결되는 카드가 이미 있어요. 카드 목록을 확인해 주세요." }).message).toContain("활성 카드");
    expect(correctionError({ status: 409, serverMessage: "카드 정보가 변경됐거나 번호를 확인할 수 없어요. 카드 목록을 다시 확인해 주세요." }).message).toContain("확인하지 못");
  });
  it("calls only the dedicated endpoint and strips unrelated owner/alias fields before transport", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://synthetic.invalid");
    const fetch = vi.fn(async () => new Response(JSON.stringify(card), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      const { api } = await import("./api-client");
      const body = { last4: "0012", expectedLast4: "1234", expectedOwnerMemberId: ownerId, ownerMemberId: "must-not-send", alias: "must-not-send" };
      await api.cards.correctLast4("synthetic-token", "synthetic/card", body);
      const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://synthetic.invalid/v1/cards/synthetic%2Fcard/last4");
      expect(options.method).toBe("PATCH");
      expect(JSON.parse(String(options.body))).toEqual({ last4: "0012", expectedLast4: "1234", expectedOwnerMemberId: ownerId });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});

describe("QueryClient-scoped uncertain correction proof", () => {
  const input = { id: card.id, householdId: card.householdId, body: {
    last4: "0012", expectedLast4: "1234", expectedOwnerMemberId: ownerId,
  } };

  it("survives close/remount/household changes and cache writes without persisting anything on reload", () => {
    const qc = new QueryClient(); const notify = vi.fn();
    const unmount = subscribeCardCorrectionState(qc, notify);
    markCardCorrectionUncertain(qc, card.householdId, card.id);
    expect(notify).toHaveBeenCalledTimes(1); unmount();
    const remount = subscribeCardCorrectionState(qc, notify);
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    expect(cardCorrectionRequiresRead(qc, "other-family", card.id)).toBe(false);
    writeCorrectedCard(qc, card);
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    beginCardCorrectionRead(qc, "other-family")([{ ...card, householdId: "other-family" }]);
    expect(() => assertCardCorrectionReady(qc, card.householdId, card.id)).toThrow(CardCorrectionReadRequiredError);
    remount();
    beginCardCorrectionRead(qc, card.householdId)([card]);
    expect(notify).toHaveBeenCalledTimes(1);
    const reloaded = new QueryClient();
    expect(reloaded.getQueryData(["cards", card.householdId])).toBeUndefined();
    qc.clear(); reloaded.clear();
  });

  it("accepts only the same card/household and current uncertainty epoch, never an older GET", () => {
    const qc = new QueryClient();
    const beforeFailure = beginCardCorrectionRead(qc, card.householdId);
    markCardCorrectionUncertain(qc, card.householdId, card.id);
    beforeFailure([card]); expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    const beforeSecondFailure = beginCardCorrectionRead(qc, card.householdId);
    markCardCorrectionUncertain(qc, card.householdId, card.id);
    beforeSecondFailure([card]); expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    const current = beginCardCorrectionRead(qc, card.householdId);
    current([{ ...card, householdId: "wrong-family" }, { ...card, id: "other-card" }]);
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    current([card]); expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(false);
    qc.clear();
  });

  it("does not accept the late result of a cancelled real QueryClient GET", async () => {
    const qc = new QueryClient(); const key = ["cards", card.householdId];
    const response = deferred<CardSummary[]>(); const started = deferred<void>(); const finished = deferred<void>();
    const old = qc.fetchQuery({ queryKey: key, queryFn: async ({ signal }) => {
      const confirm = beginCardCorrectionRead(qc, card.householdId, signal); started.resolve();
      try { const rows = await response.promise; confirm(rows); return rows; }
      finally { finished.resolve(); }
    } }).catch(() => undefined);
    await started.promise;
    markCardCorrectionUncertain(qc, card.householdId, card.id);
    await qc.cancelQueries({ queryKey: key });
    response.resolve([card]); await finished.promise; await old;
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    const cancelled = new AbortController();
    const complete = beginCardCorrectionRead(qc, card.householdId, cancelled.signal);
    cancelled.abort(); complete([card]);
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    qc.clear();
  });

  it("blocks the actual mutation boundary with successful stale cache and paused/cancelled GET until a fresh GET succeeds", async () => {
    const qc = new QueryClient(); const key = ["cards", card.householdId]; const wasOnline = onlineManager.isOnline();
    const send = vi.fn(async () => ({ ...card, maskedNumber: "0012" }));
    const options = cardLast4MutationOptions(qc, send);
    const mutation = new MutationObserver(qc, options);
    qc.setQueryData(key, [card]); markCardCorrectionUncertain(qc, card.householdId, card.id);
    onlineManager.setOnline(false);
    const get = vi.fn(async () => [card]);
    try {
      const paused = qc.fetchQuery({ queryKey: key, queryFn: async ({ signal }) => {
        const confirm = beginCardCorrectionRead(qc, card.householdId, signal);
        const rows = await get(); confirm(rows); return rows;
      } }).catch(() => undefined);
      expect(qc.getQueryState(key)).toMatchObject({ status: "success", fetchStatus: "paused" });
      await expect(mutation.mutate(input)).rejects.toBeInstanceOf(CardCorrectionReadRequiredError);
      await expect(options.mutationFn(input)).rejects.toBeInstanceOf(CardCorrectionReadRequiredError);
      expect(send).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
      await qc.cancelQueries({ queryKey: key }); await paused;
      expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
      onlineManager.setOnline(true);
      await qc.fetchQuery({ queryKey: key, queryFn: async ({ signal }) => {
        const confirm = beginCardCorrectionRead(qc, card.householdId, signal);
        const rows = await get(); confirm(rows); return rows;
      } });
      expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(false);
      await mutation.mutate(input);
      expect(send).toHaveBeenCalledExactlyOnceWith(input, expect.any(Function));
    } finally { await qc.cancelQueries(); qc.clear(); onlineManager.setOnline(wasOnline); }
  });

  it("rechecks between onMutate and PATCH and records an uncertain response outside the view", async () => {
    const qc = new QueryClient(); const send = vi.fn(async () => card);
    const options = cardLast4MutationOptions(qc, send);
    await options.onMutate(input);
    markCardCorrectionUncertain(qc, card.householdId, card.id);
    await expect(options.mutationFn(input)).rejects.toBeInstanceOf(CardCorrectionReadRequiredError);
    expect(send).not.toHaveBeenCalled();
    beginCardCorrectionRead(qc, card.householdId)([card]);
    const lost = new MutationObserver(qc, cardLast4MutationOptions(qc, async () => { throw new TypeError("synthetic lost response"); }));
    await expect(lost.mutate(input)).rejects.toThrow("synthetic lost response");
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    qc.clear();
  });

  it.each([
    { name: "wrong last4", result: { ...card, maskedNumber: "9999" } },
    { name: "different owner", result: { ...card, maskedNumber: "0012", ownerMemberId: "22222222-2222-4222-8222-222222222222" } },
  ])("requires a new GET and does not cache an HTTP success with $name", async ({ result }) => {
    const qc = new QueryClient(); qc.setQueryData(["cards", card.householdId], [card]);
    const mutation = new MutationObserver(qc, cardLast4MutationOptions(qc, async () => result));
    await expect(mutation.mutate(input)).rejects.toThrow("card_response_confirmation_mismatch");
    expect(qc.getQueryData(["cards", card.householdId])).toEqual([card]);
    expect(cardCorrectionIsPending(qc, card.householdId, card.id)).toBe(false);
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    const retry = vi.fn(async () => ({ ...card, maskedNumber: "0012" }));
    const reopened = new MutationObserver(qc, cardLast4MutationOptions(qc, retry));
    await expect(reopened.mutate(input)).rejects.toBeInstanceOf(CardCorrectionReadRequiredError);
    expect(retry).not.toHaveBeenCalled(); qc.clear();
  });

  it("keeps one owned PATCH across remounts and ignores GETs begun during pending when it becomes uncertain", async () => {
    const qc = new QueryClient(); const response = deferred<CardSummary>(); const started = deferred<void>();
    let oldGuard!: () => void;
    const send = vi.fn(async (_input, guard: () => void) => { oldGuard = guard; started.resolve(); return response.promise; });
    const firstView = new MutationObserver(qc, cardLast4MutationOptions(qc, send));
    const first = firstView.mutate(input).catch(() => undefined);
    await started.promise;
    expect(cardCorrectionIsPending(qc, card.householdId, card.id)).toBe(true);
    const pendingGet = beginCardCorrectionRead(qc, card.householdId);
    pendingGet([card]);
    const reopened = new MutationObserver(qc, cardLast4MutationOptions(qc, send));
    await expect(reopened.mutate(input)).rejects.toBeInstanceOf(CardCorrectionPendingError);
    expect(send).toHaveBeenCalledTimes(1);
    response.reject(new TypeError("synthetic response lost after navigation")); await first;
    expect(cardCorrectionIsPending(qc, card.householdId, card.id)).toBe(false);
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(true);
    pendingGet([card]);
    await expect(reopened.mutate(input)).rejects.toBeInstanceOf(CardCorrectionReadRequiredError);
    expect(send).toHaveBeenCalledTimes(1);
    beginCardCorrectionRead(qc, card.householdId)([card]);
    const nextResponse = deferred<CardSummary>(); const nextStarted = deferred<void>();
    const nextView = new MutationObserver(qc, cardLast4MutationOptions(qc, async (_input, guard) => {
      guard(); nextStarted.resolve(); return nextResponse.promise;
    }));
    const second = nextView.mutate(input); await nextStarted.promise;
    expect(oldGuard).toThrow(CardCorrectionPendingError);
    pendingGet([card]);
    expect(cardCorrectionIsPending(qc, card.householdId, card.id)).toBe(true);
    nextResponse.resolve({ ...card, maskedNumber: "0012" }); await second;
    expect(cardCorrectionIsPending(qc, card.householdId, card.id)).toBe(false);
    expect(cardCorrectionRequiresRead(qc, card.householdId, card.id)).toBe(false);
    qc.clear();
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
    expect(correctionRequest("0012", "1234", ownerId).ok).toBe(true);
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
