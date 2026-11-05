"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가계부 분석 탭 "앞으로 나갈 돈" (금액 레이어 S2)
 *
 * 히어로가 "이번 달 얼마 썼나"를 말한다. 이 카드는 그 다음 질문에 답한다 —
 * **"앞으로 얼마 더 나가나."**
 *
 * 화면의 대표 숫자는 히어로의 '이번 달 소비' 하나다. 그래서 여기 두 금액(앞으로 나갈 돈·이번 달
 * 예상 총액)은 큰 숫자가 아니라 본문 크기 '이름 · 값' 줄(FieldRow)로 둔다 — 예전에는 첫 화면에
 * 큰 금액이 셋이라 무엇을 봐야 할지 흐려졌다(2026-11-05 HIG 검수).
 *
 * ## 절제가 이 카드의 품질이다 (기획 D6)
 *
 * 이번 달 예상 = **이미 쓴 것(확정) + 남은 정기(관측된 반복)**. 그게 전부다.
 * 변동 지출은 예측하지 않는다 — 평균 기반 추정은 틀리고, 틀린 숫자가 홈 히어로 옆에
 * 붙으면 앱 전체 신뢰가 깎인다.
 *
 * 이중 계상은 구조적으로 막힌다: `nextExpectedAt`은 `lastSeenAt + interval`이라
 * 이번 달에 이미 결제된 series는 예상일이 다음 달로 넘어가 조회 창(이번 달 말)을
 * 벗어난다. 그래서 "이미 쓴 것"과 "남은 정기"가 같은 결제를 두 번 세지 않는다.
 *
 * ## 언제 사라지는가
 *
 * 세 경우에 **아무것도 그리지 않는다**(기존 빈 상태 규칙):
 *  1. 정기 지출 Radar가 꺼져 있다
 *  2. 예정이 0건이다 — 빈 카드가 "정기 결제 없음"으로 읽히면 그건 없는 사실이다
 *  3. 과거 달을 보고 있다 — 지난 달에 "앞으로 나갈 돈"은 뜻이 없다
 *
 * ## 빠진 것을 말한다
 *
 * 합계는 **금액을 예고할 수 있는 것만** 담는다(기획 D2). 근거에 v1 거래가 섞인
 * series와 외화는 빠지고, 빠진 건수를 문구로 말한다 — 빠진 걸 숨긴 합계는
 * "이만큼만 나간다"는 거짓말이 된다. 문장은 정기 지출 화면과 같다(`leftOutText`).
 * ------------------------------------------------------------------------- */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";

import type { RecurringUpcomingResponse } from "@family/contracts";

import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/widgets";
import { FieldRow } from "@/components/widgets/field-row";
import { leftOutText } from "@/lib/recurring-left-out";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import {
  endOfMonthKst,
  fetchRecurringUpcoming,
  recurringUpcomingQueryKey,
} from "@/lib/recurring-api";

export function UpcomingSpendCard({
  isCurrentMonth,
  monthlyNet,
}: {
  /** 과거 달을 보고 있으면 렌더하지 않는다. */
  isCurrentMonth: boolean;
  /**
   * 이번 달 이미 쓴 순액(ADR-0026 지출 합계). `null`이면 아직 모르는 것이므로
   * 예상 총액을 만들지 않는다 — 반쪽 합계를 "이번 달 예상"이라고 부르면 안 된다.
   */
  monthlyNet: number | null;
}) {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();

  // 창은 한 번만 계산한다. 매 렌더 새 값을 만들면 queryKey가 달라져 요청이 늘어난다.
  const until = useMemo(() => endOfMonthKst(), []);

  const query = useQuery<RecurringUpcomingResponse>({
    queryKey: recurringUpcomingQueryKey(householdId, until),
    enabled: householdId != null && isCurrentMonth,
    queryFn: () =>
      authedFetch((token) =>
        fetchRecurringUpcoming(token, householdId as string, until),
      ),
  });

  const data = query.data;

  // 로딩·에러에도 아무것도 그리지 않는다. 이 카드는 보조 정보이고, 분석 탭에서 실패
  // 문구가 하나 더 늘어나는 것보다 조용히 없는 편이 낫다(히어로는 자기 상태를 말한다).
  if (!isCurrentMonth || !data?.enabled || data.items.length === 0) return null;

  const overdue = data.items.filter(
    (i) => i.nextExpectedPhase === "overdue",
  ).length;
  const hasAmount = data.forecastableCount > 0;
  // 예상 총액은 **양쪽을 다 알 때만** 만든다.
  const projected =
    hasAmount && monthlyNet !== null ? monthlyNet + data.totalAmount : null;

  const remaining = hasAmount ? data.forecastableCount : data.items.length;
  const leftOut = leftOutText(data.excludedCount, data.otherCurrencyCount);

  return (
    <Card>
      <CardContent className="flex flex-col">
        <div className="divide-border/60 flex min-w-0 flex-col divide-y">
          <FieldRow
            label="앞으로 나갈 돈"
            muted={!hasAmount}
            value={
              hasAmount ? (
                <span className="text-foreground font-semibold tabular-nums">
                  <Money
                    amount={data.totalAmount}
                    currency={data.totalCurrency}
                  />
                </span>
              ) : (
                "금액 확인 전"
              )
            }
          >
            정기 결제 {remaining}건이 이번 달에 남았어요
            {overdue > 0 ? ` · ${overdue}건은 예정일이 지났어요` : ""}
          </FieldRow>

          {/*
           * 이번 달 예상 총액 — 기획 D6. "이미 쓴 것 + 남은 정기"이며 변동 지출은
           * 여기 없다. 그 사실을 문구로 밝혀야 사용자가 이 숫자를 과신하지 않는다('만').
           */}
          {projected !== null ? (
            <FieldRow
              label="이번 달 예상 총액"
              value={
                <span className="text-foreground font-semibold tabular-nums">
                  <Money amount={projected} currency={data.totalCurrency} />
                </span>
              }
            >
              이미 쓴 돈에 남은 정기 결제만 더했어요.
            </FieldRow>
          ) : null}
        </div>

        {/* 빠진 것. 두 사유는 사용자가 할 수 있는 일이 달라서 따로 말한다. */}
        {leftOut ? (
          <p className="text-caption text-muted-foreground pt-2">{leftOut}</p>
        ) : null}

        <Link
          href="/more/recurring"
          className="text-body text-primary inline-flex min-h-11 items-center self-start font-medium underline-offset-2 hover:underline active:opacity-60"
        >
          정기 지출 전체 보기
        </Link>
      </CardContent>
    </Card>
  );
}

// 합계에서 뺀 것을 말하는 문장은 정기 지출 화면과 한 곳에서 가져온다(옛 import 경로 호환을 위해 다시 내보낸다).
export { leftOutText } from "@/lib/recurring-left-out";
