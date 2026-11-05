"use client";
/**
 * 조건 칩(가계부 필터에서 공용으로 올렸다, 2026-11-05 HIG 3·4단계).
 *
 * 손가락 영역은 44px(min-h-11), 보이는 알약은 36px(h-9)다 — 칩 줄이 촘촘해 보이면서도 누르기 쉽다.
 * - `FilterChip`: 켜고 끄는 칩, 또는 `menu`면 ▾와 함께 드롭다운(PickerMenu)의 버튼이 된다.
 *   Radix가 ref·aria·열림 상태(data-state)를 넘기므로 받은 속성을 그대로 button에 펼친다.
 * - `FilterClearChip`: 다른 화면에서 링크로만 켜지는 조건. ×로 끈다.
 */
import { ChevronDown, X } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function FilterChip({
  active,
  menu,
  children,
  className,
  ...props
}: ComponentProps<"button"> & { active: boolean; menu?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "group flex min-h-11 shrink-0 items-center focus-visible:outline-none",
        className
      )}
    >
      <span
        className={cn(
          "text-caption flex h-9 max-w-48 items-center gap-1 rounded-full border px-3 font-medium whitespace-nowrap transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
          active
            ? "border-primary/30 bg-primary/10 text-primary group-active:bg-primary/20"
            : "border-border bg-background text-foreground group-hover:bg-muted/60 group-active:bg-muted group-data-[state=open]:bg-muted/60"
        )}
      >
        <span className="min-w-0 truncate">{children}</span>
        {menu ? (
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 opacity-70"
          />
        ) : null}
      </span>
    </button>
  );
}

export function FilterClearChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`${label} 조건 해제`}
      className="group flex min-h-11 shrink-0 items-center focus-visible:outline-none"
    >
      <span className="text-caption border-primary/30 bg-primary/10 text-primary group-active:bg-primary/20 flex h-9 items-center gap-1 rounded-full border px-3 font-medium whitespace-nowrap group-focus-visible:ring-2 group-focus-visible:ring-ring">
        {label}
        <X aria-hidden="true" className="size-3.5 shrink-0" />
      </span>
    </button>
  );
}
