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
      <section className="bg-finance-hero text-finance-hero-foreground min-w-0 rounded-2xl p-5 sm:p-6" aria-label="등록한 자산 요약">
        <h2 className="text-sm font-semibold">{scope === "household" ? "가족과 공유한 자산" : "나만 보는 자산"}</h2>
        <div className="mt-5 flex items-center gap-3">
          <Wallet className="text-finance-highlight size-6 shrink-0" aria-hidden="true" />
          <p className="text-finance-highlight text-xl font-semibold tracking-tight">등록된 자산이 없어요</p>
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
      className="bg-finance-hero text-finance-hero-foreground min-w-0 rounded-2xl px-5 pb-3 pt-5 sm:px-6 sm:pt-6"
      aria-label="등록한 자산 요약"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {scope === "household" ? "가족과 공유한 자산" : "나만 보는 자산"}
        </h2>
        {netKnown ? <p className="text-finance-hero-muted shrink-0 text-xs">순자산</p> : null}
      </div>
      {netKnown ? (
          <p className="text-finance-highlight mt-3 min-w-0 break-all text-[clamp(2rem,6vw,3rem)] font-bold leading-tight tracking-tight tabular-nums">
            {displayManualKrw(summary.netAssets)}
          </p>
      ) : null}
      <dl className={`mt-5 grid min-w-0 grid-cols-2 gap-4 text-sm ${netKnown ? "border-t border-white/15 pt-4" : ""}`}>
        <div className="min-w-0">
          <dt className="text-finance-hero-muted text-xs">
            {summary.assetsCompleteness === "partial"
              ? "자산 (일부 입력)"
              : "등록한 자산"}
          </dt>
          <dd className={`mt-1.5 min-w-0 break-all font-semibold leading-snug tabular-nums ${summary.grossAssets === null ? "text-finance-hero-muted text-sm" : netKnown ? "text-base sm:text-lg" : "text-finance-highlight text-xl sm:text-2xl"}`}>
            {summary.grossAssets === null ? "미입력" : displayManualKrw(summary.grossAssets)}
          </dd>
        </div>
        <div className="min-w-0 border-l border-white/15 pl-4">
          <dt className="text-finance-hero-muted text-xs">
            {summary.debtCompleteness === "partial"
              ? "대출 (일부 입력)"
              : "남은 대출"}
          </dt>
          <dd className={`mt-1.5 min-w-0 break-all font-semibold leading-snug tabular-nums ${summary.debt === null ? "text-finance-hero-muted text-sm" : netKnown ? "text-base sm:text-lg" : "text-finance-highlight text-xl sm:text-2xl"}`}>
            {summary.debt === null ? "미입력" : displayManualKrw(summary.debt)}
          </dd>
        </div>
      </dl>
      {!netKnown ? <p className="text-finance-hero-muted mt-4 text-xs leading-relaxed">미입력 금액이 있어 순자산은 아직 계산하지 않았어요.</p> : null}
      {netKnown ? (
        <details className="group mt-3 text-xs">
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
