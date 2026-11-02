"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { activeTransactionFilters, TRANSACTION_FILTER_LABELS, type ActiveTransactionFilter, type TransactionFilterChoices, type TransactionFilterKey, type TransactionFilterOption, type TransactionFilterValues } from "./filter-summary";

const ALL = "all";

export function TransactionFilters({ month, monthOptions, values, choices, onMonthChange, onChange, onClear, onClearAll, onToggleReview, children }: {
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
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const active = activeTransactionFilters(values, choices);
  return (
    <section className="min-w-0 space-y-4" aria-label="거래 필터">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Select value={month || ALL} onValueChange={(value) => onMonthChange(value === ALL ? "" : value)}>
          <SelectTrigger aria-label="기간 필터" className="min-h-11 w-fit min-w-0 max-w-full gap-2 rounded-xl border-0 bg-transparent pl-0 pr-2 text-[23px] font-bold tracking-tight shadow-none [&>[data-slot=select-value]]:min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} className="min-h-11">전체 기간</SelectItem>
            {monthOptions.map((option) => <SelectItem key={option.value} value={option.value} className="min-h-11">{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button ref={trigger} type="button" variant={open || active.length ? "tint" : "ghost"} className="min-h-11 rounded-xl px-3 text-muted-foreground" aria-label={active.length ? `필터, ${active.length}개 적용` : "필터"} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          필터{active.length > 0 ? <span className="tabular-nums">{active.length}</span> : null}
        </Button>
      </div>

      {children}

      {active.length > 0 ? (
        <ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label="적용 중인 조건">
          {values.reviewOnly ? <li><Button type="button" variant="tint" aria-pressed={true} className="min-h-11 rounded-full px-3 text-xs" onClick={onToggleReview}>확인할 거래<X className="size-3.5" aria-hidden="true" /></Button></li> : null}
          {active.filter((item) => item.key !== "reviewOnly").map((item) => (
            <li key={item.key} className="min-w-0 max-w-full">
              <button type="button" className="border-border hover:bg-muted/60 flex min-h-11 max-w-full items-center gap-2 rounded-full border bg-card px-3 py-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`${item.label} 조건 해제`} onClick={() => onClear(item.key)}>
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.label}</span>
                <X className="size-3.5 shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
          <li><Button type="button" variant="ghost" className="text-muted-foreground min-h-11 px-2 text-xs" onClick={onClearAll}>조건 지우기</Button></li>
        </ul>
      ) : null}
      {values.reviewOnly ? <p className="text-muted-foreground text-xs">문자·환율 처리 대기는 제외해요.</p> : null}

      {open ? (
        <div id={panelId} className="finance-panel grid min-w-0 grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5" role="group" aria-label="상세 필터">
          {!values.reviewOnly ? <Button type="button" variant="outline" aria-pressed={false} className="min-h-11 justify-self-start rounded-xl sm:col-span-2" onClick={onToggleReview}>확인할 거래</Button> : null}
          {(Object.keys(TRANSACTION_FILTER_LABELS) as TransactionFilterKey[]).map((key) => {
            const label = TRANSACTION_FILTER_LABELS[key];
            return <div key={key} className="min-w-0 space-y-2">
              <p className="text-muted-foreground text-xs">{label}</p>
              <Select value={values[key] || ALL} onValueChange={(value) => onChange(key, value === ALL ? "" : value)}>
                <SelectTrigger aria-label={`${label} 필터`} className="bg-card min-h-11 w-full min-w-0 rounded-xl [&>[data-slot=select-value]]:min-w-0">
                  <SelectValue>{values[key] ? choices[key].find((option) => option.value === values[key])?.label ?? `${label} 선택됨` : `전체 ${label}`}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  <SelectItem value={ALL} className="min-h-11">전체 {label}</SelectItem>
                  {choices[key].map((option) => <SelectItem key={option.value} value={option.value} className="min-h-11 break-words">{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>;
          })}
          <Button type="button" variant="outline" className="min-h-11 sm:col-span-2" onClick={() => { setOpen(false); trigger.current?.focus(); }}>필터 닫기</Button>
        </div>
      ) : null}
    </section>
  );
}
