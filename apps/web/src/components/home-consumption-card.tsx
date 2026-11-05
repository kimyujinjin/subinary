import type { MonthlyAnalytics } from "@family/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import React from "react";

import { MonthSwitcher } from "@/components/widgets/month-switcher";
import { formatMonth, formatWon } from "@/lib/format";
import {
  homeFxWaitRow,
  homeProcessingText,
  homeTodoRows,
  type HomeProcessingSource,
  type HomeTodoSources,
} from "@/lib/home-finance-summary";

export interface HomeConsumptionCardProps {
  month: string;
  isCurrentMonth: boolean;
  monthly?: MonthlyAnalytics;
  loading: boolean;
  error: boolean;
  /**
   * 할 일 줄. 순서는 `HOME_TODO_ORDER`를 따르고(할 일 화면 섹션 순서), 할 일 화면과
   * 같은 기준으로 세며, 건수를 아는 1건 이상만 보인다.
   */
  todo: HomeTodoSources;
  /**
   * 처리 대기 문자. 할 일이 아니라 합계에 넣지 않는다 — 반영하는 중인 문자는 회색 상태
   * 문구로, 환율이 없어 멈춘 문자는 할 일 화면 처리 대기 섹션으로 가는 줄로 보인다.
   */
  processing?: HomeProcessingSource;
  /**
   * 거래가 있는 달 목록. `onMonthChange`와 함께 주면 카드 안에서 달을 옮길 수 있다.
   * 월 이동은 **이 카드의 금액에만** 영향을 주므로 컨트롤도 여기 둔다.
   */
  months?: readonly string[];
  onMonthChange?: (month: string) => void;
  /**
   * 이번 달 페이스("지난달 이맘때보다 …"). 있으면 비교 줄을 이것으로 쓴다. 없으면(이번 달
   * 첫 한 시간·지난달 기록 없음·과거 달) 기존 전월 비교로 돌아간다.
   */
  pace?: string | null;
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

// py-3: 한 줄이면 min-h-12(48px) 그대로이고, 긴 문구가 두 줄로 접혀도 구분선에 붙지 않는다.
const ROW =
  "text-body hover:bg-muted/50 focus-visible:outline-ring -mx-5 flex min-h-12 items-center gap-2 px-5 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 active:bg-muted";

/** 할 일은 별도 카드 없이 소비 금액 아래 줄로만 안내한다. */
export function HomeConsumptionCard({
  month,
  isCurrentMonth,
  monthly,
  loading,
  error,
  todo,
  processing,
  months,
  onMonthChange,
  pace,
}: HomeConsumptionCardProps) {
  const rows = homeTodoRows(todo);
  const processingText = homeProcessingText(processing);
  const fxWait = homeFxWaitRow(processing);
  const amountKnown =
    !loading && !error && monthly != null && Number.isFinite(monthly.totalNet);
  const comparison = amountKnown
    ? pace ?? monthComparison(monthly, isCurrentMonth)
    : null;
  return (
    <section
      className="finance-panel panel-flush-top flex min-w-0 flex-col px-5 pt-1"
      aria-labelledby="home-consumption-heading"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        {onMonthChange ? (
          <MonthSwitcher
            month={month}
            months={months}
            onChange={onMonthChange}
            className="-ml-3"
          />
        ) : (
          <span className="text-caption text-muted-foreground">
            {formatMonth(month)}
          </span>
        )}
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
      {/* 금액을 모를 때 '결제 취소 반영'만 남으면 없는 숫자에 단서를 다는 셈이라 함께 숨긴다. */}
      {amountKnown ? (
        <p className="text-caption text-muted-foreground mt-1">
          {comparison ? `${comparison} · ` : ""}결제 취소 반영
        </p>
      ) : null}
      {processingText ? (
        <p role="status" className="text-caption text-muted-foreground mt-1">
          {processingText}
        </p>
      ) : null}
      {rows.length > 0 || fxWait ? (
        <div className="divide-border/60 mt-4 divide-y border-t border-border/60">
          {rows.map((row) => (
            <Link key={row.key} href={row.href} className={ROW}>
              <span className="min-w-0 flex-1">{row.text}</span>
              <ChevronRight
                className="text-muted-foreground/60 size-5 shrink-0"
                aria-hidden="true"
              />
            </Link>
          ))}
          {/* 할 일이 아닌 상태라 할 일 줄 뒤에 둔다. */}
          {fxWait ? (
            <Link href={fxWait.href} className={ROW}>
              <span className="min-w-0 flex-1">{fxWait.text}</span>
              <ChevronRight
                className="text-muted-foreground/60 size-5 shrink-0"
                aria-hidden="true"
              />
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="pb-4" />
      )}
    </section>
  );
}
