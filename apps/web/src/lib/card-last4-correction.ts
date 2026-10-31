import type { CardLast4CorrectionRequest, CardSummary } from "@family/contracts";
import type { QueryClient } from "@tanstack/react-query";

/** Read a masked value without turning a full PAN into an accepted last four. */
export function cardLast4(masked: string | null | undefined): string | null {
  const digits = (masked ?? "").replace(/[^0-9]/g, "");
  return /^[0-9]{4}$/.test(digits) ? digits : null;
}

export function hasUnknownCardLast4(masked: string | null): boolean {
  return masked !== null && cardLast4(masked) === null;
}

export function canCorrectCardLast4(card: Pick<CardSummary, "ownerMemberId">, memberId: string | null, role: string | undefined): boolean {
  return role === "owner" || role === "admin" || (memberId !== null && card.ownerMemberId === memberId);
}

/** Exact ASCII only: never truncate, strip separators, or convert to a number. */
export function correctionRequest(last4: string, expectedLast4: string | null, expectedOwnerMemberId: string):
  { ok: true; body: CardLast4CorrectionRequest } | { ok: false; message: string } {
  if (expectedLast4 !== null && !/^[0-9]{4}$/.test(expectedLast4)) return { ok: false, message: "현재 카드 식별 정보를 다시 확인해 주세요." };
  if (!/^[0-9]{4}$/.test(last4)) return { ok: false, message: "전체 카드번호 대신 뒤 4자리 숫자만 입력해 주세요." };
  if (last4 === expectedLast4) return { ok: false, message: "현재와 다른 뒤 4자리를 입력해 주세요." };
  return { ok: true, body: { last4, expectedLast4, expectedOwnerMemberId } };
}

export function acceptsLast4Insertion(draft: string, text: string, start = draft.length, end = start): boolean {
  return /^[0-9]{0,4}$/.test(draft.slice(0, start) + text + draft.slice(end));
}

export function correctionError(error: unknown): { message: string; refresh: boolean; readRequired?: boolean } {
  if (error instanceof CardCorrectionPendingError) return { message: "이 카드의 정정이 아직 처리 중이에요. 완료될 때까지 기다려 주세요.", refresh: false };
  const value = typeof error === "object" && error !== null ? error as { status?: unknown; body?: unknown; serverMessage?: unknown } : {};
  const status = value.status;
  const body = typeof value.body === "object" && value.body !== null ? value.body as { code?: unknown } : {};
  const serverMessage = typeof value.serverMessage === "string" ? value.serverMessage : "";
  if (status === 403) return { message: "이 카드의 뒤 4자리를 정정할 권한이 없어요. 소유자나 가족 관리자에게 확인해 주세요.", refresh: false };
  if (status === 409) {
    if (body.code === "card_last4_stale" || /card_last4_stale|카드 정보가 변경|번호를 확인할 수 없|다른.*변경|기대.*일치|expected.*last4/i.test(serverMessage)) {
      return { message: "현재 카드 정보를 확인하지 못했어요. 다른 작업 중이거나 정보가 바뀌었을 수 있으니 최신 정보를 확인해 주세요.", refresh: true };
    }
    if (body.code === "card_last4_conflict" || /card_last4_conflict|같은 조건으로 자동 연결|같은.*뒤.?4|이미.*카드|duplicate/i.test(serverMessage)) {
      return { message: "새 뒤 4자리와 겹치는 활성 카드가 있어요. 카드 목록과 소유자를 확인해 주세요.", refresh: true };
    }
    return { message: "카드 정보가 변경됐거나 같은 뒤 4자리 카드가 있어요. 최신 카드 정보를 확인해 주세요.", refresh: true };
  }
  if (status === 400) return { message: "뒤 4자리를 숫자 4개로 입력했는지 확인해 주세요.", refresh: false };
  return { message: "정정 결과를 확인하지 못했어요. 입력은 그대로예요. 다시 보내기 전에 현재 카드 정보를 확인해 주세요.", refresh: true, readRequired: true };
}

/** An uncertain write stays locked through edits/read failures until a GET succeeds. */
export function createCardCorrectionReadGate() {
  let required = false;
  return {
    get required() { return required; },
    failed(error: unknown) { const issue = correctionError(error); required ||= issue.readRequired === true; return issue; },
    confirmed() { required = false; },
  };
}

interface UncertainCards {
  epoch: number;
  version: number;
  households: Map<string, Map<string, number>>;
  pending: Map<string, Map<string, { token: object; epoch: number }>>;
  listeners: Set<() => void>;
}
const uncertainClients = new WeakMap<QueryClient, UncertainCards>();
function uncertainty(qc: QueryClient): UncertainCards {
  let value = uncertainClients.get(qc);
  if (!value) {
    value = { epoch: 0, version: 0, households: new Map(), pending: new Map(), listeners: new Set() };
    uncertainClients.set(qc, value);
  }
  return value;
}
function changed(state: UncertainCards) { state.version++; [...state.listeners].forEach((notify) => notify()); }
export function cardCorrectionStateVersion(qc: QueryClient): number { return uncertainty(qc).version; }
export function subscribeCardCorrectionState(qc: QueryClient, notify: () => void): () => void {
  const state = uncertainty(qc); const entry = () => notify(); state.listeners.add(entry);
  return () => { state.listeners.delete(entry); };
}
export function markCardCorrectionUncertain(qc: QueryClient, householdId: string, id: string): void {
  const state = uncertainty(qc);
  let cards = state.households.get(householdId);
  if (!cards) { cards = new Map(); state.households.set(householdId, cards); }
  cards.set(id, ++state.epoch); changed(state);
}
export function cardCorrectionRequiresRead(qc: QueryClient, householdId: string, id: string): boolean {
  return uncertainty(qc).households.get(householdId)?.has(id) ?? false;
}
export function cardCorrectionIsPending(qc: QueryClient, householdId: string, id: string): boolean {
  return uncertainty(qc).pending.get(householdId)?.has(id) ?? false;
}
export class CardCorrectionReadRequiredError extends Error {
  constructor() { super("card_correction_current_read_required"); }
}
export class CardCorrectionPendingError extends Error {
  constructor() { super("card_correction_attempt_pending"); }
}
/** Called again immediately before PATCH, independent of dialog/query render state. */
export function assertCardCorrectionReady(qc: QueryClient, householdId: string, id: string): void {
  if (cardCorrectionRequiresRead(qc, householdId, id)) throw new CardCorrectionReadRequiredError();
  if (cardCorrectionIsPending(qc, householdId, id)) throw new CardCorrectionPendingError();
}

function claimAttempt(qc: QueryClient, householdId: string, id: string) {
  assertCardCorrectionReady(qc, householdId, id);
  const state = uncertainty(qc); const claim = { token: {}, epoch: ++state.epoch };
  let cards = state.pending.get(householdId);
  if (!cards) { cards = new Map(); state.pending.set(householdId, cards); }
  cards.set(id, claim); changed(state);
  return {
    guard() {
      if (state.pending.get(householdId)?.get(id) !== claim) throw new CardCorrectionPendingError();
      if (cardCorrectionRequiresRead(qc, householdId, id)) throw new CardCorrectionReadRequiredError();
    },
    finish(failed = false, error?: unknown) {
      // An old callback cannot release a later attempt, even for the same card.
      if (state.pending.get(householdId)?.get(id) !== claim) return;
      const pending = state.pending.get(householdId)!; pending.delete(id);
      if (!pending.size) state.pending.delete(householdId);
      if (failed && correctionError(error).readRequired && !(error instanceof CardCorrectionReadRequiredError)) {
        markCardCorrectionUncertain(qc, householdId, id);
      } else changed(state);
    },
  };
}

/** Only a successful HTTP GET started after the same uncertainty epoch is proof. */
export function beginCardCorrectionRead(qc: QueryClient, householdId: string, signal?: AbortSignal) {
  const initial = uncertainty(qc);
  const epochs = new Map(initial.households.get(householdId));
  for (const id of initial.pending.get(householdId)?.keys() ?? []) epochs.delete(id);
  return (rows: readonly CardSummary[]): void => {
    if (signal?.aborted) return;
    const state = uncertainty(qc); const cards = state.households.get(householdId);
    if (!cards) return;
    let cleared = false;
    for (const row of rows) {
      if (row.householdId === householdId && !state.pending.get(householdId)?.has(row.id)
          && epochs.has(row.id) && cards.get(row.id) === epochs.get(row.id)) {
        cards.delete(row.id); cleared = true;
      }
    }
    if (!cards.size) state.households.delete(householdId);
    if (cleared) changed(state);
  };
}

export interface CardLast4CorrectionInput {
  id: string;
  householdId: string;
  body: CardLast4CorrectionRequest;
}

/** Shared by the hook and MutationObserver regressions; no UI lifetime assumptions. */
export function cardLast4MutationOptions(qc: QueryClient, send: (input: CardLast4CorrectionInput, guard: () => void) => Promise<CardSummary>) {
  return {
    retry: false,
    onMutate: (input: CardLast4CorrectionInput) => {
      assertCardCorrectionReady(qc, input.householdId, input.id);
      return qc.cancelQueries({ queryKey: ["cards", input.householdId] });
    },
    mutationFn: async (input: CardLast4CorrectionInput) => {
      const claim = claimAttempt(qc, input.householdId, input.id);
      try {
        const result = await send(input, claim.guard);
        claim.guard();
        if (result.id !== input.id || result.householdId !== input.householdId
            || cardLast4(result.maskedNumber) !== input.body.last4
            || result.ownerMemberId !== input.body.expectedOwnerMemberId) throw new Error("card_response_confirmation_mismatch");
        writeCorrectedCard(qc, result);
        claim.finish();
        return result;
      } catch (error) { claim.finish(true, error); throw error; }
    },
    onError: (error: unknown, input: CardLast4CorrectionInput) => {
      if (correctionError(error).readRequired && !(error instanceof CardCorrectionReadRequiredError)) {
        void qc.invalidateQueries({ queryKey: ["cards", input.householdId] });
      }
    },
  };
}

/** The response belongs to the captured household, even after household navigation. */
export function writeCorrectedCard(qc: QueryClient, card: CardSummary): void {
  const key = ["cards", card.householdId] as const;
  qc.setQueryData<CardSummary[]>(key, (old) => old?.map((row) => row.id === card.id ? card : row));
  void qc.invalidateQueries({ queryKey: key });
  void qc.invalidateQueries({ queryKey: ["budgets", card.householdId] });
  void qc.invalidateQueries({ predicate: (query) => query.queryKey[0] === "analytics" && query.queryKey[2] === card.householdId });
}
