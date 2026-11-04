"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo } from "react";

import { HomeConsumptionCard } from "@/components/home-consumption-card";
import { HomeHousingCard } from "@/components/home-housing-card";
import { HomeAssetSection, HomeBudgetSummary } from "@/components/home-summary-rows";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { useTodoCounts } from "@/components/widgets";
import { currentMonth } from "@/lib/format";
import { useManualHousingPlans } from "@/lib/manual-finance-client";
import { useFinancialOverview } from "@/lib/loan-import-client";
import { isMonthKey } from "@/lib/month";
import { useAnalyticsMonths, useBudgets, useMonthly } from "@/lib/queries";

const POLL_INTERVAL_MS = 60_000;

/** 홈에서는 기록만 표시하며 잔액이나 거래를 변경하지 않는다. */
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <HomeView />
    </Suspense>
  );
}

function HomeView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const thisMonth = currentMonth();
  const selectedMonth = searchParams.get("month");
  const month =
    selectedMonth && isMonthKey(selectedMonth) ? selectedMonth : thisMonth;
  // 자산 공개 범위는 기존 카드 내역의 공개 정책과 별도로 유지한다.
  const scope = "household" as const;
  const { householdId } = useHousehold();
  const { user } = useAuth();
  const assets = useFinancialOverview(scope);
  const housing = useManualHousingPlans(scope);
  const monthly = useMonthly(month, { refetchInterval: POLL_INTERVAL_MS });
  const todo = useTodoCounts({ refetchInterval: POLL_INTERVAL_MS });
  const budgets = useBudgets(month);
  // 홈이 `?month=`를 읽기만 하고 바꿀 수단이 없었다 — 어떤 화면도 그 링크를 걸지
  // 않아 사실상 닿을 수 없는 파라미터였다. 분석·예산과 같은 스위처를 쓴다.
  const monthsQuery = useAnalyticsMonths();
  const availableMonths = useMemo(
    () => monthsQuery.data?.items.map((item) => item.month),
    [monthsQuery.data]
  );
  // 이번 달이면 파라미터를 지워 링크를 짧게 유지하고, replace로 뒤로가기 기록에
  // 달 이동 횟수만큼 쌓지 않는다(분석 화면과 같은 규칙).
  const changeMonth = useCallback(
    (next: string) => {
      router.replace(
        next === thisMonth
          ? "/dashboard"
          : `/dashboard?month=${encodeURIComponent(next)}`,
        { scroll: false }
      );
    },
    [router, thisMonth]
  );
  const housingSummary = housing.data?.summary;
  // 일정도 없고 빈 항목도 없으면 홈에서 주택 카드를 숨긴다(§5 홈 4). 불러오는 중·실패는 보여준다.
  const showHousing =
    housing.isPending ||
    housing.isError ||
    !!housingSummary?.nextPayment ||
    !!housingSummary?.hasIncompletePayments;
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4">
      <h1 className="sr-only">홈</h1>
      <HomeConsumptionCard
        month={month}
        isCurrentMonth={month === thisMonth}
        monthly={monthly.data}
        loading={monthly.isLoading}
        error={monthly.isError}
        reviews={{
          count: todo.reviews.length,
          loading: todo.reviewsLoading,
          error: todo.reviewsError,
          truncated: todo.reviewsTruncated,
        }}
        processing={{
          count: todo.processing.length,
          loading: todo.processingLoading,
          error: todo.processingError,
          truncated: todo.processingTruncated,
        }}
        months={availableMonths}
        onMonthChange={changeMonth}
      />
      {budgets.data ? <HomeBudgetSummary items={budgets.data.items} month={month} /> : null}
      {showHousing ? (
        <HomeHousingCard
          scope={scope}
          summary={housingSummary}
          loading={housing.isPending}
          error={housing.isError}
        />
      ) : null}
      {householdId && user ? (
      <HomeAssetSection
        householdId={householdId}
        userId={user.id}
        summary={assets.data?.summary}
        loading={assets.isPending}
        error={assets.isError}
        unresolvedLoans={assets.data?.unresolvedLoans}
      />
      ) : null}
    </div>
  );
}
