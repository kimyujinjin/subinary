"use client";
/**
 * 설정 앱 스타일의 정보·설정 목록 — 한 줄 = 이름(왼쪽, 기본 글자색) · 값(오른쪽, 회색) · 바꿀 수 있으면 표시.
 * - 값을 고르는 줄(`menu`): ⌃⌄. 누른 자리 아래로 메뉴가 펼쳐지고, 고르면 바로 반영된다(`components/ui/picker-menu.tsx`).
 * - 창을 여는 줄(`onClick`): ›. 메모처럼 따로 입력할 게 있는 줄.
 * - 둘 다 없으면 읽기 전용(표시 없음).
 *
 * 거래 상세에서 처음 만들었다(2026-11-05 사용자 지적: '분류' 아래 칸이 입력 양식처럼 쌓여 보기 안 좋았다).
 * 카드 수정 창 같은 다른 화면도 같은 줄을 쓰도록 같은 날 HIG 검수 3·4단계에서
 * `app/(app)/transactions/detail-fields.tsx`에서 여기로 옮겼다(그 파일은 이제 다시 내보내기만 한다).
 */
import { ChevronRight, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

import { PickerMenu, type PickerMenuProps } from "@/components/ui/picker-menu";
import { cn } from "@/lib/utils";

/** 정보·설정 줄을 묶는 목록. 줄 사이에 얇은 구분선을 둔다. */
export function FieldList({ children }: { children: ReactNode }) {
  return (
    <div className="border-border/60 divide-border/60 flex min-w-0 flex-col divide-y border-y">
      {children}
    </div>
  );
}

export type FieldRowProps = {
  label: string;
  value: ReactNode;
  /** 값을 고르는 줄. 메뉴는 줄 오른쪽 끝에 맞춰 펼쳐진다. */
  menu?: Omit<PickerMenuProps, "trigger" | "align">;
  /** 창을 여는 줄. `menu`가 있으면 쓰이지 않는다. */
  onClick?: () => void;
  disabled?: boolean;
  /**
   * 값이 비었음(미분류·카드 미연결·메모 없음). 색은 다른 값과 같은 회색으로 둔다 —
   * 예전에 더 흐리게(/60) 했더니 흰 바탕 대비가 약 2.5:1로 읽기 어려웠다(AA 4.5:1 미달).
   */
  muted?: boolean;
  /** 줄 아래 덧붙이는 짧은 안내(할부 설명·카드 소유자 불일치 등). */
  children?: ReactNode;
};

/**
 * 목록 한 줄. `menu`가 있으면 값을 고르는 줄, `onClick`이 있으면 창을 여는 줄,
 * 둘 다 없으면 읽기 전용이다.
 */
export function FieldRow({
  label,
  value,
  menu,
  onClick,
  disabled,
  muted,
  children,
}: FieldRowProps) {
  const body = (
    <>
      {/* 이름은 짧으면 80px 칸에 맞추고, 긴 이름(다른 화면)은 값 자리를 다 먹지 않도록 60%에서 줄을 바꾼다. */}
      <span className="text-body text-foreground max-w-[60%] min-w-20 shrink-0 break-words">
        {label}
      </span>
      <span
        data-empty={muted ? "" : undefined}
        className="text-body text-muted-foreground min-w-0 flex-1 text-right break-words"
      >
        {value}
      </span>
      {/*
        값 고르기(그 자리 메뉴)는 ⌃⌄, 다른 화면을 여는 줄은 › — HIG 팝업 버튼·내비게이션 표시.
        눌리는 줄임을 알아보게 하는 표시라 바탕 대비 3:1 이상(/70)으로 둔다 — 목록 줄(`ListRow`)의 ›와 같다.
      */}
      {menu ? (
        <ChevronsUpDown
          aria-hidden="true"
          className="text-muted-foreground/70 size-4 shrink-0"
        />
      ) : onClick ? (
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground/70 -mr-1 size-5 shrink-0"
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
        <PickerMenu {...menu} align="end" disabled={disabled} trigger={button} />
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
