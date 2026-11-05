/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 전체 메뉴 줄 오른쪽의 남은 일 수
 *
 * '가맹점 분류 검토'는 계속 쌓이는 할 일인데 자동 분류 규칙 화면에 들어가야만 보였다(2026-11 HIG 검수).
 * 메뉴 줄 오른쪽에 회색 값으로 남은 수를 둔다. 말은 그 화면 맨 위 카드와 같다('12곳 남음').
 * ------------------------------------------------------------------------- */
import type { MerchantLabelCandidateListResponse } from "@family/contracts";

/** 없거나 아직 모르면(불러오는 중·실패) null — 메뉴 줄에 아무것도 쓰지 않는다. */
export function ruleReviewLeftText(
  data:
    | Pick<MerchantLabelCandidateListResponse, "items" | "hasMore">
    | undefined
): string | null {
  const count = data?.items.length ?? 0;
  if (count === 0) return null;
  return `${count}곳${data?.hasMore ? " 이상" : ""} 남음`;
}
