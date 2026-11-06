"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo } from "react";
import type { MemberColor, RecurringUpcomingResponse } from "@family/contracts";

import { HomeConsumptionCard } from "@/components/home-consumption-card";
import {
  HomeMemberSplit,
  HomeUpcoming,
  HomeWeeklyRecap,
} from "@/components/home-insight-sections";
import { HomeBudgetSummary } from "@/components/home-summary-rows";
import { useTodoCounts } from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { currentMonth } from "@/lib/format";
import {
  homeProcessingSource,
  homeTodoSources,
} from "@/lib/home-finance-summary";
import {
  buildUpcomingRows,
  lastWeekWindow,
  paceText,
  previousMonthToDate,
  shiftMonth,
  upcomingUntil,
} from "@/lib/home-insights";
import { useHousehold } from "@/lib/household-context";
import { useManualHousingPlans } from "@/lib/manual-finance-client";
import { isMonthKey } from "@/lib/month";
import {
  useAnalyticsMonths,
  useBudgets,
  useCardList,
  useCards,
  useCategoriesRange,
  useHouseholdMembers,
  useMembers,
  useMonthly,
  useMonthlyRange,
} from "@/lib/queries";
import {
  fetchRecurringUpcoming,
  recurringUpcomingQueryKey,
} from "@/lib/recurring-api";
import { useReviewRequests } from "@/lib/review-requests";

const POLL_INTERVAL_MS = 60_000;

/**
 * 홈(2026-11-04 개편). 탭 첫 화면과 겹치는 바로가기(분석·카드 내역·순자산)는 두지 않고,
 * 탭에 들어가야만 알 수 있는 것을 질문 순서대로 보여준다:
 * 이번 달 괜찮나(사용액 + 지난달 이맘때) → 누가 썼나 → 예산 → 곧 나갈 돈 → 지난주.
 * 달 이동(`?month=`)은 소비 카드의 금액·비교 문구에만 적용한다. 아래 섹션은 제목에 달이 없어 늘 이번 달로
 * 읽히므로 데이터도 늘 이번 달이다 — 지난 달을 고르면 그 달 예산이 이번 달 예산처럼 보였다(2026-11-06 결정 ②).
 * 홈에서는 기록만 표시하며 잔액이나 거래를 변경하지 않는다.
 */
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
  const isCurrentMonth = month === thisMonth;
  const scope = "household" as const;
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  // 창 계산 기준 시각. 창은 시간·날·주 단위로 내려 잡아 렌더마다 쿼리 키가 바뀌지 않는다.
  const now = new Date();

  // 고른 달은 소비 카드에만 쓴다. 아래 섹션은 전부 thisMonth·now 기준이다.
  const monthly = useMonthly(month, { refetchInterval: POLL_INTERVAL_MS });
  const todo = useTodoCounts({ refetchInterval: POLL_INTERVAL_MS });
  const requests = useReviewRequests(null, {
    refetchInterval: POLL_INTERVAL_MS,
  });
  const budgets = useBudgets(thisMonth);
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

  // 페이스: 지난달 같은 시점까지의 합계. 지난달 기록이 아예 없으면 "더 썼어요"가 거짓이
  // 되므로 묻지 않는다.
  const previousMonth = shiftMonth(thisMonth, -1);
  const hasPreviousMonth = availableMonths?.includes(previousMonth) ?? false;
  const pace = useMonthlyRange(
    isCurrentMonth && hasPreviousMonth ? previousMonthToDate(now) : null
  );
  const paceLine =
    isCurrentMonth && pace.data && monthly.data
      ? paceText(monthly.data.totalNet, pace.data.totalNet)
      : null;

  // 누가 썼나: 이번 달 구성원별 집계. 색은 카드·거래 아이콘과 같은 구성원 색.
  const members = useMembers(thisMonth);
  const householdMembers = useHouseholdMembers();
  const colorOf = useCallback(
    (memberId: string): MemberColor | null =>
      householdMembers.data?.find((member) => member.memberId === memberId)
        ?.color ?? null,
    [householdMembers.data]
  );

  // 지난주(월~일). 오늘 기준 창이라 카드의 달 선택과 상관없이 보인다.
  const week = lastWeekWindow(now);
  const weekly = useMonthlyRange(week);
  const weeklyCategories = useCategoriesRange(week);

  // 다가오는 지출: 정기 결제(7일) · 카드 결제일(7일) · 주택 납부(30일). 오늘 기준이라 달 선택과 상관없다.
  const housing = useManualHousingPlans(scope);
  const until = upcomingUntil(now);
  const recurring = useQuery<RecurringUpcomingResponse>({
    queryKey: recurringUpcomingQueryKey(householdId, until),
    enabled: householdId != null,
    queryFn: () =>
      authedFetch((token) =>
        fetchRecurringUpcoming(token, householdId as string, until)
      ),
  });
  const cardList = useCardList();
  const billingCards = useMemo(
    () =>
      (cardList.data ?? []).filter(
        (card) => card.status === "active" && card.billingDay != null
      ),
    [cardList.data]
  );
  const cardSpend = useCards(previousMonth, {
    enabled: billingCards.length > 0,
  });
  const lastMonthCardSpend = useMemo(
    () =>
      cardSpend.data
        ? new Map(
            cardSpend.data.items.flatMap((item) =>
              item.cardId ? [[item.cardId, item.net] as const] : []
            )
          )
        : null,
    [cardSpend.data]
  );
  const upcomingRows = buildUpcomingRows({
    now,
    recurring: recurring.data?.enabled ? recurring.data.items : [],
    // 주택은 조회가 성공했을 때만 — 실패·로딩 중의 캐시 값을 일정처럼 말하지 않는다.
    housing: housing.isSuccess ? housing.data.summary : null,
    cards: billingCards.map((card) => ({
      id: card.id,
      alias: card.alias,
      status: card.status,
      billingDay: card.billingDay ?? null,
    })),
    lastMonthCardSpend,
  });

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4">
      <h1 className="sr-only">홈</h1>
      <HomeConsumptionCard
        month={month}
        isCurrentMonth={isCurrentMonth}
        monthly={monthly.data}
        loading={monthly.isLoading}
        error={monthly.isError}
        onRetry={() => void monthly.refetch()}
        retrying={monthly.isFetching}
        pace={paceLine}
        // 할 일 화면·가계부 배지와 같은 useTodoCounts 기준으로 센다(lib/home-finance-summary).
        todo={homeTodoSources(todo, {
          count:
            requests.data?.items.filter((item) => item.direction === "received")
              .length ?? 0,
          loading: requests.isLoading,
          error: requests.isError,
        })}
        processing={homeProcessingSource(todo)}
        months={availableMonths}
        onMonthChange={changeMonth}
      />
      <HomeMemberSplit
        breakdown={members.data}
        loading={members.isLoading}
        error={members.isError}
        colorOf={colorOf}
      />
      <HomeBudgetSummary
        items={budgets.data?.items}
        month={thisMonth}
        error={budgets.isError}
        onRetry={() => void budgets.refetch()}
        retrying={budgets.isFetching}
      />
      <HomeUpcoming rows={upcomingRows} />
      <HomeWeeklyRecap
        week={week}
        monthly={weekly.data}
        categories={weeklyCategories.data}
        loading={weekly.isLoading}
        error={weekly.isError}
      />
    </div>
  );
}
