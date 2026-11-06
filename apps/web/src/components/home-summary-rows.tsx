"use client";
import type { BudgetSummary } from "@family/contracts";
import React from "react";

import { ErrorState } from "@/components/widgets/error-state";
import { SectionHeader } from "@/components/widgets/section-header";
import { formatWon } from "@/lib/format";

function barTone(rate: number): string {
  if (rate >= 1) return "bg-destructive";
  if (rate >= 0.8) return "bg-warning";
  return "bg-primary";
}

export interface BudgetStatus {
  /** 예: `12,000원 초과`, `30,000원 남았어요` */
  text: string;
  tone: "over" | "near";
}

const STATUS_TONE: Record<BudgetStatus["tone"], string> = {
  over: "text-destructive",
  near: "text-warning-strong",
};

/**
 * 막대 색만으로는 80%와 초과를 가를 수 없다(색을 구분하기 어려운 사람·흑백 화면) — 같은 사실을 글자로도
 * 쓴다. 기준(80%·100%)은 막대 색, 예산 화면 상태 줄과 같다. 여유가 있는 예산에는 아무 말도 붙이지 않는다.
 */
export function budgetStatus(
  budget: Pick<BudgetSummary, "amount" | "spent">,
  rate: number
): BudgetStatus | null {
  if (rate >= 1) {
    const overBy = budget.spent - budget.amount;
    return {
      text: overBy > 0 ? `${formatWon(overBy)} 초과` : "예산을 다 썼어요",
      tone: "over",
    };
  }
  if (rate >= 0.8)
    return {
      text: `${formatWon(Math.max(budget.amount - budget.spent, 0))} 남았어요`,
      tone: "near",
    };
  return null;
}

/**
 * 이번 달 예산 진행 요약(§5 홈 3): 사용률이 높은 순으로 최대 3개, 한 줄 막대. 섹션 제목에 달이 없어 이번 달로
 * 읽히므로 홈에서 지난 달을 골라도 이번 달 예산을 받는다(2026-11-06 결정 ②). 예산이 없거나 불러오는 중이면
 * 그리지 않는다. 불러오지 못했으면 조용히 지우지 않고 한 줄로 알린다 — 사용자가 만든 예산이 사라지면
 * '예산이 없어졌다'로 읽힌다(다른 홈 섹션은 보조 정보라 실패 시 숨긴다).
 */
export function HomeBudgetSummary({
  items,
  month,
  error = false,
  onRetry,
  retrying = false,
}: {
  items?: readonly BudgetSummary[];
  /** '전체 보기'가 여는 예산 화면의 달(`YYYY-MM`). 홈은 이번 달을 넘긴다. */
  month: string;
  error?: boolean;
  onRetry: () => void;
  retrying?: boolean;
}) {
  if (error) {
    return (
      <section
        className="finance-panel min-w-0 px-5 pb-4 pt-2"
        aria-label="예산"
      >
        <SectionHeader title="예산" />
        <ErrorState
          align="start"
          message="예산을 불러오지 못했어요"
          onRetry={onRetry}
          retrying={retrying}
        />
      </section>
    );
  }
  if (!items?.length) return null;
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
          const status = budgetStatus(budget, rate);
          const percentUsed = Math.round(Math.max(rate, 0) * 100);
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
                // 값은 100에서 멈추므로 실제 사용률은 글자로 읽어 준다(초과 금액은 아래 상태 줄이 말한다).
                aria-valuetext={`${percentUsed}% 사용`}
                aria-label={`${budget.name ?? budget.scopeLabel} 사용률`}
              >
                <div
                  className={`h-full rounded-full ${barTone(rate)}`}
                  style={{ width: `${Math.min(Math.max(rate, 0), 1) * 100}%` }}
                />
              </div>
              {status ? (
                <p
                  className={`text-caption mt-1.5 font-medium ${STATUS_TONE[status.tone]}`}
                >
                  {status.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

