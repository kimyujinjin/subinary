import type { MonthlyAnalytics } from "@family/contracts";
import { ArrowRight, ChevronRight, CreditCard, Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import React from "react";

import { formatMonth, formatWon } from "@/lib/format";
import { HOME_REVIEW_HREF, visibleReviewCount } from "@/lib/home-finance-summary";

export interface HomeConsumptionCardProps {
  month: string;
  isCurrentMonth: boolean;
  monthly?: MonthlyAnalytics;
  loading: boolean;
  error: boolean;
  reviews: { count: number; loading: boolean; error: boolean; truncated: boolean };
  processing: { count: number; loading: boolean; error: boolean; truncated: boolean };
}

/** 확인할 거래는 별도 카드 없이 관련 소비 금액 옆에서만 안내한다. */
export function HomeConsumptionCard({
  month,
  isCurrentMonth,
  monthly,
  loading,
  error,
  reviews,
  processing,
}: HomeConsumptionCardProps) {
  const reviewCount = visibleReviewCount(reviews);
  const processingCount = visibleReviewCount(processing);
  const amountKnown = !loading && !error && monthly != null && Number.isFinite(monthly.totalNet);
  return (
    <section className="finance-panel flex min-w-0 flex-col p-5 sm:p-6" aria-labelledby="home-consumption-heading">
      <div className="min-w-0 pb-5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="bg-primary/8 text-primary flex size-8 shrink-0 items-center justify-center rounded-xl"><CreditCard className="size-4" aria-hidden="true" /></span>
            <h2 id="home-consumption-heading" className="min-w-0 text-sm font-semibold leading-relaxed">{isCurrentMonth ? "이번 달 카드 사용액" : `${formatMonth(month)} 카드 사용액`}</h2>
          </div>
          <Link href={`/ledger/analysis?month=${encodeURIComponent(month)}`} className="text-muted-foreground hover:text-primary focus-visible:outline-ring -mr-1 inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2" aria-label="카드 사용액 분석">
            분석 <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        {amountKnown ? (
          <p className="mt-3 min-w-0 break-all text-[clamp(1.875rem,5vw,2.25rem)] font-bold leading-tight tracking-[-0.035em] tabular-nums" aria-label="기록된 카드 소비">{formatWon(monthly.totalNet)}</p>
        ) : (
          <p className={`mt-3 py-2 text-sm ${loading ? "text-muted-foreground" : "text-destructive"}`} role={loading ? "status" : "alert"}>
            {loading ? "카드 사용액을 불러오는 중이에요." : "카드 사용액을 불러오지 못했어요."}
          </p>
        )}
        <p className="text-muted-foreground mt-2 text-[11px]">결제 취소 반영</p>
        {reviewCount !== null ? (
          <Link href={HOME_REVIEW_HREF} className="bg-primary/5 text-primary focus-visible:outline-ring mt-4 flex min-h-11 items-center gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">확인할 거래 {reviewCount.toLocaleString("ko-KR")}{reviews.truncated ? "+" : ""}건 · 전체 기간</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          </Link>
        ) : null}
        {processingCount !== null ? (
          <div className="text-muted-foreground mt-2 text-xs leading-relaxed" role="status">
            <Link href="/todo?section=processing" className="focus-visible:outline-ring flex min-h-11 items-center gap-2 rounded-xl py-2 focus-visible:outline-2 focus-visible:outline-offset-2">
              <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block">문자·환율 확인 대기 {processingCount.toLocaleString("ko-KR")}{processing.truncated ? "+" : ""}건</span>
                <span className="mt-0.5 block text-[11px]">아직 사용액에 포함되지 않았어요.</span>
                <span className="sr-only">처리 상태 보기</span>
              </span>
              <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>
      <div className="border-border/70 mt-auto flex min-w-0 flex-wrap items-center justify-between gap-x-3 border-t pt-1">
        <Link href={`/transactions?month=${encodeURIComponent(month)}`} className="text-primary hover:text-foreground focus-visible:outline-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg py-2.5 pr-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
          카드 내역 보기 <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
        </Link>
        <Link href={`/budgets?month=${encodeURIComponent(month)}`} className="text-muted-foreground hover:text-foreground focus-visible:outline-ring inline-flex min-h-11 items-center rounded-lg py-2.5 pl-2 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
          예산 관리
        </Link>
      </div>
    </section>
  );
}
