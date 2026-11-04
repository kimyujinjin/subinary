/* ---------------------------------------------------------------------------
 * 거래 표시 규칙 — 가계부 목록·상세 시트·이 가맹점 최근 결제가 같은 규칙을 쓴다.
 * ------------------------------------------------------------------------- */
import type { TransactionSummary } from "@family/contracts";

/** 가맹점 표시명(masked → '(비공개)', 미확인 → '미확인 가맹점'). */
export function merchantLabel(
  txn: Pick<TransactionSummary, "masked" | "merchantNormalized" | "merchantRaw">
): string {
  if (txn.masked) return "(비공개)";
  return txn.merchantNormalized ?? txn.merchantRaw ?? "미확인 가맹점";
}

/** 거래 발생 시각(승인 → 취소 → 수신 순 fallback). */
export function transactionOccurredAt(
  txn: Pick<TransactionSummary, "approvedAt" | "cancelledAt" | "createdAt">
): string {
  return txn.approvedAt ?? txn.cancelledAt ?? txn.createdAt;
}

/** 검색어로 쓸 가맹점 원문. 비공개·미확인이면 null(찾을 수 없다). */
export function merchantSearchTerm(
  txn: Pick<TransactionSummary, "masked" | "merchantNormalized" | "merchantRaw">
): string | null {
  if (txn.masked) return null;
  return txn.merchantNormalized ?? txn.merchantRaw ?? null;
}

/**
 * 같은 가맹점의 다른 결제(최근순, 최대 `limit`건). 검색(q)은 가맹점·메모 부분 일치라
 * 표시명이 정확히 같은 것만 남기고, 비공개 행과 지금 보고 있는 거래는 뺀다.
 */
export function sameMerchantHistory(
  items: readonly TransactionSummary[],
  txn: TransactionSummary,
  limit = 5
): TransactionSummary[] {
  const label = merchantLabel(txn);
  return items
    .filter(
      (item) =>
        item.id !== txn.id && !item.masked && merchantLabel(item) === label
    )
    .sort(
      (a, b) =>
        Date.parse(transactionOccurredAt(b)) -
        Date.parse(transactionOccurredAt(a))
    )
    .slice(0, limit);
}
