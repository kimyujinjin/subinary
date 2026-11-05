"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 역할 고르기 메뉴
 *
 * 구성원 줄의 역할과 초대 폼의 역할이 같이 쓴다. 모양은 공용 PickerMenu(누른 자리 아래 드롭다운,
 * 지금 값에 체크)와 같고 항목마다 한 줄 설명을 단다 — '관리자'·'보기 전용'은 이름만으로 무엇을 할 수
 * 있는지 알 수 없다(2026-11 HIG 검수). PickerMenu 항목은 글자 한 줄뿐이라 여기서 그린다.
 * PickerMenu가 항목 설명을 받게 되면 그쪽으로 옮긴다.
 * ------------------------------------------------------------------------- */
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ReactElement } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  INVITABLE_ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  isInvitableRole,
  type InvitableRole,
} from "@/lib/household-roles";

/** PickerMenu 항목과 같은 줄(44px 이상·본문 글자·눌림 바탕). */
const ITEM =
  "group relative flex min-h-11 cursor-default items-center gap-3 rounded-control px-3 py-2 outline-hidden select-none focus:bg-muted data-[highlighted]:bg-muted dark:focus:bg-foreground/10 dark:data-[highlighted]:bg-foreground/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function RoleMenu({
  trigger,
  label,
  value,
  onSelect,
  align = "end",
  disabled = false,
}: {
  /** 누를 줄·값. 버튼 하나여야 한다. */
  trigger: ReactElement;
  label: string;
  value: InvitableRole;
  /** 값이 바뀌었을 때만 부른다. */
  onSelect: (role: InvitableRole) => void;
  align?: "start" | "end";
  /**
   * 저장 중 등 잠글 때. 트리거 줄의 `<button disabled>`만으로는 Radix 트리거가 잠기지 않는다 —
   * Chromium(Android 웹뷰)은 꺼진 버튼에도 pointerdown을 보내고 Radix는 그때 자기 `disabled` prop만 본다.
   * 그래서 메뉴에도 같은 값을 넘긴다(트리거 버튼의 disabled와 같은 값).
   */
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        aria-label={label}
        className="rounded-control w-72 max-w-[calc(100vw-2rem)] p-1"
      >
        <RoleChoices value={value} onSelect={onSelect} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 메뉴 안의 역할 항목(이름 + 한 줄 설명). 메뉴 내용(포털) 밖에서 그려 볼 수 있게 따로 둔다(테스트). */
export function RoleChoices({
  value,
  onSelect,
}: {
  value: InvitableRole;
  onSelect: (role: InvitableRole) => void;
}) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      value={value}
      onValueChange={(next) => {
        if (next !== value && isInvitableRole(next)) onSelect(next);
      }}
    >
      {INVITABLE_ROLES.map((role) => (
        <DropdownMenuPrimitive.RadioItem key={role} value={role} className={ITEM}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body group-data-[state=checked]:font-semibold">
              {ROLE_LABEL[role]}
            </span>
            <span className="text-caption text-muted-foreground">
              {ROLE_DESCRIPTION[role]}
            </span>
          </span>
          <DropdownMenuPrimitive.ItemIndicator>
            <Check aria-hidden="true" className="text-primary size-4 shrink-0" />
          </DropdownMenuPrimitive.ItemIndicator>
        </DropdownMenuPrimitive.RadioItem>
      ))}
    </DropdownMenuPrimitive.RadioGroup>
  );
}
