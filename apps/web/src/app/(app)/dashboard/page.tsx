"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { HomeConsumptionCard } from "@/components/home-consumption-card";
import { HomeHousingCard } from "@/components/home-housing-card";
import { ManualAssetsSummary } from "@/components/manual-finance/asset-summary";
import { useTodoCounts } from "@/components/widgets";
import { currentMonth } from "@/lib/format";
import { useManualHousingPlans } from "@/lib/manual-finance-client";
import { useFinancialOverview } from "@/lib/loan-import-client";
import { isMonthKey } from "@/lib/month";
import { useMonthly } from "@/lib/queries";

const POLL_INTERVAL_MS = 60_000;

/** 홈에서는 기록만 표시하며 잔액이나 거래를 변경하지 않는다. */
export default function DashboardPage() {
  return <Suspense fallback={null}><HomeView /></Suspense>;
}

function HomeView() {
  const searchParams = useSearchParams();
  const thisMonth = currentMonth();
  const selectedMonth = searchParams.get("month");
  const month = selectedMonth && isMonthKey(selectedMonth) ? selectedMonth : thisMonth;
  // 자산 공개 범위는 기존 카드 내역의 공개 정책과 별도로 유지한다.
  const scope = "household" as const;
  const assets = useFinancialOverview(scope);
  const housing = useManualHousingPlans(scope);
  const monthly = useMonthly(month, { refetchInterval: POLL_INTERVAL_MS });
  const todo = useTodoCounts({ refetchInterval: POLL_INTERVAL_MS });
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-5 sm:gap-6">
      <header className="pt-1">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-3xl">홈</h1>
      </header>

      <section className="bg-finance-hero text-finance-hero-foreground min-w-0 overflow-hidden rounded-[1.75rem] shadow-[0_12px_32px_-20px_rgba(15,31,61,0.55)]" aria-label="가족 자산">
        {assets.isPending || assets.isError || !assets.data ? (
          <div className="min-h-36 p-5 sm:p-6">
            <h2 className="text-sm font-semibold">가족과 공유한 자산</h2>
            <p className={`mt-6 text-sm ${assets.isError ? "text-finance-hero-foreground" : "text-finance-hero-muted"}`} role={assets.isError ? "alert" : "status"}>{assets.isError ? "자산을 불러오지 못했어요." : "자산을 불러오는 중이에요."}</p>
          </div>
        ) : <ManualAssetsSummary summary={assets.data.summary} scope={scope} hasImportedBalance={assets.data.loanItems.some((item) => item.includedInTotals)} sourceLabel={assets.data.loanItems.some((item) => item.includedInTotals) ? "직접 입력·이전 대출 기록" : "직접 입력"} />}
        {assets.data && !assets.isError && assets.data.unresolvedLoans > 0 ? (
          <p role="status" className="text-finance-hero-muted px-5 pb-4 text-xs leading-relaxed sm:px-6">확인이 필요한 대출 {assets.data.unresolvedLoans}건은 합계에서 제외했어요.</p>
        ) : null}
        <Link href={`/assets?scope=${scope}`} className="text-finance-hero-foreground bg-white/5 hover:bg-white/10 focus-visible:outline-finance-highlight flex min-h-12 items-center justify-between gap-2 border-t border-white/10 px-5 py-3 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:px-6">자산 보기 <ArrowRight className="text-finance-highlight size-4 shrink-0" aria-hidden="true" /></Link>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <HomeConsumptionCard
        month={month}
        isCurrentMonth={month === thisMonth}
        monthly={monthly.data}
        loading={monthly.isLoading}
        error={monthly.isError}
        reviews={{ count: todo.reviews.length, loading: todo.reviewsLoading, error: todo.reviewsError, truncated: todo.reviewsTruncated }}
        processing={{ count: todo.processing.length, loading: todo.processingLoading, error: todo.processingError, truncated: todo.processingTruncated }}
      />

      <HomeHousingCard scope={scope} summary={housing.data?.summary} loading={housing.isPending} error={housing.isError} />
      </div>
      <details className="group text-muted-foreground px-1 text-xs leading-relaxed sm:px-2">
        <summary className="focus-visible:outline-ring flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg pr-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">금액 계산 기준 <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
        <p className="max-w-prose pb-3 leading-6">자산은 직접 입력한 금액과 합계 반영을 선택한 신한 대출로 계산해요. 가져온 대출은 브라우저에서 확인한 시점의 남은 원금이며, 은행의 별도 금액 기준일은 제공되지 않아요. 참고용 대출과 주택 계약금액은 합계에서 제외해요. 카드 사용액은 내가 볼 수 있는 승인·취소 내역을 기준으로 해요.</p>
      </details>
    </div>
  );
}
