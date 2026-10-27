import type { BudgetSummary, BudgetUpdateRequest, CardSummary } from "@family/contracts";

/** 단일 카드 예산과 카드 묶음의 대상을 같은 형태로 읽는다. */
export function budgetCardIds(
  budget: Pick<BudgetSummary, "scopeType" | "scopeRefId" | "cardIds">,
): string[] {
  if (budget.scopeType === "card_group") return [...budget.cardIds];
  return budget.scopeType === "card" && budget.scopeRefId ? [budget.scopeRefId] : [];
}

/** 공용 생활비나 사용 중지 카드가 개인 카드 묶음에 섞이지 않게 확인한다. */
export function budgetCardGroupError(
  cardIds: readonly string[],
  cards: readonly CardSummary[],
): string | null {
  if (cardIds.length < 2) return "함께 계산할 카드를 2장 이상 선택해 주세요.";
  if (cardIds.length > 20) return "카드는 최대 20장까지 함께 계산할 수 있어요.";
  if (new Set(cardIds).size !== cardIds.length) return "같은 카드를 중복해서 선택할 수 없어요.";
  const selected = cardIds.map((id) => cards.find((card) => card.id === id));
  if (selected.some((card) => !card)) return "선택한 카드를 확인할 수 없어요. 카드 목록을 다시 불러와 주세요.";
  if (selected.some((card) => card?.isShared)) return "공용 카드는 카드 묶음 예산에서 제외해 주세요.";
  if (selected.some((card) => card?.status !== "active")) return "사용 중인 카드만 묶을 수 있어요.";
  if (new Set(selected.map((card) => card?.ownerMemberId)).size !== 1) return "같은 가족 구성원의 카드끼리 선택해 주세요.";
  return null;
}

/** 카드 범위가 달라질 때만 기존 대상과 새 대상을 보내고 한도는 건드리지 않는다. */
export function budgetCardGroupUpdate(
  budget: Pick<BudgetSummary, "scopeType" | "scopeRefId" | "cardIds">,
  nextCardIds: readonly string[],
): BudgetUpdateRequest {
  const previous = budgetCardIds(budget).sort();
  const next = [...nextCardIds].sort();
  if (budget.scopeType === "card_group" && JSON.stringify(previous) === JSON.stringify(next)) return {};
  return { scopeType: "card_group", cardIds: next, expectedCardIds: previous };
}

/** 저장된 범위를 유지하는 이름·한도 수정에는 카드의 현재 상태를 재검증하지 않는다. */
export function budgetCardGroupUpdateError(
  budget: Pick<BudgetSummary, "scopeType" | "scopeRefId" | "cardIds">,
  nextCardIds: readonly string[],
  cards: readonly CardSummary[],
): string | null {
  if (Object.keys(budgetCardGroupUpdate(budget, nextCardIds)).length === 0) return null;
  return budgetCardGroupError(nextCardIds, cards);
}
