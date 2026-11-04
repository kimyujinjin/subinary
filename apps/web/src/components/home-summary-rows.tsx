import type { BudgetSummary, ManualAssetSummary } from "@family/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import React from "react";

import { displayManualKrw } from "@/components/manual-finance/model";
import { SectionHeader } from "@/components/widgets/section-header";
import { StatusChip } from "@/components/widgets/status-chip";
import { formatWon } from "@/lib/format";

/**
 * 자산 요약 한 줄(§5 홈 5). 아는 값만 말하고 모르는 값은 `미입력`이라고 말한다 —
 * 미입력을 0으로 보고 순자산을 만들지 않는다.
 */
export function assetOneLine(summary: ManualAssetSummary): string {
  if (summary.completeness === "empty") return "등록된 자산이 없어요";
  if (summary.completeness === "complete" && summary.netAssets !== null) {
    return `순자산 ${displayManualKrw(summary.netAssets)}`;
  }
  const known: string[] = [];
  const unknown: string[] = [];
  if (summary.debt !== null)
    known.push(`남은 대출 ${displayManualKrw(summary.debt)}`);
  else unknown.push("대출 미입력");
  if (summary.grossAssets !== null)
    known.push(`자산 ${displayManualKrw(summary.grossAssets)}`);
  else unknown.push("자산 미입력");
  return [...known, ...unknown].join(" · ");
}

export function HomeAssetRow({
  summary,
  loading,
  error,
  unresolvedLoans = 0,
}: {
  summary?: ManualAssetSummary;
  loading: boolean;
  error: boolean;
  unresolvedLoans?: number;
}) {
  return (
    <Link
      href="/assets?scope=household"
      className="finance-panel hover:bg-muted/40 focus-visible:outline-ring flex min-h-16 min-w-0 items-center gap-3 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span className="min-w-0 flex-1">
        <span className="text-caption text-muted-foreground block">
          가족 자산
        </span>
        <span
          className={`text-body block break-words font-semibold ${
            error
              ? "text-destructive"
              : loading
              ? "text-muted-foreground font-normal"
              : ""
          }`}
          role={error ? "alert" : loading ? "status" : undefined}
        >
          {loading
            ? "자산을 불러오는 중이에요."
            : error || !summary
            ? "자산을 불러오지 못했어요."
            : assetOneLine(summary)}
        </span>
      </span>
      {!loading && !error && unresolvedLoans > 0 ? (
        <StatusChip tone="attention">확인 필요 {unresolvedLoans}</StatusChip>
      ) : null}
      <ChevronRight
        className="text-muted-foreground/60 size-5 shrink-0"
        aria-hidden="true"
      />
    </Link>
  );
}

function barTone(rate: number): string {
  if (rate >= 1) return "bg-destructive";
  if (rate >= 0.8) return "bg-warning";
  return "bg-primary";
}

/** 예산 진행 요약(§5 홈 3): 사용률이 높은 순으로 최대 3개, 한 줄 막대. 예산이 없으면 그리지 않는다. */
export function HomeBudgetSummary({
  items,
  month,
}: {
  items: readonly BudgetSummary[];
  month: string;
}) {
  if (!items.length) return null;
  const top = [...items].sort((a, b) => b.usageRate - a.usageRate).slice(0, 3);
  return (
    <section className="finance-panel min-w-0 px-5 pb-4 pt-2" aria-label="예산">
      <SectionHeader
        title="예산"
        actionLabel={
          items.length > top.length ? `전체 ${items.length}개` : "전체 보기"
        }
        actionHref={`/budgets?month=${encodeURIComponent(month)}`}
      />
      <ul className="space-y-4">
        {top.map((budget) => {
          const rate = Number.isFinite(budget.usageRate) ? budget.usageRate : 0;
          return (
            <li key={budget.id} className="min-w-0">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="text-body min-w-0 truncate font-medium">
                  {budget.name ?? budget.scopeLabel}
                </span>
                <span className="text-caption text-muted-foreground shrink-0 tabular-nums">
                  {formatWon(budget.spent)} / {formatWon(budget.amount)}
                </span>
              </div>
              <div
                className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.min(rate, 1) * 100)}
                aria-label={`${budget.name ?? budget.scopeLabel} 사용률`}
              >
                <div
                  className={`h-full rounded-full ${barTone(rate)}`}
                  style={{ width: `${Math.min(Math.max(rate, 0), 1) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

