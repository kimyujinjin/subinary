import Link from "next/link";
import type { ImportedLoanRecord } from "@family/contracts";
import { displayManualKrw, visibilityLabel } from "@/components/manual-finance/model";
import { StatusChip } from "@/components/widgets/status-chip";

export function loanInclusionLabel(item: ImportedLoanRecord): string {
  if (item.includedInTotals) {
    return item.totalMode === "replacement"
      ? "기존 기록 대신 계산"
      : "별도 대출로 합계 반영";
  }
  const reasons: Record<NonNullable<ImportedLoanRecord["exclusionReason"]>, string> = {
    reference: "기록만 보관 · 합계 제외",
    replacement_changed: "기존 대출 변경 · 연결 확인 필요 · 합계 제외",
    duplicate_visible_loan: "중복 확인 필요 · 합계 제외",
    sharing_expired: "공유 상태 변경 · 가족 공유 확인 필요 · 합계 제외",
  };
  return item.exclusionReason
    ? reasons[item.exclusionReason]
    : "합계 제외 · 반영 설정 확인 필요";
}

export function LoanOverviewRow({ item }: { item: ImportedLoanRecord }) {
  const checkedAt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(item.capturedAt));
  const included = item.includedInTotals;
  return (
    <article className="min-w-0 py-4" aria-label={`${item.label} 가져온 대출`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-body break-words font-semibold">{item.label}</h3>
          <p className="text-caption text-muted-foreground">
            {item.loanType === "jeonse" ? "전세 대출" : "중도금 대출"} · 끝 {item.accountLast4}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <strong className="text-heading block break-all tabular-nums">{displayManualKrw(item.outstandingPrincipalKrw)}</strong>
          <small className="text-caption text-muted-foreground">남은 원금</small>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusChip tone={included ? "neutral" : "attention"}>{loanInclusionLabel(item)}</StatusChip>
      </div>
      <details className="text-caption mt-1 min-w-0">
        <summary className="text-muted-foreground min-h-11 cursor-pointer py-3">대출 정보</summary>
        <dl className="text-muted-foreground grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt>만기일</dt><dd className="min-w-0">{item.maturityDate ?? "미확인"}</dd>
          <dt>출처</dt><dd className="min-w-0 break-words">신한은행 대출계좌조회 화면 · {visibilityLabel(item.visibility)}</dd>
          <dt>화면 확인</dt><dd className="min-w-0 break-words"><time dateTime={item.capturedAt}>{checkedAt}</time> · 은행 잔액 기준일 미확인</dd>
        </dl>
        {item.canEdit ? (
          <Link href="/assets/loan-import" className="text-primary mt-2 inline-flex min-h-11 items-center font-medium">가져온 기록 수정</Link>
        ) : null}
      </details>
    </article>
  );
}
