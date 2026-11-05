"use client";
/**
 * 값 고르기 드롭다운 — 거래 상세의 카테고리·카드·공개 범위와 목록 위 기간·조건 칩이 같이 쓴다
 * (`app/(app)/transactions/detail-fields.tsx`·`transaction-filters.tsx`). 다른 화면도 값 고르기에 쓰도록 `components/ui`에 둔다.
 * 누른 줄·칩 바로 아래로 펼쳐지고 지금 값에 체크가 있다. 고르면 닫히면서 바로 반영된다(같은 값이면 그대로).
 *
 * 값 고르기는 창(시트)이 아니라 드롭다운이다. 2026-11-05 하루 동안 바텀 시트로 띄웠다가
 * "모든 걸 다 바텀 시트로 만들라고 한 건 아니었다"는 지적으로 정리했다(`sheet-layout.ts` 표).
 */
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ReactElement } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type PickerOption = { value: string; label: string };

export type PickerMenuProps = {
  /** 누를 줄·칩. 버튼 하나여야 한다(Radix가 aria-haspopup·열림 상태를 붙인다). */
  trigger: ReactElement;
  label: string;
  options: readonly PickerOption[];
  value: string | null;
  /** 값이 바뀌었을 때만 부른다. */
  onSelect: (value: string) => void;
  /** 목록 아래 덧붙이는 동작 한 줄(예: 새 카테고리 만들기). */
  footer?: { label: string; onSelect: () => void };
  align?: "start" | "end";
  /**
   * 메뉴를 열지 않는다. 트리거 버튼의 disabled 속성만으로는 막히지 않는다 — Radix는 자기 Trigger의
   * disabled만 보고 pointerdown에서 메뉴를 연다(Android 웹뷰는 disabled 버튼에도 pointer 이벤트를 보낸다).
   */
  disabled?: boolean;
};

const ITEM =
  "text-body relative flex min-h-11 cursor-default items-center gap-3 rounded-control px-3 py-2 outline-hidden select-none focus:bg-muted data-[highlighted]:bg-muted dark:focus:bg-foreground/10 dark:data-[highlighted]:bg-foreground/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function PickerMenu({
  trigger,
  label,
  options,
  value,
  onSelect,
  footer,
  align = "start",
  disabled,
}: PickerMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        aria-label={label}
        className="rounded-control max-w-[calc(100vw-2rem)] min-w-44 p-1"
      >
        <DropdownMenuPrimitive.RadioGroup
          value={value ?? ""}
          onValueChange={(next) => {
            if (next !== value) onSelect(next);
          }}
        >
          {options.map((option) => (
            <DropdownMenuPrimitive.RadioItem
              key={option.value}
              value={option.value}
              className={cn(ITEM, "data-[state=checked]:font-semibold")}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <DropdownMenuPrimitive.ItemIndicator>
                <Check
                  aria-hidden="true"
                  className="text-primary size-4 shrink-0"
                />
              </DropdownMenuPrimitive.ItemIndicator>
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>
        {footer ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={footer.onSelect}
              className={cn(ITEM, "text-primary font-medium")}
            >
              {footer.label}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
