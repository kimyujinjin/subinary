"use client";
/**
 * 거래 상세의 정보·설정 목록(2026-11-05 사용자 지적: '분류' 아래 칸이 입력 양식처럼 쌓여 보기 안 좋았다).
 *
 * 한 줄 = 이름(왼쪽) · 값(오른쪽) · 바꿀 수 있으면 ›. 바꾸는 줄을 누르면 선택 시트(`picker-sheet.tsx`)가
 * 열리고, 고르면 바로 저장된다. 예전에는 위 정보 목록(결제자·카드)과 아래 '분류' 칸(카테고리·공개 범위·카드
 * 드롭다운, 메모 상자)이 따로 있어 카드가 두 번 나왔다.
 */
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 정보·설정 줄을 묶는 목록. 줄 사이에 얇은 구분선을 둔다. */
export function FieldList({ children }: { children: ReactNode }) {
  return (
    <div className="border-border/60 divide-border/60 flex min-w-0 flex-col divide-y border-y">
      {children}
    </div>
  );
}

/**
 * 목록 한 줄. `onClick`이 있으면 눌러서 바꾸는 줄(›), 없으면 읽기 전용이다.
 * `children`은 줄 아래 덧붙이는 짧은 안내(할부 설명·카드 소유자 불일치 등)다.
 */
export function FieldRow({
  label,
  value,
  onClick,
  disabled,
  muted,
  children,
}: {
  label: string;
  value: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** 값이 비었을 때(미분류·카드 미연결·메모 없음) 흐리게 보인다. */
  muted?: boolean;
  children?: ReactNode;
}) {
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
      {onClick ? (
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground/50 -mr-1 size-5 shrink-0"
        />
      ) : null}
    </>
  );
  const rowClass = "flex min-h-12 w-full min-w-0 items-center gap-3 py-2";
  return (
    <div className="flex min-w-0 flex-col">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-haspopup="dialog"
          className={cn(
            rowClass,
            "active:bg-muted/60 text-left transition-colors disabled:opacity-50"
          )}
        >
          {body}
        </button>
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
