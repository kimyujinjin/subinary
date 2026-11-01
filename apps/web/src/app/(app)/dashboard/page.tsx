"use client";

import type { ManualFinanceScope } from "@family/contracts";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { HomeConsumptionCard } from "@/components/home-consumption-card";
import { HomeHousingCard } from "@/components/home-housing-card";
import { ManualAssetsSummary } from "@/components/manual-finance/asset-summary";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsageBar, useTodoCounts } from "@/components/widgets";
import { currentMonth, formatMonth } from "@/lib/format";
import { useHousehold } from "@/lib/household-context";
import { useManualAssets, useManualHousingPlans } from "@/lib/manual-finance-client";
import { isMonthKey } from "@/lib/month";
import { useBudgets, useMonthly } from "@/lib/queries";

const POLL_INTERVAL_MS = 60_000;

/** The home page displays records; it never changes a balance or a transaction. */
export default function DashboardPage() {
  return <Suspense fallback={null}><HomeView /></Suspense>;
}

function HomeView() {
  const { activeMembership } = useHousehold();
  const searchParams = useSearchParams();
  const thisMonth = currentMonth();
  const selectedMonth = searchParams.get("month");
  const month = selectedMonth && isMonthKey(selectedMonth) ? selectedMonth : thisMonth;
  // This is a view of manual records, not a new card visibility policy.
  const [scope, setScope] = useState<ManualFinanceScope>("household");
  const assets = useManualAssets(scope);
  const housing = useManualHousingPlans(scope);
  const monthly = useMonthly(month, { refetchInterval: POLL_INTERVAL_MS });
  const budgets = useBudgets(month);
  const todo = useTodoCounts({ refetchInterval: POLL_INTERVAL_MS });
  const topBudgets = useMemo(() => [...(budgets.data?.items ?? [])]
    .sort((a, b) => b.usageRate - a.usageRate).slice(0, 3), [budgets.data]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm">{activeMembership?.name ?? "선택한 가족"}의 돈과 계획</p>
        <h1 className="text-2xl font-bold tracking-tight">재산부터 다음 지급까지</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">직접 기록한 현재 자산과 카드 소비, 주택 지급 일정을 함께 살펴봐요.</p>
      </header>

      <section aria-label="자산과 주택 기록 보기 범위" className="space-y-2">
        <div className="bg-muted grid grid-cols-2 gap-1 rounded-xl p-1">
          {([['household', '가족 공유'], ['private', '나만 보기']] as const).map(([value, label]) => (
            <Button key={value} type="button" variant={scope === value ? "default" : "ghost"} className="min-h-11 min-w-0" aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</Button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs leading-relaxed">자산·주택 기록의 보기 필터예요. 아래 카드 소비의 기존 공개 정책을 바꾸지 않아요.</p>
      </section>

      {assets.isPending || assets.isError || !assets.data ? (
        <Card><CardHeader><CardTitle>입력한 자산 현황</CardTitle><CardDescription>{scope === "household" ? "공유한" : "내 비공개"} 기록만 확인해요.</CardDescription></CardHeader><CardContent className="space-y-2"><p className="text-3xl font-bold tabular-nums">— 원</p><p className={assets.isError ? "text-destructive text-sm" : "text-muted-foreground text-sm"} role={assets.isError ? "alert" : "status"}>{assets.isError ? "자산 기록을 불러오지 못했어요. 확인되지 않은 값을 0원으로 표시하지 않아요." : "자산 기록을 확인하고 있어요."}</p></CardContent></Card>
      ) : <ManualAssetsSummary summary={assets.data.summary} scope={scope} />}
      <Link href={`/assets?scope=${scope}`} className="text-primary -mt-3 inline-flex min-h-11 items-center justify-end gap-1 text-sm font-medium">자산별 기준일·출처 보기 <ArrowRight className="size-4" aria-hidden="true" /></Link>

      <HomeConsumptionCard
        month={month}
        isCurrentMonth={month === thisMonth}
        monthly={monthly.data}
        loading={monthly.isLoading}
        error={monthly.isError}
        reviews={{ count: todo.reviews.length, loading: todo.reviewsLoading, error: todo.reviewsError, truncated: todo.reviewsTruncated }}
        processing={{ count: todo.processing.length, loading: todo.processingLoading, error: todo.processingError, truncated: todo.processingTruncated }}
      />

      <Card>
        <CardHeader><CardTitle>{month === thisMonth ? "이번 달 예산" : `${formatMonth(month)} 예산`}</CardTitle><CardDescription>예산별 범위를 따로 확인해요. 겹치는 예산을 더하지 않아요.</CardDescription><CardAction><Link href={`/budgets?month=${encodeURIComponent(month)}`} className="text-primary inline-flex min-h-11 items-center text-[13px]">예산 보기</Link></CardAction></CardHeader>
        <CardContent>
          {budgets.isLoading ? <p className="text-muted-foreground text-sm" role="status">예산을 불러오고 있어요.</p> : budgets.isError ? <p className="text-destructive text-sm" role="alert">예산을 불러오지 못했어요.</p> : topBudgets.length === 0 ? <p className="text-muted-foreground text-sm">아직 설정한 예산이 없어요. 사용률을 0%로 표시하지 않아요.</p> : <div className="space-y-4">{topBudgets.map((budget) => <UsageBar key={budget.id} label={budget.name ?? budget.scopeLabel} meta={budget.scopeLabel} spent={budget.spent} amount={budget.amount} currency={budget.currency} usageRate={budget.usageRate} href={`/budgets?month=${encodeURIComponent(month)}`} hrefLabel="예산 상세 보기" />)}</div>}
        </CardContent>
      </Card>

      <HomeHousingCard scope={scope} summary={housing.data?.summary} loading={housing.isPending} error={housing.isError} />
      <details className="text-muted-foreground rounded-xl border px-4 py-2 text-xs leading-relaxed">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">이 화면의 합계 기준</summary>
        <p className="pb-3">자산·주택은 선택한 보기 범위의 수동 기록이며 실제 은행·증권 정보와 연결하지 않아요. 카드 소비는 기존 카드 공개 정책으로 열람할 수 있는 승인·취소 기록을 사용해요. 주택 계약금액·재원 메모를 현재 자산 가치로 더하거나 거래와 잔액을 자동 변경하지 않아요.</p>
      </details>
    </div>
  );
}
