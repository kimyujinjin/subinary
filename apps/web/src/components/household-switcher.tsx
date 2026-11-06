"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족 스위처 (앱 셸 상단)
 *
 * - 여러 가족 전환(Zustand store에 선택 저장) + 현재 가족/역할 표시. 가족 고르기는 값 고르기
 *   메뉴(PickerMenu)와 같은 모양 — 지금 가족에 오른쪽 체크, 항목 44px, 역할 이름은 가족 화면과 같은 말.
 * - 메뉴에는 가족 고르기만 둔다. '새 가족 만들기'가 여기 있을 때는 구성원 추가로 읽혔고, 만들면 빈 가족으로
 *   곧바로 넘어가 모든 화면이 빈 채로 보였다 — 가족 화면 맨 아래 줄로 옮겼다
 *   (app/(app)/household/create-household.tsx, docs/ux-renewal-2026-11.md §8 결정 대기 정리 ③).
 * ------------------------------------------------------------------------- */
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHousehold } from "@/lib/household-context";
import { ROLE_LABEL } from "@/lib/household-roles";

/** 가족 항목 — PickerMenu 항목과 같은 줄(44px 이상·본문 글자·눌림 바탕). */
const HOUSEHOLD_ITEM =
  "relative flex min-h-11 cursor-default items-center gap-3 rounded-control px-3 py-2 text-body outline-hidden select-none focus:bg-muted data-[highlighted]:bg-muted dark:focus:bg-foreground/10 dark:data-[highlighted]:bg-foreground/10 data-[state=checked]:font-semibold";

export function HouseholdSwitcher() {
  const { householdId, setHouseholdId, activeMembership, memberships } =
    useHousehold();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="text-caption min-h-11 min-w-0 max-w-56 shrink justify-between gap-1.5 px-2 font-medium"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Users className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">
              {activeMembership?.name ?? "가족 선택"}
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64 max-w-[calc(100vw-2rem)] p-1"
      >
        <DropdownMenuLabel>내 가족</DropdownMenuLabel>
        <DropdownMenuPrimitive.RadioGroup
          value={householdId ?? ""}
          onValueChange={(next) => {
            if (next !== householdId) setHouseholdId(next);
          }}
        >
          {memberships.map((m) => (
            <DropdownMenuPrimitive.RadioItem
              key={m.householdId}
              value={m.householdId}
              className={HOUSEHOLD_ITEM}
            >
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="text-muted-foreground text-caption shrink-0 font-normal">
                {ROLE_LABEL[m.role]}
              </span>
              {/* 체크 자리는 늘 비워 둔다 — 지금 가족만 체크가 있어도 역할 칸이 세로로 맞는다. */}
              <span className="flex size-4 shrink-0 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check aria-hidden="true" className="text-primary size-4" />
                </DropdownMenuPrimitive.ItemIndicator>
              </span>
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
