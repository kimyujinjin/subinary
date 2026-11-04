"use client";
import type { BudgetSummary } from "@family/contracts";
import React from "react";

import { SectionHeader } from "@/components/widgets/section-header";
import { formatWon } from "@/lib/format";

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

