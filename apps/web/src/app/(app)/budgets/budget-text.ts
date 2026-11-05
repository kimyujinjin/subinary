/* ---------------------------------------------------------------------------
 * 예산 화면 문구 — 화면 없이 시험할 수 있게 page.tsx 밖에 둔다
 * (Next.js page 파일은 default 외의 함수를 export할 수 없다).
 * ------------------------------------------------------------------------- */
import type { BudgetScopeType, BudgetSummary } from "@family/contracts";

import { formatMoney } from "@/lib/format";

/**
 * 목록·메뉴·확인 창에서 부르는 예산 이름. 카드 묶음의 범위 이름은 카드 목록 전체라 길어서
 * 이름이 없으면 '카드 묶음 예산'으로 부른다.
 */
export function budgetDisplayName(
  budget: Pick<BudgetSummary, "name" | "scopeType" | "scopeLabel">
): string {
  return (
    budget.name ??
    (budget.scopeType === "card_group" ? "카드 묶음 예산" : budget.scopeLabel)
  );
}

/**
 * 수정 창 설명 한 줄 — 이 예산이 어떤 지출을 더하는지 범위마다 맞게 말한다.
 *
 * 예전에는 모든 예산에 '선택한 카드의 지출만 합산해요'라고 써서 가족 전체·구성원·카테고리 예산에는
 * 틀린 말이었다(2026-11-05 HIG 검수). 단일 카드 예산을 묶음으로 바꾸는 중이면 `scopeType`에
 * 'card_group'을 넘긴다. 지난 달은 이름·한도를 고칠 수 없고 포함 카드만 바로잡는다.
 */
export function budgetEditDescription(
  scopeType: BudgetScopeType,
  isPastMonth: boolean
): string {
  if (isPastMonth) {
    return "이름과 한도는 그대로 두고 지출을 더할 카드만 바로잡으면, 쓴 금액을 다시 계산해요.";
  }
  switch (scopeType) {
    case "household":
      return "가족 모두가 쓴 돈을 합산해요.";
    case "member":
      return "이 구성원이 쓴 돈만 합산해요.";
    case "category":
      return "이 카테고리로 분류된 지출만 합산해요.";
    case "card":
      return "이 카드로 결제한 지출만 합산해요.";
    case "card_group":
      return "선택한 카드로 결제한 지출만 합산해요.";
  }
}

export type RemainingTone = "over" | "warn" | "ok";

/**
 * 막대 아래 '남은 금액' 한 줄(§5 예산: 사용 / 한도 + 막대 + 남은 금액). 서버 usageRate로만 가른다.
 *
 * 넘은 금액은 막대 아래 글자(UsageBar '12,000원 초과')가 이미 말하므로 여기서는 말하지 않는다(null) —
 * 같은 사실을 두 번 쓰지 않는다. 80% 이상은 경고 색과 함께 'N원 남았어요'로 말한다(홈 예산 줄과 같은 말).
 */
export function budgetRemainingLine(
  budget: Pick<BudgetSummary, "spent" | "amount" | "usageRate" | "currency">
): { text: string; tone: RemainingTone } | null {
  if (budget.usageRate >= 1) {
    return budget.spent > budget.amount
      ? null
      : { text: "예산을 다 썼어요", tone: "over" };
  }
  const remaining = formatMoney(budget.amount - budget.spent, budget.currency);
  if (budget.usageRate >= 0.8) {
    return { text: `${remaining} 남았어요`, tone: "warn" };
  }
  return { text: `${remaining} 더 쓸 수 있어요`, tone: "ok" };
}
