"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · '이 달의 특징' 카드 (분석 탭)
 *
 * GET /v1/ai/monthly-insights 로 전월 대비 추세·이상 지출·예산 소진 예측을 해요체
 * 문구로 보여준다. 사실은 전부 서버가 계산하고 LLM은 문구만 다듬는다(키 없으면 서버
 * 문구 그대로).
 *
 * 화면 이름은 여는 버튼과 같은 '이 달의 특징' 하나다 — 예전에는 '이 달의 특징 보기'를 누르면
 * 'AI 인사이트'가 열려 같은 기능이 두 이름이었다(2026-11-05 HIG 검수). 로딩은 스켈레톤, 실패는
 * 원인과 '다시 불러오기', 찾은 것이 없으면 그렇다고 말한다(사용자가 눌러 연 카드라 숨기지 않는다).
 *
 * **화면을 여는 것만으로 조회하지 않는다.** 분석 화면은 "화면을 열 때 별도 모델
 * 호출을 만들지 않는다"는 결정을 갖고 있고, 그 결정 때문에 이 카드는 한동안 아무
 * 데서도 마운트되지 않은 채 남아 있었다. 그래서 호출 시점을 **사용자가 누를 때**로
 * 옮겼다 — 기능은 살리고 자동 호출은 여전히 하지 않는다. 부모가 마운트 자체를
 * 제어하므로 여기서는 별도 `enabled` 플래그를 두지 않는다.
 * ------------------------------------------------------------------------- */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Sparkles, TrendingUp, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import type { MonthlyInsight, MonthlyInsightKind } from "@family/contracts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/widgets/error-state";
import { ListLoading } from "@/components/widgets/list-loading";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { cn } from "@/lib/utils";

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

  // 사용자가 직접 눌러서 연 카드다 — 로딩과 "찾은 것 없음"을 숨기면 아무 일도
  // 일어나지 않은 것처럼 보인다. 둘과 오류는 각각 다른 상태로 구분해 보여 준다.
  let body: ReactNode;
  if (query.isLoading) {
    body = <ListLoading rows={1} label="이 달의 특징을 찾고 있어요." />;
  } else if (query.isError) {
    body = (
      <ErrorState
        message="이 달의 특징을 불러오지 못했어요"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="py-6"
      />
    );
  } else if (insights.length === 0) {
    body = (
      <p role="status" className="text-body text-muted-foreground">
        이 달에는 눈에 띄는 특징이 없어요
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-3">
        {insights.map((insight, i) => {
          const style = KIND_STYLE[insight.kind];
          const Icon = style.icon;
          return (
            <li key={i} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  style.className
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="text-body pt-1">{insight.message}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles
            aria-hidden="true"
            className="text-accent-foreground size-4 shrink-0"
          />
          이 달의 특징
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
