"use client";
/**
 * 달 이동 — 왼쪽 굵은 `2026년 11월 ▾`(눌러서 고르기) + 오른쪽 `‹ ›`(한 달씩).
 *
 * 가계부 세 탭이 같은 '달'을 다른 부품으로 다뤘다 — 거래 탭은 이 모양(`transactions/transaction-filters.tsx`),
 * 분석·예산은 고르기 없는 작은 `‹ 2026년 11월 ›`(`MonthSwitcher`). 거래 탭 디자인을 기준으로 하나로 모은다
 * (2026-11-05 HIG 검수 3·4단계, docs/ux-renewal-2026-11.md §8 '가계부 목록 필터').
 *
 * - 고르기는 창이 아니라 누른 자리 아래 메뉴다(`components/ui/picker-menu.tsx`, `sheet-layout.ts` 표).
 * - 화살표는 고를 수 있는 달 안에서만 움직인다. 빈 달로 가면 0원 화면만 지나게 된다(`MonthSwitcher`와 같은 이유).
 * - 전체 기간이면 '한 달씩'이 뜻이 없으므로 화살표를 두지 않는다.
 */
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PickerMenu, type PickerOption } from "@/components/ui/picker-menu";
import { currentMonth, formatMonth } from "@/lib/format";
import { isMonthKey } from "@/lib/month";
import { cn } from "@/lib/utils";

/** 메뉴의 '전체 기간' 값 — 빈 문자열은 PickerMenu에서 '고른 값 없음'과 구분하기 어렵다. */
const ALL = "__all__";

const ALL_LABEL = "전체 기간";

export type MonthNavProps = {
  /** 보고 있는 달(`YYYY-MM`). 빈 문자열은 전체 기간이다(`allowAll`일 때만 쓴다). */
  month: string;
  /**
   * 고를 수 있는 달(`YYYY-MM`, 순서·중복 무관 — 안에서 정렬한다). 메뉴 목록이자 화살표가 움직이는 범위다.
   * 불러오는 중(`undefined`)이면 두 화살표가 잠긴다.
   */
  months?: readonly string[];
  /** 고른 달(`YYYY-MM`). 전체 기간을 고르면 빈 문자열. 같은 달을 다시 고르면 부르지 않는다. */
  onChange: (month: string) => void;
  /** 메뉴 맨 위에 '전체 기간'을 둔다. */
  allowAll?: boolean;
  className?: string;
};

export type MonthNavState = {
  /** 달 이름 버튼에 보이는 글자(`2026년 11월` 또는 `전체 기간`). */
  label: string;
  /** 메뉴 목록 — 최근 달이 위. `allowAll`이면 맨 위에 전체 기간. */
  options: PickerOption[];
  prev: string | null;
  next: string | null;
  /** 전체 기간이면 화살표를 숨긴다. */
  showArrows: boolean;
};

/**
 * 메뉴 목록과 화살표 경계를 계산한다(화면 없이 시험할 수 있게 따로 둔다).
 *
 * 이번 달과 보고 있는 달은 `months`에 없어도 넣는다. 이번 달은 거래가 아직 0건이면 목록에 없는데,
 * 빼면 다른 달로 갔다가 이번 달로 돌아올 길이 없다. 보고 있는 달은 오래된 딥링크로 들어왔을 때
 * 메뉴에 체크할 값이 없고 화살표 경계도 못 잡는다(`MonthSwitcher`·거래 탭과 같은 규칙).
 */
export function monthNavState({
  month,
  months,
  allowAll = false,
  today = currentMonth(),
}: Pick<MonthNavProps, "month" | "months" | "allowAll"> & {
  today?: string;
}): MonthNavState {
  const available = [
    ...new Set([...(months ?? []), today, ...(month ? [month] : [])]),
  ]
    .filter(isMonthKey)
    .sort();
  const options: PickerOption[] = [...available]
    .reverse()
    .map((value) => ({ value, label: formatMonth(value) }));
  if (allowAll) options.unshift({ value: ALL, label: ALL_LABEL });

  // 불러오는 중에는 범위를 모르니 어느 쪽으로도 보내지 않는다.
  const index = months && month ? available.indexOf(month) : -1;
  return {
    label: month ? formatMonth(month) : ALL_LABEL,
    options,
    prev: index > 0 ? available[index - 1]! : null,
    next:
      index >= 0 && index < available.length - 1 ? available[index + 1]! : null,
    showArrows: month !== "",
  };
}

export function MonthNav({
  month,
  months,
  onChange,
  allowAll = false,
  className,
}: MonthNavProps) {
  const { label, options, prev, next, showArrows } = monthNavState({
    month,
    months,
    allowAll,
  });

  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-2",
        className
      )}
    >
      <PickerMenu
        label="기간"
        options={options}
        value={month || ALL}
        onSelect={(value) => onChange(value === ALL ? "" : value)}
        trigger={
          <button
            type="button"
            aria-label={`기간: ${label}`}
            className="text-heading rounded-control flex min-h-11 min-w-0 items-center gap-1 font-bold tabular-nums transition-opacity active:opacity-60"
          >
            {/* 화살표로 달을 넘기면 포커스는 화살표에 남는다 — 바뀐 달을 화면 읽기 프로그램이 읽어 주게 한다. */}
            <span aria-live="polite" className="truncate">
              {label}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="text-muted-foreground size-5 shrink-0"
            />
          </button>
        }
      />
      {showArrows ? (
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={prev == null}
            aria-label="이전 달"
            onClick={() => prev && onChange(prev)}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={next == null}
            aria-label="다음 달"
            onClick={() => next && onChange(next)}
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
