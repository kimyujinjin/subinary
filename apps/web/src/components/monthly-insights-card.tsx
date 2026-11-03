"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 월간 인사이트 카드 (AI)
 *
 * GET /v1/ai/monthly-insights 로 전월 대비 추세·이상 지출·예산 소진 예측을 해요체
 * 문구로 보여준다. 사실은 전부 서버가 계산하고 LLM은 문구만 다듬는다(키 없으면 서버
 * 문구 그대로). 인사이트가 없으면 렌더 안 함.
 *
 * **화면을 여는 것만으로 조회하지 않는다.** 분석 화면은 "화면을 열 때 별도 모델
 * 호출을 만들지 않는다"는 결정을 갖고 있고, 그 결정 때문에 이 카드는 한동안 아무
 * 데서도 마운트되지 않은 채 남아 있었다. 그래서 호출 시점을 **사용자가 누를 때**로
 * 옮겼다 — 기능은 살리고 자동 호출은 여전히 하지 않는다. 부모가 마운트 자체를
 * 제어하므로 여기서는 별도 `enabled` 플래그를 두지 않는다.
 * ------------------------------------------------------------------------- */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Sparkles, TrendingUp, Wallet } from "lucide-react";

import type { MonthlyInsight, MonthlyInsightKind } from "@family/contracts";

import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatMonth } from "@/lib/format";
import { useHousehold } from "@/lib/household-context";

/** insight 종류별 아이콘/색조. */
const KIND_STYLE: Record<
  MonthlyInsightKind,
  { icon: typeof TrendingUp; className: string }
> = {
  trend: { icon: TrendingUp, className: "text-accent-foreground bg-accent" },
  anomaly: {
    icon: AlertTriangle,
    className: "text-warning-strong bg-warning/10",
  },
  budget: { icon: Wallet, className: "text-destructive bg-destructive/10" },
};

export function MonthlyInsightsCard({ month }: { month?: string }) {
  const { authedFetch } = useAuth();
  const { householdId } = useHousehold();

  const query = useQuery({
    queryKey: ["monthly-insights", householdId, month ?? null],
    enabled: householdId != null,
    staleTime: 5 * 60_000,
    queryFn: () =>
      authedFetch((token) =>
        api.ai.monthlyInsights(token, {
          householdId: householdId as string,
          ...(month ? { month } : {}),
        })
      ),
  });

  const insights: MonthlyInsight[] = query.data?.insights ?? [];

  const title = month ? `${formatMonth(month)} AI 인사이트` : "AI 인사이트";

  // 사용자가 직접 눌러서 연 카드다 — 로딩과 "찾은 것 없음"을 숨기면 아무 일도
  // 일어나지 않은 것처럼 보인다. 둘과 오류는 각각 다른 상태로 구분해 보여 준다.
  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2">
          <Sparkles
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
          <span role="status" className="text-muted-foreground text-sm">
            {title}를 확인하고 있어요
          </span>
        </CardContent>
      </Card>
    );
  }

  if (!query.isError && insights.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2">
          <Sparkles
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
          <span role="status" className="text-muted-foreground text-sm">
            이 달에는 알려드릴 만한 특징을 찾지 못했어요
          </span>
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2">
          <Sparkles className="text-muted-foreground size-4" />
          <span className="text-muted-foreground text-sm">
            인사이트를 불러오지 못했어요
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="text-accent-foreground size-4" />
          <span className="text-[15px] font-semibold">{title}</span>
        </div>
        <ul className="flex flex-col gap-2.5">
          {insights.map((insight, i) => {
            const style = KIND_STYLE[insight.kind];
            const Icon = style.icon;
            return (
              <li key={i} className="flex items-start gap-3">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full ${style.className}`}
                >
                  <Icon className="size-4" />
                </span>
                <span className="pt-1 text-sm leading-snug">
                  {insight.message}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
