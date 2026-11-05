"use client";
/**
 * 거래 상세의 정보·설정 목록(2026-11-05 사용자 지적: '분류' 아래 칸이 입력 양식처럼 쌓여 보기 안 좋았다).
 *
 * 한 줄 = 이름(왼쪽) · 값(오른쪽) · 바꿀 수 있으면 ›.
 * - 값을 고르는 줄(`menu`): 누른 자리 아래로 드롭다운이 펼쳐지고, 고르면 바로 저장된다(`picker-menu.tsx`).
 * - 창을 여는 줄(`onClick`): 메모처럼 따로 입력할 게 있는 줄.
 * 예전에는 위 정보 목록(결제자·카드)과 아래 '분류' 칸(카테고리·공개 범위·카드 드롭다운, 메모 상자)이 따로 있어
 * 카드가 두 번 나왔다.
 */
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PickerMenu, type PickerMenuProps } from "./picker-menu";

/** 정보·설정 줄을 묶는 목록. 줄 사이에 얇은 구분선을 둔다. */
export function FieldList({ children }: { children: ReactNode }) {
  return (
    <div className="border-border/60 divide-border/60 flex min-w-0 flex-col divide-y border-y">
      {children}
    </div>
  );
}

/**
 * 목록 한 줄. `menu`가 있으면 값을 고르는 줄, `onClick`이 있으면 창을 여는 줄(둘 다 ›),
 * 둘 다 없으면 읽기 전용이다. `children`은 줄 아래 덧붙이는 짧은 안내(할부 설명·카드 소유자 불일치 등)다.
 */
export function FieldRow({
  label,
  value,
  menu,
  onClick,
  disabled,
  muted,
  children,
}: {
  label: string;
  value: ReactNode;
  menu?: Omit<PickerMenuProps, "trigger" | "align">;
  onClick?: () => void;
  disabled?: boolean;
  /** 값이 비었을 때(미분류·카드 미연결·메모 없음) 흐리게 보인다. */
  muted?: boolean;
  children?: ReactNode;
}) {
  const interactive = menu != null || onClick != null;
  const body = (
    <>
      <span className="text-body text-muted-foreground w-20 shrink-0">
        {label}
      </span>
      <span
        className={cn(
          "text-body min-w-0 flex-1 text-right break-words",
          muted && "text-muted-foreground"
        )}
      >
        {value}
      </span>
      {interactive ? (
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground/50 -mr-1 size-5 shrink-0"
        />
      ) : null}
    </>
  );
  const rowClass = "flex min-h-12 w-full min-w-0 items-center gap-3 py-2";
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // 드롭다운 줄은 Radix가 aria-haspopup="menu"를 붙인다. 여기서 undefined를 넘기면 그 값을 지워 버린다.
      {...(menu ? {} : { "aria-haspopup": "dialog" as const })}
      className={cn(
        rowClass,
        "active:bg-muted/60 data-[state=open]:bg-muted/60 text-left transition-colors disabled:opacity-50"
      )}
    >
      {body}
    </button>
  );
  return (
    <div className="flex min-w-0 flex-col">
      {menu ? (
        <PickerMenu {...menu} align="end" trigger={button} />
      ) : onClick ? (
        button
      ) : (
        <div className={rowClass}>{body}</div>
      )}
      {children ? (
        <div className="text-caption text-muted-foreground -mt-1 pb-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
