/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족 화면의 '값 고르기' 줄(이름 · 회색 값 · ⌃⌄)
 *
 * 공용 FieldRow(`components/widgets/field-row.tsx`)의 값 고르기 줄과 같은 모양이다. FieldRow는 글자 항목
 * 메뉴(PickerMenu)만 열 수 있어서, 역할(설명 붙은 항목)·색(견본) 메뉴를 여는 줄은 여기서 같은 모양으로 그린다.
 * 메뉴의 트리거로 넘기는 `<button>` 요소를 돌려준다(Radix가 aria-haspopup·열림 상태를 붙인다).
 * ------------------------------------------------------------------------- */
import { ChevronsUpDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function menuRowTrigger({
  label,
  value,
  disabled,
}: {
  label: string;
  value: ReactNode;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      className="active:bg-muted/60 data-[state=open]:bg-muted/60 flex min-h-12 w-full min-w-0 items-center gap-3 py-2 text-left transition-colors disabled:opacity-50"
    >
      <span className="text-body text-foreground max-w-[60%] min-w-20 shrink-0 break-words">
        {label}
      </span>
      <span className="text-body text-muted-foreground min-w-0 flex-1 text-right break-words">
        {value}
      </span>
      <ChevronsUpDown
        aria-hidden="true"
        className="text-muted-foreground/70 size-4 shrink-0"
      />
    </button>
  );
}

/** 값 옆의 색 점 + 이름 — 색에만 기대지 않도록 이름을 같이 쓴다. */
export function ColorValue({
  swatchClassName,
  name,
}: {
  swatchClassName: string;
  name: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 rounded-full", swatchClassName)}
      />
      {name}
    </span>
  );
}
