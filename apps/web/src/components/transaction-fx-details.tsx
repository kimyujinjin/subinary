import type { TransactionFx } from "@family/contracts";
import React from "react";

/** Show only the provenance returned for the snapshot actually used by the ledger. */
export function TransactionFxDetails({
  currency,
  exchangeRate,
  fx,
}: {
  currency: string;
  exchangeRate: number | null;
  fx?: TransactionFx | null;
}) {
  const known = fx && fx.basis !== "unknown";
  const source = fx?.source === "ecb" ? "유럽중앙은행(ECB)" : fx?.source === "manual" ? "운영자 보충 스냅샷" : fx?.source === "other" ? "저장된 스냅샷" : "기록 없음";
  const basis = !known ? "기준 정보 없음" : fx.isReference !== true ? "저장된 환산 기준" : fx.basis === "daily_reference" ? "일일 참고환율" : fx.basis === "manual_reference" ? "보충된 참고환율" : "고정된 참고환율";
  const rate = fx?.rate ?? (exchangeRate !== null && Number.isFinite(exchangeRate) ? String(exchangeRate) : null);
  return (
    <div className="text-caption w-full space-y-1">
      <p className="text-muted-foreground">추정 원화 금액이에요. 실제 카드 청구액은 다를 수 있어요.</p>
      <details className="text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">환산 기준 보기</summary>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 py-2 text-left">
          <dt>적용 기준일</dt><dd>{known && fx.asOfDate ? fx.asOfDate : "기록 없음"}</dd>
          <dt>출처</dt><dd>{known ? source : "기록 없음"}</dd>
          <dt>환산 기준</dt><dd>{basis}</dd>
          <dt>저장된 환율</dt><dd className="break-words">{rate ? `1 ${currency} = ${rate}원` : "기록 없음"}</dd>
        </dl>
        <p className="text-micro">{fx?.isReference === true ? "참고환율은 거래 순간의 실시간 환율이나 카드사 정산 환율을 뜻하지 않아요. " : "저장된 환산액과 실제 카드 청구액은 다를 수 있어요. "}취소는 연결된 승인 거래의 환산 기준을 사용할 수 있어요.</p>
      </details>
    </div>
  );
}
