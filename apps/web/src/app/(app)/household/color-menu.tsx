"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 색 고르기 메뉴(구성원 색·공용 카드 색)
 *
 * 누른 자리 아래로 견본 8개와 '고르지 않음' 한 줄(구성원은 자동 색상, 공용은 회색)이 펼쳐지고,
 * 고르면 바로 반영된다. 값 고르기라 창이 아니라 드롭다운이다(`components/ui/sheet-layout.ts` 표).
 * 공용 PickerMenu는 글자 항목만 그려 견본을 그릴 수 없어서 같은 Radix 라디오 메뉴로 여기서 그린다.
 *
 * 견본은 menuitemradio + aria-checked다. 예전 견본은 지금 색을 테두리로만 보여 줘서 스크린 리더가
 * 지금 색을 알 수 없었다(2026-11 HIG 검수). 누르는 칸은 44px, 보이는 점은 24px.
 * ------------------------------------------------------------------------- */
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ReactElement } from "react";

import type { MemberColor } from "@family/contracts";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MEMBER_COLOR_KEYS,
  MEMBER_COLOR_LABELS,
  MEMBER_COLOR_SWATCH_CLASSES,
} from "@/lib/member-color";
import { cn } from "@/lib/utils";

/** 라디오 값에서 '고르지 않음(null)'을 나타내는 자리. 팔레트 키와 겹치지 않는다. */
const NONE = "none";

const HIGHLIGHT =
  "outline-hidden select-none focus:bg-muted data-[highlighted]:bg-muted dark:focus:bg-foreground/10 dark:data-[highlighted]:bg-foreground/10";

type ColorChoiceProps = {
  value: MemberColor | null;
  /** 값이 바뀌었을 때만 부른다. null = 고르지 않음. */
  onSelect: (color: MemberColor | null) => void;
  /** 고르지 않음 줄의 이름 — 구성원은 '자동 색상', 공용은 '회색'. */
  noneLabel: string;
};

export function ColorMenu({
  trigger,
  label,
  value,
  onSelect,
  noneLabel,
  align = "end",
  disabled = false,
}: ColorChoiceProps & {
  /** 누를 줄·아바타. 버튼 하나여야 한다. */
  trigger: ReactElement;
  /** 메뉴 이름(스크린 리더). */
  label: string;
  align?: "start" | "end";
  /** 저장 중 등 잠글 때. 트리거 버튼의 disabled와 같은 값을 넘긴다(이유는 RoleMenu의 같은 prop). */
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
        className="w-auto min-w-0 p-2"
      >
        <ColorChoices value={value} onSelect={onSelect} noneLabel={noneLabel} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 메뉴 안의 견본 8개 + '고르지 않음' 줄. 메뉴 내용(포털) 밖에서 그려 볼 수 있게 따로 둔다(테스트). */
export function ColorChoices({ value, onSelect, noneLabel }: ColorChoiceProps) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      value={value ?? NONE}
      onValueChange={(next) => {
        const color = next === NONE ? null : (next as MemberColor);
        if (color !== value) onSelect(color);
      }}
    >
      <div className="grid grid-cols-4 gap-1">
        {MEMBER_COLOR_KEYS.map((key) => (
          <DropdownMenuPrimitive.RadioItem
            key={key}
            value={key}
            aria-label={MEMBER_COLOR_LABELS[key]}
            className={cn(
              "group flex size-11 cursor-default items-center justify-center rounded-full",
              HIGHLIGHT
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-6 rounded-full",
                MEMBER_COLOR_SWATCH_CLASSES[key],
                // 지금 색은 바깥 고리로도 보인다(색만으로 구분하지 않게).
                "group-data-[state=checked]:ring-ring group-data-[state=checked]:ring-offset-popover group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-offset-2"
              )}
            />
          </DropdownMenuPrimitive.RadioItem>
        ))}
      </div>
      <DropdownMenuPrimitive.RadioItem
        value={NONE}
        className={cn(
          "text-body mt-1 flex min-h-11 cursor-default items-center gap-3 rounded-control px-3 py-2 data-[state=checked]:font-semibold",
          HIGHLIGHT
        )}
      >
        <span className="min-w-0 flex-1">{noneLabel}</span>
        <DropdownMenuPrimitive.ItemIndicator>
          <Check
            aria-hidden="true"
            className="text-primary size-4 shrink-0"
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </DropdownMenuPrimitive.RadioItem>
    </DropdownMenuPrimitive.RadioGroup>
  );
}
