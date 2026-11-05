import type { ManualHousingPlan } from "@family/contracts";

/**
 * 주택 계획 목록 줄의 부제: '2028년 입주 · 중도금 내는 중'.
 * 모르는 입주연도는 '미입력'으로 남긴다 — 비워 두면 줄이 무엇을 빠뜨렸는지 알 수 없다.
 * 공개 범위·출처('가족 공개 · 직접 입력')는 넣지 않는다(§8: 모든 기록은 가족 공개라 줄마다 같은 말이었다).
 */
export function planRowSubtitle(
  item: Pick<ManualHousingPlan, "occupancyYear" | "contractStage">
): string {
  return [
    item.occupancyYear ? `${item.occupancyYear}년 입주` : "입주연도 미입력",
    item.contractStage,
  ]
    .filter(Boolean)
    .join(" · ");
}
