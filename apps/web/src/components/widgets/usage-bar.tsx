import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { formatMoney, percent } from "@/lib/format";
import { cn } from "@/lib/utils";

interface UsageBarProps {
  label: ReactNode;
  /** 현재월 순지출(minor units, 예산 통화 기준). */
  spent: number;
  /** 예산 한도(minor units, 예산 통화 기준). */
  amount: number;
  /** 예산 통화(ISO4217). 기본 'KRW'. spent/amount 표시에 사용. */
  currency?: string;
  /** 사용률 = spent/amount(서버 계산). 1 초과 가능(초과 지출). */
  usageRate: number;
  /** 우측 상단 보조 텍스트(스코프 종류 등). */
  meta?: ReactNode;
  /**
   * 있으면 막대 전체가 이 경로로 가는 링크가 된다(보통 필터가 걸린 거래 목록).
   * 숫자를 보여준 다음 "어디서 썼는지"로 이어지는 유일한 경로다 — 없으면 사용자는
   * 거래 탭에서 필터를 처음부터 다시 골라야 한다.
   */
  href?: string;
  /** 링크일 때 스크린리더에 읽힐 설명(기본: '거래 보기'). */
  hrefLabel?: string;
}

export type UsageTone = "over" | "warn" | "ok";

/**
 * 막대 아래 오른쪽 상태 글자. 넘으면 넘은 금액('12,000원 초과'), 아니면 쓴 비율('82.0% 사용').
 *
 * 80%와 초과를 막대 색으로만 구분하면 색을 구분하기 어려운 사람에게는 같은 막대로 보인다
 * (2026-11-05 HIG 검수 — 색에만 기대지 않기). 색은 그대로 두고 같은 말을 글자로도 한다.
 */
export function usageStatus({
  spent,
  amount,
  currency = "KRW",
  usageRate,
}: {
  spent: number;
  amount: number;
  currency?: string;
  usageRate: number;
}): { text: string; tone: UsageTone } {
  const pct = percent(usageRate);
  const used = pct === "—" ? pct : `${pct} 사용`;
  if (usageRate >= 1) {
    const over = spent - amount;
    return {
      text: over > 0 ? `${formatMoney(over, currency)} 초과` : used,
      tone: "over",
    };
  }
  return { text: used, tone: usageRate >= 0.8 ? "warn" : "ok" };
}

const STATUS_TEXT: Record<UsageTone, string> = {
  over: "text-destructive",
  warn: "text-warning-strong",
  ok: "text-muted-foreground",
};

/** 예산 사용률 막대. 80%↑ 경고, 100%↑ 초과 — 색과 함께 글자(`usageStatus`)로도 말한다. */
export function UsageBar({
  label,
  spent,
  amount,
  currency = "KRW",
  usageRate,
  meta,
  href,
  hrefLabel = "거래 보기",
}: UsageBarProps) {
  const width = Math.min(100, Math.max(0, usageRate * 100));
  const fill =
    usageRate >= 1
      ? "bg-destructive"
      : usageRate >= 0.8
        ? "bg-warning"
        : "bg-primary";
  const status = usageStatus({ spent, amount, currency, usageRate });

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body flex min-w-0 items-center gap-1 font-medium">
          <span className="truncate">{label}</span>
          {href ? (
            <ChevronRight
              className="text-muted-foreground/70 size-4 shrink-0 self-center"
              aria-hidden="true"
            />
          ) : null}
        </span>
        {meta ? (
          <span className="text-caption text-muted-foreground shrink-0">{meta}</span>
        ) : null}
      </div>
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", fill)}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="text-caption flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground min-w-0 tabular-nums">
          {formatMoney(spent, currency)} / {formatMoney(amount, currency)}
        </span>
        <span className={cn("shrink-0 tabular-nums font-medium", STATUS_TEXT[status.tone])}>
          {status.text}
        </span>
      </div>
    </>
  );

  if (!href) {
    return <div className="flex flex-col gap-1.5">{body}</div>;
  }

  // 음수 마진 + 패딩: 카드 안에서 정렬을 유지한 채 hover 영역만 넓힌다.
  // 세 줄 구성이라 세로 크기는 이미 44px을 넘는다.
  // 링크 이름은 aria-label로 덮지 않는다 — 덮으면 예산이 여럿일 때 모든 링크가 같은 이름('거래 보기')으로
  // 읽혀 어느 예산인지 알 수 없다. 이름·금액을 그대로 읽히고 행동은 뒤에 붙인다.
  return (
    <Link
      href={href}
      className="hover:bg-muted/70 active:bg-muted -mx-2 flex flex-col gap-1.5 rounded-control px-2 py-2 transition-colors"
    >
      {body}
      <span className="sr-only">{hrefLabel}</span>
    </Link>
  );
}
