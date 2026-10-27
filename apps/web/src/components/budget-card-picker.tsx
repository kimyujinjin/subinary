import * as React from "react";
import type { CardSummary } from "@family/contracts";

import { cardIdentityLabel } from "@/lib/card-identity-label";

interface BudgetCardPickerProps {
  cards: readonly CardSummary[];
  selectedIds: readonly string[];
  memberNames: ReadonlyMap<string, string>;
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  loadError?: boolean;
}

/** 여러 카드의 소유자를 확인하며 하나의 예산에 포함할 카드를 고른다. */
export function BudgetCardPicker({ cards, selectedIds, memberNames, onChange, disabled = false, isLoading = false, loadError = false }: BudgetCardPickerProps) {
  const selectedOwner = cards.find((card) => selectedIds.includes(card.id))?.ownerMemberId;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">함께 계산할 카드</legend>
      <p className="text-muted-foreground text-[13px]">같은 사람의 카드 지출을 한도 하나로 합산해요. 공용 카드는 제외돼요.</p>
      <div className="max-h-56 overflow-y-auto rounded-xl border">
        {!isLoading && !loadError ? cards.map((card) => {
          const checked = selectedIds.includes(card.id);
          const otherOwner = selectedOwner !== undefined && card.ownerMemberId !== selectedOwner;
          const unavailable = card.isShared || card.status !== "active" || otherOwner;
          return (
            <label key={card.id} className={`flex min-h-12 items-start gap-3 border-b p-3 last:border-b-0 ${unavailable && !checked ? "text-muted-foreground bg-muted/40" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                className="accent-primary mt-0.5 size-4 shrink-0"
                checked={checked}
                disabled={disabled || (unavailable && !checked)}
                onChange={(event) => onChange(event.target.checked ? [...selectedIds, card.id] : selectedIds.filter((id) => id !== card.id))}
              />
              <span className="min-w-0 break-words text-[13px] leading-5">
                {cardIdentityLabel(card, memberNames)}
                {unavailable ? <span className="mt-1 block">{card.isShared ? "공용 카드 · 선택 제외" : card.status !== "active" ? "사용 중지 · 선택 제외" : "다른 소유자 · 선택 제외"}</span> : null}
              </span>
            </label>
          );
        }) : null}
        {isLoading ? <p role="status" className="text-muted-foreground p-3 text-sm">카드 목록을 불러오는 중이에요.</p> : loadError ? <p role="alert" className="text-destructive p-3 text-sm">카드 목록을 불러오지 못했어요. 화면을 다시 열어 주세요.</p> : cards.length === 0 ? <p className="text-muted-foreground p-3 text-sm">등록된 카드가 없어요. 카드 관리에서 먼저 등록해 주세요.</p> : null}
      </div>
      <p className="text-muted-foreground text-[13px]">{selectedIds.length}장 선택 · 2장 이상 선택해 주세요</p>
    </fieldset>
  );
}
