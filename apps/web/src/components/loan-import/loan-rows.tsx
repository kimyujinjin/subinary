import type { ImportedLoanRecord } from "@family/contracts";

import { formatMonthDay } from "@/lib/format";

type Inclusion = Pick<
  ImportedLoanRecord,
  "includedInTotals" | "totalMode" | "exclusionReason"
>;

/**
 * 대출 기록 수정 창의 한 줄 설명 — 합계에 어떻게 들어가는지(빠졌으면 왜 빠졌는지).
 * 목록 줄의 '합계 제외' 칩은 자산 탭과 같은 `importedLoanChip`(app/(app)/assets/asset-rows)을 쓴다 —
 * 같은 대출이 화면마다 다른 말·색으로 보이지 않게, 사용자가 고르는 선택지 이름 '기록만 보관'으로 맞춘다.
 */
export function loanInclusionLabel(item: Inclusion): string {
  if (item.includedInTotals) {
    return item.totalMode === "replacement"
      ? "직접 입력한 대출 대신 합계에 들어가요"
      : "별도 대출로 합계에 들어가요";
  }
  const reasons: Record<NonNullable<ImportedLoanRecord["exclusionReason"]>, string> = {
    reference: "기록만 보관해서 합계에서 빠져요",
    replacement_changed: "연결한 대출이 바뀌어 합계에서 빠졌어요 · 연결 확인 필요",
    duplicate_visible_loan: "같은 대출이 겹쳐 합계에서 빠졌어요 · 중복 확인 필요",
    sharing_expired: "공유 상태가 바뀌어 합계에서 빠졌어요 · 공유 확인 필요",
  };
  return item.exclusionReason
    ? reasons[item.exclusionReason]
    : "합계에서 빠졌어요 · 반영 방법 확인 필요";
}

/**
 * 가져온 대출 기록 줄의 부제: '나만 보기 · 전세 대출 · 만기 2027년 3월 2일'.
 * 은행 잔액 기준일을 모른다는 안내는 줄마다 붙이지 않고 목록 아래에 한 번만 둔다.
 */
export function loanRowSubtitle(
  item: Pick<ImportedLoanRecord, "visibility" | "loanType" | "maturityDate">,
  now: Date = new Date()
): string {
  return [
    item.visibility === "private" ? "나만 보기" : null,
    item.loanType === "interim" ? "중도금 대출" : "전세 대출",
    item.maturityDate ? `만기 ${formatMonthDay(item.maturityDate, now)}` : "만기 미확인",
  ]
    .filter(Boolean)
    .join(" · ");
}
