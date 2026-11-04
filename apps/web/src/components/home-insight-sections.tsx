/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 홈 인사이트 섹션 (2026-11-04 홈 개편)
 *
 * 홈은 탭 바로가기를 두지 않고(분석·카드 내역·순자산 제거), 탭에 들어가야만 알 수
 * 있는 것을 보여준다: 누가 얼마 썼나 · 곧 나갈 돈 · 지난주. 셋 다 **보조 정보**라
 * 로딩·실패·빈 상태에는 아무것도 그리지 않는다 — 홈에 실패 문구가 늘어나는 것보다
 * 조용히 없는 편이 낫다(카드 사용액 히어로는 자기 상태를 말한다).
 *
 * 화면당 대표 숫자는 카드 사용액 하나다. 여기서는 금액을 본문 크기로만 쓴다.
 * ------------------------------------------------------------------------- */
import type {
  CategoryBreakdown,
  MemberBreakdown,
  MemberColor,
  MonthlyAnalytics,
} from "@family/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import React from "react";

import { SectionHeader } from "@/components/widgets/section-header";
import { formatWon } from "@/lib/format";
import {
  weeklyDeltaText,
  type UpcomingRow,
  type WeekWindow,
} from "@/lib/home-insights";
import { memberSwatchClass } from "@/lib/member-color";

/**
 * 가족별 사용(가구 합계 아래 사람별 비중). 한 사람만 썼으면 나눌 게 없으니 그리지 않는다.
 * '공용'(공용 카드) 버킷은 사람이 아니므로 중립색이다.
 */
export function HomeMemberSplit({
  breakdown,
  loading,
  error,
  colorOf,
}: {
  breakdown?: MemberBreakdown;
  loading: boolean;
  error: boolean;
  colorOf: (memberId: string) => MemberColor | null;
}) {
  if (loading || error || !breakdown) return null;
  const items = breakdown.items.filter(
    (item) => Number.isFinite(item.net) && item.net > 0
  );
  const total = items.reduce((sum, item) => sum + item.net, 0);
  if (items.length < 2 || total <= 0) return null;
  const rows = items.map((item) => ({
    ...item,
    percent: Math.round((item.net / total) * 100),
    swatch: item.memberId
      ? memberSwatchClass(item.memberId, colorOf(item.memberId))
      : memberSwatchClass(null),
  }));
  return (
    <section
      className="finance-panel min-w-0 px-5 pb-4 pt-2"
      aria-label="가족별 사용"
    >
      <SectionHeader title="누가 썼나" />
      <div
        className="bg-muted flex h-2 overflow-hidden rounded-full"
        role="img"
        aria-label={rows.map((row) => `${row.name} ${row.percent}%`).join(", ")}
      >
        {rows.map((row) => (
          <span
            key={row.memberId ?? "shared"}
            className={`h-full ${row.swatch}`}
            style={{ width: `${(row.net / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li
            key={row.memberId ?? "shared"}
            className="text-body flex min-w-0 items-center gap-2"
          >
            <span
              className={`size-2 shrink-0 rounded-full ${row.swatch}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <span className="text-caption text-muted-foreground tabular-nums">
              {row.percent}%
            </span>
            <span className="tabular-nums">{formatWon(row.net)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const UPCOMING_ROW =
  "hover:bg-muted/50 focus-visible:outline-ring -mx-5 flex min-h-14 min-w-0 items-center gap-3 px-5 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2";

/** 다가오는 지출(정기 결제·카드 결제일 7일, 주택 납부 30일). 행이 없으면 그리지 않는다. */
export function HomeUpcoming({ rows }: { rows: readonly UpcomingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section
      className="finance-panel min-w-0 px-5 pb-2 pt-2"
      aria-label="다가오는 지출"
    >
      <SectionHeader title="다가오는 지출" />
      <ul className="divide-border/60 divide-y">
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={row.href} className={UPCOMING_ROW}>
              <span
                className={`text-caption w-16 shrink-0 font-medium ${
                  row.overdue ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {row.when}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-body block truncate font-medium">
                  {row.title}
                </span>
                {row.subtitle ? (
                  <span className="text-caption text-muted-foreground block truncate">
                    {row.subtitle}
                  </span>
                ) : null}
              </span>
              {row.amountText ? (
                <span className="text-body shrink-0 tabular-nums">
                  {row.amountText}
                </span>
              ) : null}
              <ChevronRight
                className="text-muted-foreground/60 size-5 shrink-0"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 지난주(월~일) 회고. 주 단위로 한 번 열어 볼 이유를 준다. 지난주 거래가 없거나
 * 못 읽었으면 그리지 않는다.
 */
export function HomeWeeklyRecap({
  week,
  monthly,
  categories,
  loading,
  error,
}: {
  week: WeekWindow;
  monthly?: MonthlyAnalytics;
  categories?: CategoryBreakdown;
  loading: boolean;
  error: boolean;
}) {
  if (
    loading ||
    error ||
    !monthly ||
    !Number.isFinite(monthly.totalNet) ||
    monthly.transactionCount === 0
  )
    return null;
  const delta = weeklyDeltaText(monthly.totalNet, monthly.previousNet);
  const top = [...(categories?.items ?? [])]
    .filter((item) => item.net > 0)
    .sort((a, b) => b.net - a.net)[0];
  return (
    <section
      className="finance-panel min-w-0 px-5 pb-4 pt-2"
      aria-label="지난주"
    >
      <SectionHeader
        title="지난주"
        trailing={
          <span className="text-caption text-muted-foreground">
            {week.label}
          </span>
        }
      />
      <p className="text-heading tabular-nums">{formatWon(monthly.totalNet)}</p>
      {delta ? (
        <p className="text-caption text-muted-foreground mt-0.5">{delta}</p>
      ) : null}
      {top ? (
        <p className="text-body mt-3 flex min-w-0 items-baseline gap-2">
          <span className="text-caption text-muted-foreground shrink-0">
            가장 많이 쓴 곳
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">
            {top.categoryName}
          </span>
          <span className="shrink-0 tabular-nums">{formatWon(top.net)}</span>
        </p>
      ) : null}
    </section>
  );
}
