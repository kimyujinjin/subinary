import type { ImportedLoanRecord } from "@family/contracts";

import type { ChipTone } from "@/components/widgets/status-chip";
import { formatRelativeTime } from "@/lib/format";
import type { ConnectedHolding } from "@/lib/net-worth";

/** 목록 줄의 상태 칩 — [색, 글자]. 문제가 없으면 칩을 달지 않는다. */
export type RowChip = [ChipTone, string];

/**
 * 합계에서 뺀 이유(§3.5-5: 제외 이유는 칩·한 줄로 남긴다). 칩은 '합계 제외'로 시작해 이름 규칙을 지키고,
 * 뒤에 짧은 이유를 붙인다 — 예전에는 '합계 제외'만 있어 왜 빠졌는지, 고쳐야 하는지 알 수 없었다(2026-11-05 HIG 검수).
 * 사용자가 고를 수 있는 '기록만 보관'은 문제가 아니라 회색, 나머지는 확인할 일이 있어 주의 색이다.
 */
const LOAN_EXCLUSION: Record<
  NonNullable<ImportedLoanRecord["exclusionReason"]>,
  RowChip
> = {
  reference: ["neutral", "합계 제외 · 기록만 보관"],
  replacement_changed: ["attention", "합계 제외 · 연결 확인 필요"],
  duplicate_visible_loan: ["attention", "합계 제외 · 중복 확인 필요"],
  sharing_expired: ["attention", "합계 제외 · 공유 확인 필요"],
};

export function importedLoanChip(
  item: Pick<ImportedLoanRecord, "includedInTotals" | "exclusionReason">
): RowChip | null {
  if (item.includedInTotals) return null;
  return item.exclusionReason
    ? LOAN_EXCLUSION[item.exclusionReason]
    : ["attention", "합계 제외 · 설정 확인 필요"];
}

/** 가져온 대출을 고치는 곳(기록 목록에서 눌러 수정). */
export const LOAN_RECORDS_HREF = "/assets/loan-records";

/**
 * 가져온 대출 줄이 가는 곳. 위의 '확인이 필요한 대출' 줄과 같은 기록 화면으로 보낸다 —
 * 예전 /assets/loan-import는 신한 연결 화면으로 넘어가 칩이 말하는 확인을 할 곳이 없었다(2026-11-06 검수).
 * 내가 가져온 것만 고칠 수 있어, 가족이 가져온 대출은 누를 수 없는 줄로 둔다.
 */
export function importedLoanHref(
  item: Pick<ImportedLoanRecord, "canEdit">
): string | undefined {
  return item.canEdit ? LOAN_RECORDS_HREF : undefined;
}

/** 가져온 대출이 대신 계산하는 직접 입력 대출. 같은 대출이 두 번 더해지지 않게 뺐다. */
export const REPLACED_MANUAL_CHIP: RowChip = [
  "neutral",
  "합계 제외 · 가져온 대출로 대체",
];

/**
 * 연결 계좌가 마지막 조회 값을 보여 주는 중이면 언제 값인지 적는다.
 * 예전 칩 '이전 조회'는 무슨 뜻인지, 문제가 있다는 뜻인지 알 수 없었다.
 */
export function holdingChip(
  holding: Pick<ConnectedHolding, "stale" | "observedAt">
): RowChip | null {
  if (!holding.stale) return null;
  const when = formatRelativeTime(holding.observedAt);
  return ["neutral", when ? `마지막 조회 · ${when}` : "마지막 조회 값"];
}

/** 합계에서 빠져 확인이 필요한 가져온 대출(서버의 unresolvedLoans와 같은 기준: 뺐고, '기록만 보관'이 아님). */
export function unresolvedImportedLoans<
  T extends Pick<ImportedLoanRecord, "includedInTotals" | "totalMode">
>(items: readonly T[]): T[] {
  return items.filter(
    (item) => !item.includedInTotals && item.totalMode !== "reference"
  );
}
