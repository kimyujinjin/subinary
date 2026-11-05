/**
 * 거래 목록·상세의 상태 이름과 날짜 소계 규칙(2026-11-05 HIG 검수 3·4단계).
 *
 * 예전에는 취소된 원래 결제(0원과 '취소' 칩)와 취소로 생긴 기록(회색 마이너스 금액과 맨 글자 '취소')이
 * 한 목록에 같은 '취소'로 나왔고, 상세는 '취소 거래'·'합계에서 제외됨', 목록은 '제외됨'이었다.
 * 앱 전체 이름 규칙에 맞춘다 — 원래 결제는 '취소됨'·'부분 취소', 취소로 생긴 기록은 '환불',
 * 뺀 거래는 '합계 제외'. 목록과 상세가 이 함수 하나로 같은 말을 쓴다.
 *
 * 날짜 소계는 원화 승인만 더한다(서버 KRW 집계와 같다). 빠지는 줄의 이유가 마우스를 올려야 보이는
 * title뿐이라, 환불이 있는 날은 보이는 줄의 합과 소계가 달랐다 — 그 줄에 이유를 글자로 붙인다.
 * 원래 결제에 연결된 환불은 그 결제 금액(netAmount)에서 이미 빠져 있어 '원래 결제에 반영',
 * 연결 전 환불·외화 원장 줄은 '소계 제외'다.
 */
import type { TransactionSummary } from "@family/contracts";

import type { ChipTone } from "@/components/widgets/status-chip";

export type TransactionChip = Readonly<{ tone: ChipTone; label: string }>;

type ChipInput = Pick<
  TransactionSummary,
  "transactionType" | "status" | "excludedAt"
>;

/** 승인(기본 상태)은 표시하지 않는다(§5) — 모든 줄에 붙으면 아무것도 말하지 않는다. */
const STATUS_CHIPS: Readonly<Record<string, TransactionChip>> = {
  partially_cancelled: { tone: "attention", label: "부분 취소" },
  cancelled: { tone: "neutral", label: "취소됨" },
  pending_review: { tone: "attention", label: "확인 필요" },
  duplicate_suspected: { tone: "error", label: "중복 의심" },
};

/**
 * 줄·상세 머리에 붙일 상태 칩(순서대로). 합계에서 뺀 거래는 사용자가 이미 답한 것이라
 * '합계 제외'만 보이고 확인 상태(중복 의심 등)는 다시 말하지 않는다.
 */
export function transactionChips(txn: ChipInput): TransactionChip[] {
  const chips: TransactionChip[] = [];
  if (txn.transactionType === "cancellation") {
    chips.push({ tone: "neutral", label: "환불" });
  }
  if (txn.excludedAt != null) {
    chips.push({ tone: "neutral", label: "합계 제외" });
    return chips;
  }
  const status = STATUS_CHIPS[txn.status];
  if (status) chips.push(status);
  return chips;
}

type TotalInput = Pick<
  TransactionSummary,
  "transactionType" | "excludedAt" | "currency"
> &
  Partial<Pick<TransactionSummary, "parentTransactionId">>;

/**
 * 날짜 소계에 더하는 줄인가 — 원화 승인이고 합계에서 빼지 않았을 때만.
 * amount는 통화별 minor units라 통화가 섞이면 소계가 무의미하다(외화 원장 줄은 자기 통화로 따로 보인다).
 */
export function countsInDayTotal(txn: TotalInput): boolean {
  return (
    txn.transactionType === "approval" &&
    txn.excludedAt == null &&
    (txn.currency || "KRW") === "KRW"
  );
}

/**
 * 소계에서 빠지는 줄에 붙일 짧은 글자. 합계에서 뺀 거래는 칩('합계 제외')과 취소선이 이미 말하므로
 * 붙이지 않는다 — 같은 줄에 같은 뜻을 두 번 쓰지 않는다.
 * 연결된 환불을 '소계 제외'라고만 하면 환불이 어디에도 안 잡힌 것처럼 읽혀서, 반영된 곳을 말한다.
 */
export function dayTotalNote(txn: TotalInput): string | null {
  if (countsInDayTotal(txn) || txn.excludedAt != null) return null;
  if (txn.transactionType === "cancellation" && txn.parentTransactionId != null) {
    return "원래 결제에 반영";
  }
  return "소계 제외";
}
