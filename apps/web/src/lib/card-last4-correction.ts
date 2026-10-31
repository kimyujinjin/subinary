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
export function correctionRequest(last4: string, expectedLast4: string | null):
  { ok: true; body: CardLast4CorrectionRequest } | { ok: false; message: string } {
  if (expectedLast4 !== null && !/^[0-9]{4}$/.test(expectedLast4)) return { ok: false, message: "현재 카드 식별 정보를 다시 확인해 주세요." };
  if (!/^[0-9]{4}$/.test(last4)) return { ok: false, message: "전체 카드번호 대신 뒤 4자리 숫자만 입력해 주세요." };
  if (last4 === expectedLast4) return { ok: false, message: "현재와 다른 뒤 4자리를 입력해 주세요." };
  return { ok: true, body: { last4, expectedLast4 } };
}

export function acceptsLast4Insertion(draft: string, text: string, start = draft.length, end = start): boolean {
  return /^[0-9]{0,4}$/.test(draft.slice(0, start) + text + draft.slice(end));
}

export function correctionError(error: unknown): { message: string; refresh: boolean; readRequired?: boolean } {
  const value = typeof error === "object" && error !== null ? error as { status?: unknown; body?: unknown; serverMessage?: unknown } : {};
  const status = value.status;
  const body = typeof value.body === "object" && value.body !== null ? value.body as { code?: unknown } : {};
  const serverMessage = typeof value.serverMessage === "string" ? value.serverMessage : "";
  if (status === 403) return { message: "이 카드의 뒤 4자리를 정정할 권한이 없어요. 소유자나 가족 관리자에게 확인해 주세요.", refresh: false };
  if (status === 409) {
    if (body.code === "card_last4_stale" || /card_last4_stale|카드 정보가 변경|번호를 확인할 수 없|다른.*변경|기대.*일치|expected.*last4/i.test(serverMessage)) {
      return { message: "현재 카드 정보가 변경됐거나 뒤 4자리를 확인할 수 없어요. 최신 카드 정보를 확인한 뒤 다시 정정해 주세요.", refresh: true };
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

/** The response belongs to the captured household, even after household navigation. */
export function writeCorrectedCard(qc: QueryClient, card: CardSummary): void {
  const key = ["cards", card.householdId] as const;
  qc.setQueryData<CardSummary[]>(key, (old) => old?.map((row) => row.id === card.id ? card : row));
  void qc.invalidateQueries({ queryKey: key });
  void qc.invalidateQueries({ queryKey: ["budgets", card.householdId] });
  void qc.invalidateQueries({ predicate: (query) => query.queryKey[0] === "analytics" && query.queryKey[2] === card.householdId });
}
