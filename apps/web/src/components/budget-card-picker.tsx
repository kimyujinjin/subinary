import * as React from "react";
import type { CardSummary } from "@family/contracts";

import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/widgets/error-state";
import { cardIdentityLabel } from "@/lib/card-identity-label";

interface BudgetCardPickerProps {
  cards: readonly CardSummary[];
  selectedIds: readonly string[];
  memberNames: ReadonlyMap<string, string>;
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  loadError?: boolean;
  /** 있으면 불러오기 실패 자리에 '다시 불러오기'를 둔다(보통 카드 목록 쿼리의 refetch). */
  onRetry?: () => void;
  retrying?: boolean;
}

/** 여러 카드의 소유자를 확인하며 하나의 예산에 포함할 카드를 고른다. */
export function BudgetCardPicker({ cards, selectedIds, memberNames, onChange, disabled = false, isLoading = false, loadError = false, onRetry, retrying = false }: BudgetCardPickerProps) {
  const selectedOwner = cards.find((card) => selectedIds.includes(card.id))?.ownerMemberId;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="text-body mb-2 font-medium">함께 계산할 카드</legend>
      <p className="text-caption text-muted-foreground">같은 사람의 카드 지출을 한도 하나로 합산해요. 공용 카드는 제외돼요.</p>
      <div className="max-h-56 overflow-y-auto rounded-control border">
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
              <span className="text-caption min-w-0 break-words">
                {cardIdentityLabel(card, memberNames)}
                {unavailable ? <span className="mt-1 block">{card.isShared ? "공용 카드 · 선택 제외" : card.status !== "active" ? "비활성 카드 · 선택 제외" : "다른 소유자 · 선택 제외"}</span> : null}
              </span>
            </label>
          );
        }) : null}
        {isLoading ? (
          // 들어올 줄 모양의 스켈레톤 — 글자 '불러오는 중'은 읽기 프로그램에만 준다.
          <div role="status" aria-busy="true">
            <span className="sr-only">카드 목록을 불러오는 중이에요.</span>
            {[0, 1].map((row) => (
              <div key={row} className="flex min-h-12 items-center gap-3 border-b p-3 last:border-b-0">
                <Skeleton className="size-4 shrink-0" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          onRetry ? (
            <ErrorState align="start" className="p-3" message="카드 목록을 불러오지 못했어요" retrying={retrying} onRetry={onRetry} />
          ) : (
            <p role="alert" className="text-body text-destructive p-3">카드 목록을 불러오지 못했어요. 화면을 다시 열어 주세요.</p>
          )
        ) : cards.length === 0 ? <p className="text-body text-muted-foreground p-3">등록된 카드가 없어요. 자산 탭의 결제 카드에서 먼저 등록해 주세요.</p> : null}
      </div>
      <p className="text-caption text-muted-foreground">{selectedIds.length}장 선택 · 2장 이상 선택해 주세요</p>
    </fieldset>
  );
}
