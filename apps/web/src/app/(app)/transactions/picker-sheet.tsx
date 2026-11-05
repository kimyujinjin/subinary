"use client";
/**
 * 가계부 화면의 선택 시트 — 거래 상세의 카테고리·카드·공개 범위와 목록 위 필터 칩이 같이 쓴다.
 * 지금 값에 체크를 달고, 고르면 닫히면서 바로 반영된다. 이미 고른 값을 다시 누르면 아무것도 하지 않는다.
 */
import { Check } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { BottomSheet } from "@/components/widgets";
import { registerTransactionDetailBack } from "@/lib/transaction-detail-back";
import { cn } from "@/lib/utils";

export type FieldOption = { value: string; label: string };

/** 선택 시트 안의 선택지 목록. 지금 값에는 체크를 단다. */
export function PickerOptionList({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly FieldOption[];
  value: string | null;
  onPick: (value: string, changed: boolean) => void;
}) {
  return (
    <div role="listbox" aria-label={label} className="flex flex-col">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onPick(option.value, !selected)}
            className={cn(
              "text-body -mx-2 flex min-h-12 items-center gap-3 rounded-control px-2 text-left hover:bg-muted active:bg-muted",
              selected && "font-semibold"
            )}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {selected ? (
              <Check
                aria-hidden="true"
                className="text-primary size-5 shrink-0"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 선택 시트. 고르면 닫히고, 값이 바뀌었을 때만 `onSelect`를 부른다.
 * 열려 있는 동안 휴대폰 뒤로가기는 화면이 아니라 이 시트를 먼저 닫는다.
 */
export function PickerSheet({
  open,
  onClose,
  title,
  options,
  value,
  onSelect,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: readonly FieldOption[];
  value: string | null;
  onSelect: (value: string) => void;
  footer?: ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(
    () =>
      open
        ? registerTransactionDetailBack(window, () => close.current())
        : undefined,
    [open]
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
    >
      <PickerOptionList
        label={title}
        options={options}
        value={value}
        onPick={(picked, changed) => {
          onClose();
          if (changed) onSelect(picked);
        }}
      />
      {footer}
    </BottomSheet>
  );
}
