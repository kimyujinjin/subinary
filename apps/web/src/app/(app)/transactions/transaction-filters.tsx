"use client";
/**
 * 가계부 목록 위 기간·검색·조건(2026-11-05, PO 관점으로 다시 짰다).
 *
 * 이 화면에서 사용자가 하는 일은 셋이다 — 달을 넘겨 보기, 가맹점 찾기, 조건으로 좁히기.
 * - 달: `2026년 11월 ▾`(눌러서 고르기, 전체 기간 포함) + `‹ ›`로 한 달씩. 가장 자주 하므로 한 번에 닿게 둔다.
 * - 검색: 늘 보이는 검색칸(`children`).
 * - 조건: 가로로 넘기는 칩 한 줄. 칩을 누르면 그 자리 아래로 드롭다운이 펼쳐지고, 고른 값이 칩에 바로 보인다.
 *   칩 순서는 쓰는 빈도 — 확인할 거래(할 일) · 카테고리 · 구성원(가족 앱) · 카드 · 취소·환불.
 *
 * 예전에는 '필터' 버튼 → 라벨 붙은 드롭다운 5개를 쌓은 패널 → '필터 닫기' 순서였고, 적용된 조건은
 * 패널 밖 칩 줄에 한 번 더 보여 같은 정보가 두 군데 있었다. 유형·상태는 '취소·환불' 하나로 합쳤다
 * (`filter-summary.ts`). '초기화'는 기간과 검색어를 남기고 조건만 지운다.
 * 값 고르기는 시트가 아니라 드롭다운이다(`components/ui/sheet-layout.ts` 표).
 */
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { PickerMenu } from "@/components/ui/picker-menu";
import { FilterChip, FilterClearChip } from "@/components/widgets/filter-chip";
import {
  CANCELLATION_FILTER_OPTIONS,
  TRANSACTION_FILTER_LABELS,
  cancellationFilterChange,
  cancellationFilterLabel,
  cancellationFilterValue,
  filterValueLabel,
  hasTransactionConditions,
  type ActiveTransactionFilter,
  type TransactionFilterChoices,
  type TransactionFilterKey,
  type TransactionFilterOption,
  type TransactionFilterValues,
} from "./filter-summary";

/** 드롭다운의 '전체' 값(빈 문자열은 선택 비교에 쓰기 애매하다). */
const ALL = "__all__";

/** 칩이 바꾸는 조건 — 순서가 곧 화면 순서다. */
const PICKER_CHIPS: ReadonlyArray<"categoryId" | "memberId" | "cardId"> = [
  "categoryId",
  "memberId",
  "cardId",
];

export function TransactionFilters({
  month,
  monthOptions,
  values,
  choices,
  onMonthChange,
  onChange,
  onClear,
  onClearAll,
  onToggleReview,
  children,
}: {
  month: string;
  monthOptions: ReadonlyArray<TransactionFilterOption>;
  values: TransactionFilterValues;
  choices: TransactionFilterChoices;
  onMonthChange: (value: string) => void;
  onChange: (key: TransactionFilterKey, value: string) => void;
  onClear: (key: ActiveTransactionFilter["key"]) => void;
  onClearAll: () => void;
  onToggleReview: () => void;
  children?: ReactNode;
}) {
  // 한 달씩 이동은 고를 수 있는 달 안에서만. 전체 기간이면 화살표를 두지 않는다.
  const months = [
    ...new Set(monthOptions.map((option) => option.value)),
  ].sort();
  const index = month ? months.indexOf(month) : -1;
  const prev = index > 0 ? months[index - 1] : null;
  const next =
    index >= 0 && index < months.length - 1 ? months[index + 1] : null;
  const monthLabel = month
    ? monthOptions.find((option) => option.value === month)?.label ?? month
    : "전체 기간";

  const cancellationLabel = cancellationFilterLabel(values, choices);

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="거래 필터">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <PickerMenu
          label="기간"
          options={[{ value: ALL, label: "전체 기간" }, ...monthOptions]}
          value={month || ALL}
          onSelect={(value) => onMonthChange(value === ALL ? "" : value)}
          trigger={
            <button
              type="button"
              aria-label={`기간: ${monthLabel}`}
              className="text-heading flex min-h-11 min-w-0 items-center gap-1 font-bold tabular-nums"
            >
              <span className="truncate">{monthLabel}</span>
              <ChevronDown
                aria-hidden="true"
                className="text-muted-foreground size-5 shrink-0"
              />
            </button>
          }
        />
        {month ? (
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              disabled={prev == null}
              aria-label="이전 달"
              onClick={() => prev && onMonthChange(prev)}
            >
              <ChevronLeft className="size-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              disabled={next == null}
              aria-label="다음 달"
              onClick={() => next && onMonthChange(next)}
            >
              <ChevronRight className="size-5" />
            </Button>
          </div>
        ) : null}
      </div>

      {children}

      {/*
        칩은 가로로 넘긴다. '초기화'는 넘기는 영역 밖 오른쪽에 고정한다 — 조건을 여러 개 골라도 늘 보이고,
        조건이 생길 때 칩이 옆으로 밀리지 않는다.
      */}
      <div className="flex min-w-0 items-center gap-1">
        <div
          role="group"
          aria-label="조건"
          className="-ml-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pl-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {values.excludedOnly ? (
            <FilterClearChip
              label="합계에서 뺀 거래"
              onClear={() => onClear("excludedOnly")}
            />
          ) : null}
          {values.sharedOnly ? (
            <FilterClearChip
              label="공용 카드 거래"
              onClear={() => onClear("sharedOnly")}
            />
          ) : null}
          <FilterChip
            active={values.reviewOnly}
            aria-pressed={values.reviewOnly}
            onClick={onToggleReview}
          >
            확인할 거래
          </FilterChip>
          {PICKER_CHIPS.map((key) => {
            const name = TRANSACTION_FILTER_LABELS[key];
            const valueLabel = filterValueLabel(key, values, choices);
            return (
              <PickerMenu
                key={key}
                label={name}
                options={[
                  { value: ALL, label: `전체 ${name}` },
                  ...choices[key],
                ]}
                value={values[key] || ALL}
                onSelect={(value) => onChange(key, value === ALL ? "" : value)}
                trigger={
                  <FilterChip
                    menu
                    active={valueLabel != null}
                    aria-label={
                      valueLabel ? `${name}: ${valueLabel}` : `${name} 고르기`
                    }
                  >
                    {valueLabel ?? name}
                  </FilterChip>
                }
              />
            );
          })}
          <PickerMenu
            label="취소·환불"
            options={[
              { value: ALL, label: "전체" },
              ...CANCELLATION_FILTER_OPTIONS,
            ]}
            value={cancellationFilterValue(values) || ALL}
            onSelect={(value) => {
              const change = cancellationFilterChange(
                value === ALL ? "" : value
              );
              onChange("type", change.type);
              onChange("status", change.status);
            }}
            trigger={
              <FilterChip
                menu
                active={cancellationLabel != null}
                aria-label={
                  cancellationLabel
                    ? `취소·환불: ${cancellationLabel}`
                    : "취소·환불 고르기"
                }
              >
                {cancellationLabel ?? "취소·환불"}
              </FilterChip>
            }
          />
        </div>
        {hasTransactionConditions(values) ? (
          <button
            type="button"
            onClick={onClearAll}
            className="text-caption text-muted-foreground hover:text-foreground min-h-11 shrink-0 px-2 font-medium whitespace-nowrap active:text-foreground"
          >
            초기화
          </button>
        ) : null}
      </div>
      {values.reviewOnly ? (
        <p className="text-caption text-muted-foreground">
          문자·환율 처리 대기는 제외해요.
        </p>
      ) : null}
    </section>
  );
}
