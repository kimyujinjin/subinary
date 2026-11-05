"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · AI 처리 현황 (/ai-operations, 운영자 전용)
 *
 * 서버 전체 큐·경보 지표가 들어 있어 서버가 **운영자 허용 목록**(`AI_OPERATIONS_OPERATOR_USER_IDS`)
 * + 가족 owner/admin일 때만 연다. 메뉴에는 없고 주소로만 들어온다. 403이면 다시 묻지 않고
 * "접근할 수 없어요"로 끝낸다(30초 자동 갱신도 멈춘다).
 * ------------------------------------------------------------------------- */
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  Database,
  Gauge,
  Lock,
  ShieldCheck,
} from "lucide-react";

import type { LearningOperationsMetricsResponse } from "@family/contracts";

import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  ListLoading,
  PageBackHeader,
} from "@/components/widgets";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";

const WINDOW_HOURS = 24;
const REFRESH_MS = 30_000;

/** 큐 이름 → 읽을 수 있는 이름. 모르는 큐는 이름 그대로 둔다. */
const QUEUE_LABELS: Record<string, string> = {
  "card-sms-parse": "카드 문자 읽기",
  "slack-import": "슬랙 가져오기",
  "rag-index": "검색 색인",
  "source-tombstone": "삭제 반영",
  "memory-extract": "기억 추출",
  "graph-extract": "관계 추출",
  "category-suggest": "카테고리 추천",
  "notification-dispatch": "알림 발송",
};

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return "대기 없음";
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}분`;
  return `${Math.floor(seconds / 3_600)}시간`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}초`;
}

function formatRate(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 flex flex-col gap-1 rounded-control px-3 py-2.5">
      <span className="text-muted-foreground text-caption">{label}</span>
      <span className="text-heading tabular-nums">{value}</span>
    </div>
  );
}

function Dashboard({ data }: { data: LearningOperationsMetricsResponse }) {
  const unhealthy =
    data.queues.unavailableQueues > 0 ||
    data.outbox.quarantinedInWindow > 0 ||
    data.alerts.failed > 0;
  const warning =
    data.queues.waiting + data.queues.delayed > 0 ||
    data.outbox.pending > 0 ||
    data.alerts.pending > 0 ||
    data.pipelines.failed > 0;

  return (
    <>
      <Card className="gap-3 px-5">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-10 items-center justify-center rounded-full ${
              unhealthy
                ? "bg-destructive/10 text-destructive"
                : warning
                  ? "bg-warning/15 text-warning-strong"
                  : "bg-success/15 text-success-strong"
            }`}
          >
            {unhealthy || warning ? (
              <AlertTriangle className="size-5" />
            ) : (
              <ShieldCheck className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-body font-semibold">
              {unhealthy
                ? "확인이 필요한 항목이 있어요"
                : warning
                  ? "처리 중이거나 최근 실패가 있어요"
                  : "모두 정상이에요"}
            </div>
            <div className="text-muted-foreground text-caption">
              최근 {data.window.hours}시간 · 30초마다 자동 갱신
            </div>
          </div>
          <Badge variant={unhealthy ? "destructive" : warning ? "warning" : "success"}>
            {unhealthy ? "점검" : warning ? "주의" : "정상"}
          </Badge>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" /> 대기열
            </CardTitle>
            <CardDescription>서버 전체 작업 대기열 지금 상태</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Metric label="대기" value={data.queues.waiting.toLocaleString()} />
            <Metric label="처리 중" value={data.queues.active.toLocaleString()} />
            <Metric label="지연" value={data.queues.delayed.toLocaleString()} />
            <Metric
              label="최장 대기"
              value={formatAge(data.queues.oldestPendingAgeSeconds)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4" /> 실행 안정성
            </CardTitle>
            <CardDescription>선택한 가족의 처리 실행</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Metric label="실행" value={data.pipelines.total.toLocaleString()} />
            <Metric label="성공" value={data.pipelines.succeeded.toLocaleString()} />
            <Metric
              label="실패율"
              value={formatRate(data.pipelines.failureRateBasisPoints)}
            />
            <Metric
              label="느린 처리(상위 5%)"
              value={formatDuration(data.pipelines.p95DurationMs)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" /> AI 사용량
            </CardTitle>
            <CardDescription>사용량은 비용을 가늠하는 값이에요</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Metric label="호출" value={data.ai.invocations.toLocaleString()} />
            <Metric label="오류율" value={formatRate(data.ai.errorRateBasisPoints)} />
            <Metric label="입력량" value={data.ai.inputTokens.toLocaleString()} />
            <Metric label="출력량" value={data.ai.outputTokens.toLocaleString()} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" /> 학습 품질
            </CardTitle>
            <CardDescription>사람이 확인한 분류와 학습 실행 상태</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Metric
              label="사람 확인 분류"
              value={data.quality.humanConfirmedLabels.toLocaleString()}
            />
            <Metric
              label="분류 종류"
              value={data.quality.distinctLabelClasses.toLocaleString()}
            />
            <Metric
              label="승인된 학습 자료"
              value={data.quality.approvedDatasets.toLocaleString()}
            />
            <Metric
              label="평가 통과"
              value={data.quality.evaluationsPassed.toLocaleString()}
            />
            <Metric
              label="학습 성공"
              value={data.quality.trainingSucceeded.toLocaleString()}
            />
            <Metric
              label="학습 대기/실행"
              value={(
                data.quality.trainingQueued + data.quality.trainingRunning
              ).toLocaleString()}
            />
            <Metric
              label="학습 실패/차단"
              value={data.quality.trainingFailedOrBlocked.toLocaleString()}
            />
            <Metric
              label="학습 폐기"
              value={data.quality.trainingRevoked.toLocaleString()}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>전달과 경보</CardTitle>
          <CardDescription>가족 이벤트 전달과 서버 전체 운영 경보</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="전달 대기" value={data.outbox.pending.toLocaleString()} />
          <Metric
            label="최근 격리"
            value={data.outbox.quarantinedInWindow.toLocaleString()}
          />
          <Metric label="경보 대기" value={data.alerts.pending.toLocaleString()} />
          <Metric label="경보 실패" value={data.alerts.failed.toLocaleString()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>대기열별</CardTitle>
          <CardDescription>작업 내용과 개별 식별자는 보여 주지 않아요</CardDescription>
        </CardHeader>
        <CardContent className="divide-border/60 flex flex-col divide-y">
          {data.queues.items.map((queue) => (
            <div key={queue.name} className="flex min-h-12 items-center gap-3 py-2">
              <span className="text-body min-w-0 flex-1 truncate font-medium">
                {QUEUE_LABELS[queue.name] ?? queue.name}
              </span>
              {!queue.available ? (
                <Badge variant="destructive">연결 실패</Badge>
              ) : (
                <span className="text-muted-foreground text-caption tabular-nums">
                  대기 {queue.waiting} · 처리 {queue.active} · 실패 {queue.failed}
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function NoAccess() {
  return (
    <EmptyState
      icon={<Lock />}
      title="접근할 수 없어요"
      description="운영자로 등록된 계정만 볼 수 있어요"
    />
  );
}

export default function AiOperationsPage() {
  const { authedFetch } = useAuth();
  const { householdId, activeMembership } = useHousehold();
  // 서버가 최종 판정한다(운영자 허용 목록 + 역할). 역할이 아니면 물어볼 필요도 없다.
  const roleAllows =
    activeMembership?.role === "owner" || activeMembership?.role === "admin";
  const query = useQuery({
    queryKey: ["ai-pipeline-operations", householdId, WINDOW_HOURS],
    enabled: householdId !== null && roleAllows,
    queryFn: () =>
      authedFetch((token) =>
        api.learning.operationsMetrics(token, {
          householdId: householdId as string,
          windowHours: WINDOW_HOURS,
        }),
      ),
    // 403은 다시 물어도 같다 — 재시도·자동 갱신을 멈춘다.
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 1,
    refetchInterval: (q) => (isForbidden(q.state.error) ? false : REFRESH_MS),
  });

  const errorMessage =
    query.error instanceof ApiError
      ? query.error.message
      : "운영 지표를 불러오지 못했어요.";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-4">
      <PageBackHeader title="AI 처리 현황" />

      {!roleAllows || isForbidden(query.error) ? (
        <NoAccess />
      ) : query.isLoading ? (
        <ListLoading rows={3} label="운영 지표를 불러오는 중이에요." />
      ) : query.isError ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="운영 지표를 불러오지 못했어요"
          description={errorMessage}
        />
      ) : query.data ? (
        <Dashboard data={query.data} />
      ) : null}
    </div>
  );
}
