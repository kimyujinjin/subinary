import type { MonthlyAnalytics } from "@family/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import React from "react";

import { MonthSwitcher } from "@/components/widgets/month-switcher";
import { StatusChip } from "@/components/widgets/status-chip";
import { formatMonth, formatWon } from "@/lib/format";
import {
  HOME_REVIEW_HREF,
  visibleReviewCount,
} from "@/lib/home-finance-summary";

export interface HomeConsumptionCardProps {
  month: string;
  isCurrentMonth: boolean;
  monthly?: MonthlyAnalytics;
  loading: boolean;
  error: boolean;
  reviews: {
    count: number;
    loading: boolean;
    error: boolean;
    truncated: boolean;
  };
  processing: {
    count: number;
    loading: boolean;
    error: boolean;
    truncated: boolean;
  };
  /**
   * 거래가 있는 달 목록. `onMonthChange`와 함께 주면 카드 안에서 달을 옮길 수 있다.
   * 월 이동은 **이 카드의 금액에만** 영향을 주므로 컨트롤도 여기 둔다.
   */
  months?: readonly string[];
  onMonthChange?: (month: string) => void;
}

/**
 * 전월 비교 한 줄(§5 홈 1).
 *
 * 이번 달은 아직 끝나지 않아 지난달 전체와 비교하면 매달 초에 "덜 썼어요"가 된다 —
 * 그래서 이번 달은 비교 대신 지난달 합계를 참고로만 보여주고, 끝난 달만 증감을 말한다.
 */
export function monthComparison(
  monthly: MonthlyAnalytics,
  isCurrentMonth: boolean
): string | null {
  if (!Number.isFinite(monthly.previousNet) || monthly.previousNet === 0)
    return null;
  if (isCurrentMonth) return `지난달 전체 ${formatWon(monthly.previousNet)}`;
  if (monthly.deltaNet === 0) return "전달과 같아요";
  return `전달보다 ${formatWon(Math.abs(monthly.deltaNet))} ${
    monthly.deltaNet > 0 ? "더 썼어요" : "덜 썼어요"
  }`;
}

const ROW =
  "text-body hover:bg-muted/50 focus-visible:outline-ring -mx-5 flex min-h-12 items-center gap-2 px-5 focus-visible:outline-2 focus-visible:-outline-offset-2";

/** 확인할 거래는 별도 카드 없이 관련 소비 금액 아래 한 줄로만 안내한다. */
export function HomeConsumptionCard({
  month,
  isCurrentMonth,
  monthly,
  loading,
  error,
  reviews,
  processing,
  months,
  onMonthChange,
}: HomeConsumptionCardProps) {
  const reviewCount = visibleReviewCount(reviews);
  const processingCount = visibleReviewCount(processing);
  const amountKnown =
    !loading && !error && monthly != null && Number.isFinite(monthly.totalNet);
  const comparison = amountKnown
    ? monthComparison(monthly, isCurrentMonth)
    : null;
  return (
    <section
      className="finance-panel flex min-w-0 flex-col px-5 pt-3"
      aria-labelledby="home-consumption-heading"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        {onMonthChange ? (
          <MonthSwitcher
            month={month}
            months={months}
            onChange={onMonthChange}
            className="-ml-2"
          />
        ) : (
          <span className="text-caption text-muted-foreground">
            {formatMonth(month)}
          </span>
        )}
        <Link
          href={`/ledger/analysis?month=${encodeURIComponent(month)}`}
          className="text-caption text-muted-foreground hover:text-foreground -mr-2 inline-flex min-h-11 items-center gap-0.5 px-2 font-medium"
          aria-label="카드 사용액 분석"
        >
          분석 <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <h2
        id="home-consumption-heading"
        className="text-caption text-muted-foreground mt-1"
      >
        {isCurrentMonth
          ? "이번 달 카드 사용액"
          : onMonthChange
          ? "카드 사용액"
          : `${formatMonth(month)} 카드 사용액`}
      </h2>
      {amountKnown ? (
        <p
          className="text-display mt-1 min-w-0 break-all tracking-tight tabular-nums"
          aria-label="기록된 카드 소비"
        >
          {formatWon(monthly.totalNet)}
        </p>
      ) : (
        <p
          className={`text-body mt-1 py-2 ${
            loading ? "text-muted-foreground" : "text-destructive"
          }`}
          role={loading ? "status" : "alert"}
        >
          {loading
            ? "카드 사용액을 불러오는 중이에요."
            : "카드 사용액을 불러오지 못했어요."}
        </p>
      )}
      <p className="text-caption text-muted-foreground mt-1">
        {comparison ? `${comparison} · ` : ""}결제 취소 반영
      </p>
      <div className="divide-border/60 mt-4 divide-y border-t border-border/60">
        {reviewCount !== null ? (
          <Link href={HOME_REVIEW_HREF} className={ROW}>
            <span className="min-w-0 flex-1">
              확인할 거래 {reviewCount.toLocaleString("ko-KR")}
              {reviews.truncated ? "+" : ""}건
            </span>
            <span className="text-caption text-muted-foreground">
              전체 기간
            </span>
            <ChevronRight
              className="text-muted-foreground/60 size-5 shrink-0"
              aria-hidden="true"
            />
          </Link>
        ) : null}
        {processingCount !== null ? (
          <div role="status">
            <Link href="/todo?section=processing" className={ROW}>
              <span className="min-w-0 flex-1">
                문자·환율 확인 대기 {processingCount.toLocaleString("ko-KR")}
                {processing.truncated ? "+" : ""}건
              </span>
              <StatusChip tone="pending">사용액 미포함</StatusChip>
              <ChevronRight
                className="text-muted-foreground/60 size-5 shrink-0"
                aria-hidden="true"
              />
            </Link>
          </div>
        ) : null}
        <Link
          href={`/transactions?month=${encodeURIComponent(month)}`}
          className={ROW}
        >
          <span className="min-w-0 flex-1">카드 내역</span>
          <ChevronRight
            className="text-muted-foreground/60 size-5 shrink-0"
            aria-hidden="true"
          />
        </Link>
      </div>
    </section>
  );
}
