import * as React from "react";
import type { ManualAssetSummary, ManualFinanceScope } from "@family/contracts";
import { ChevronDown, Wallet } from "lucide-react";
import { displayManualKrw } from "./model";

export function ManualAssetsSummary({
  summary,
  scope = "household",
  sourceLabel = "직접 입력",
  hasImportedBalance = false,
}: {
  summary: ManualAssetSummary;
  scope?: ManualFinanceScope;
  sourceLabel?: string;
  hasImportedBalance?: boolean;
}) {
  if (summary.completeness === "empty") {
    return (
      <section className="bg-finance-hero text-finance-hero-foreground min-w-0 rounded-[1.75rem] p-5 sm:p-6" aria-label="등록한 자산 요약">
        <h2 className="text-finance-hero-muted text-[13px] font-medium">{scope === "household" ? "가족과 공유한 자산" : "나만 보는 자산"}</h2>
        <div className="mt-5 flex min-w-0 items-center gap-3">
          <span className="text-finance-highlight flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/10"><Wallet className="size-5" aria-hidden="true" /></span>
          <p className="min-w-0 text-xl font-semibold leading-snug tracking-tight">등록된 자산이 없어요</p>
        </div>
        <p className="text-finance-hero-muted mt-3 text-sm leading-relaxed">통장·적금·주식·대출을 추가해 보세요.</p>
      </section>
    );
  }
  const range = hasImportedBalance
    ? "은행 잔액 기준일 미확인"
    : summary.mixedAsOfDates
    ? `항목별 기준일 ${summary.oldestAsOfDate ?? "미입력"} ~ ${
        summary.newestAsOfDate ?? "미입력"
      }`
    : `기준일 ${summary.asOfDate ?? "미입력"}`;
  const netKnown = summary.completeness === "complete" && summary.netAssets !== null;
  return (
    <section
      className="bg-finance-hero text-finance-hero-foreground min-w-0 rounded-[1.75rem] px-5 pb-1 pt-5 sm:px-6 sm:pt-6"
      aria-label="등록한 자산 요약"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h2 className="text-finance-hero-muted text-[13px] font-medium">
          {scope === "household" ? "가족과 공유한 자산" : "나만 보는 자산"}
        </h2>
        {netKnown ? <p className="text-finance-highlight shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium">순자산</p> : null}
      </div>
      {netKnown ? (
          <p className="mt-3 min-w-0 break-all text-[clamp(2rem,7vw,3rem)] font-bold leading-tight tracking-[-0.04em] tabular-nums">
            {displayManualKrw(summary.netAssets)}
          </p>
      ) : null}
      <dl className="mt-5 grid min-w-0 grid-cols-2 gap-3 rounded-2xl bg-white/5 px-3.5 py-3.5 text-sm sm:gap-4 sm:px-4">
        <div className="min-w-0">
          <dt className="text-finance-hero-muted text-xs">
            {summary.assetsCompleteness === "partial"
              ? "자산 (일부 입력)"
              : "등록한 자산"}
          </dt>
          <dd className={`mt-1.5 min-w-0 break-all font-semibold leading-snug tracking-tight tabular-nums ${summary.grossAssets === null ? "text-finance-hero-muted text-sm" : netKnown ? "text-[15px] sm:text-lg" : "text-finance-highlight text-lg sm:text-2xl"}`}>
            {summary.grossAssets === null ? "미입력" : displayManualKrw(summary.grossAssets)}
          </dd>
        </div>
        <div className="min-w-0 border-l border-white/10 pl-3 sm:pl-4">
          <dt className="text-finance-hero-muted text-xs">
            {summary.debtCompleteness === "partial"
              ? "대출 (일부 입력)"
              : "남은 대출"}
          </dt>
          <dd className={`mt-1.5 min-w-0 break-all font-semibold leading-snug tracking-tight tabular-nums ${summary.debt === null ? "text-finance-hero-muted text-sm" : netKnown ? "text-[15px] sm:text-lg" : "text-finance-highlight text-lg sm:text-2xl"}`}>
            {summary.debt === null ? "미입력" : displayManualKrw(summary.debt)}
          </dd>
        </div>
      </dl>
      {!netKnown ? <p className="text-finance-hero-muted mt-4 text-xs leading-relaxed">미입력 금액이 있어 순자산은 아직 계산하지 않았어요.</p> : null}
      {netKnown ? (
        <details className="group mt-1 text-[11px]">
          <summary className="text-finance-hero-muted flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-finance-highlight [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 break-words leading-relaxed">{range} · {sourceLabel}<span className="sr-only"> · 순자산 계산 기준</span></span>
            <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <p className="text-finance-hero-muted pb-2 leading-relaxed">등록한 자산에서 남은 대출을 뺀 금액</p>
        </details>
      ) : <p className="text-finance-hero-muted mt-3 break-words py-2 text-xs leading-relaxed">{range} · {sourceLabel}</p>}
    </section>
  );
}
