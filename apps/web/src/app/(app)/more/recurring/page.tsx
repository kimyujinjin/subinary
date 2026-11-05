"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 정기 지출 (/more/recurring)
 *
 * 이 화면이 하는 일은 둘이다.
 *   1. 이번 달 남은 정기 결제 합계를 보여준다(금액 레이어 S1)
 *   2. 반복으로 보이는 결제를 사용자가 "정기 결제 맞음 / 아님"으로 확정한다
 *
 * 목록은 상태별로 나눈다: 확인 필요(후보·재검토) → 정기 결제(확정) → 아님·해지(접어 둠).
 * **이미 답한 행에는 답 버튼을 다시 그리지 않는다.** 확정된 행의 채움 버튼을 다시 누르면
 * `confirmed`가 재전송되고, 서버가 "계속 써요" 답(`stoppedDismissedAt`)을 지워 해지
 * 질문이 다시 떴다(서버도 이제 같은 답을 무시한다). 답을 바꾸려면 ⋯ 메뉴를 쓴다.
 *
 * 후보는 서버가 30분마다 다시 찾는다(api recurring-refresh.service). 그래서 손으로 누르는
 * "다시 찾기" 대신 마지막으로 찾은 시각을 제목 아래에 보여준다.
 *
 * 예상일은 `last_seen_at`·`interval_days`의 순수 함수다(`@family/shared` forecastRecurring).
 * 창(±N일)과 함께 말한다 — 카드 결제일은 주말·영업일로 밀리므로 단일 날짜는 반드시 틀린다.
 *
 * 합계는 **예고할 수 있는 것만** 담는다. 근거에 v1이 하나라도 섞인 series는 금액을
 * 예고하지 않고(기획 D2), 외화는 환산하지 않는다. 빠진 건수는 한 줄로 반드시 말한다 —
 * 빠진 걸 숨긴 합계는 "이만큼만 나간다"는 거짓말이 된다.
 *
 * 금액은 예측하지 않는다 — 관측된 중앙값을 그대로 말한다.
 *
 * 합계는 목록과 따로 불러오므로 늦게 올 수 있다. 그 자리를 스켈레톤으로 잡아 둔다 — 늦게 뜬 합계가
 * 목록을 밀어내면 누르려던 줄이 손가락 아래에서 움직인다(2026-11-05 HIG 검수). 자리는 확정된 정기 결제가
 * 있을 때만 잡고(합계는 확정만 센다), 그때는 이번 달 예정이 0건이어도 '더 나갈 것이 없다'로 자리를 지킨다.
 * ------------------------------------------------------------------------- */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Repeat } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type {
  CardSmsDeclineReason,
  RecurringSeriesItem,
  RecurringSeriesListResponse,
  RecurringSeriesStatus,
  RecurringUpcomingResponse,
} from "@family/contracts";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  ErrorState,
  ListLoading,
  ListRow,
  Money,
  OverflowMenu,
  PageBackHeader,
  SectionHeader,
  StatusChip,
  declineReasonHint,
  type ChipTone,
  type OverflowAction,
} from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { transactionsHref } from "@/lib/deep-link";
import { leftOutText } from "@/lib/recurring-left-out";
import { formatMonthDay, formatRelativeTime } from "@/lib/format";
import { useHousehold } from "@/lib/household-context";
import {
  decideRecurringSeries,
  endOfMonthKst,
  fetchRecurringSeries,
  fetchRecurringUpcoming,
  recurringQueryKey,
  recurringUpcomingQueryKey,
} from "@/lib/recurring-api";

type Decision = "confirmed" | "rejected" | "ended" | "still_active";

/** 이름이 가려진 series의 표시명(계약: 타인의 `summary_only` 근거가 섞이면 이 값). */
const REDACTED_MERCHANT = "(비공개)";

/**
 * 네 답이 서로 다른 일을 한다 — 토스트도 그 차이를 말해야 사용자가 무엇이 바뀌었는지
 * 안다. 특히 `still_active`는 **아무 상태도 바꾸지 않는다.**
 */
const DECISION_MESSAGE: Record<Decision, string> = {
  confirmed: "정기 결제로 표시했어요.",
  rejected: "정기 결제가 아닌 것으로 표시해 '아님·해지'로 옮겼어요.",
  ended: "해지한 것으로 표시해 이번 달 예상에서 뺐어요.",
  still_active: "계속 쓰는 것으로 표시했어요.",
};

/** 접어 둔 '아님·해지' 묶음 — 답한 뒤 토스트의 '보기'가 이 자리로 데려간다. */
const CLOSED_SECTION_ID = "recurring-closed";

/** 관측된 사실만 말한다 — "월 1회"가 아니라 "약 30일마다"(우리가 본 것). */
function cadenceText(item: RecurringSeriesItem): string {
  return `약 ${item.intervalDays}일마다 · ${item.occurrenceCount}번 결제`;
}

/**
 * 다음 결제 예상을 짧게. **금액은 넣지 않는다** — 날짜만 확정적으로 말할 수 있다.
 * 창(N일 앞뒤)을 함께 말해 하루 밀린 결제가 틀린 예고가 되지 않게 한다. '±3일' 같은 기호 대신 말로 쓴다.
 * 날짜는 서울 기준 '11월 3일'(해가 바뀌면 연도까지 — 12월에 보는 1월 예정일).
 */
function forecastText(item: RecurringSeriesItem): string | null {
  if (!item.nextExpectedAt || item.nextExpectedPhase === null) return null;
  const when = formatMonthDay(item.nextExpectedAt);
  const range =
    item.nextExpectedWindowDays && item.nextExpectedWindowDays > 0
      ? `(${item.nextExpectedWindowDays}일 앞뒤)`
      : "";
  switch (item.nextExpectedPhase) {
    case "due":
      return `${when}쯤${range} 결제 예정`;
    case "overdue":
      return `${when}쯤 예정이었는데 아직 없어요`;
    default:
      return `다음 결제 ${when}쯤${range}`;
  }
}

/** 재검토 사유를 한 문장으로. 무엇이 바뀌어서 다시 묻는지 말해야 한다. */
function needsReviewText(item: RecurringSeriesItem): string | null {
  switch (item.needsReviewReason) {
    case "evidence_lost":
      return "근거가 된 결제가 사라져 다시 확인이 필요해요.";
    case "merged":
      return "가맹점을 묶으면서 다른 항목과 합쳐졌어요.";
    case "split":
      return "가맹점 묶음이 풀리면서 여러 건으로 나뉘었어요.";
    default:
      return null;
  }
}

/** 상태는 문장 대신 칩으로. 확정은 기본 상태라 칩을 그리지 않는다(§8). */
function statusChips(item: RecurringSeriesItem): { tone: ChipTone; label: string }[] {
  const chips: { tone: ChipTone; label: string }[] = [];
  if (item.status === "needs_review") chips.push({ tone: "attention", label: "다시 확인" });
  if (item.status === "rejected") chips.push({ tone: "neutral", label: "아님" });
  if (item.status === "ended") chips.push({ tone: "neutral", label: "해지함" });
  if (!item.mine) chips.push({ tone: "neutral", label: "가족" });
  return chips;
}

/**
 * 이미 답한 행의 "답 바꾸기" 메뉴. **지금과 같은 답은 넣지 않는다** — 다시 보내도
 * 바뀌는 것이 없고, 예전에는 그 재전송이 "계속 써요" 답을 지웠다.
 */
function changeActions(
  status: RecurringSeriesStatus,
  onDecide: (decision: Decision) => void,
  busy: boolean,
): OverflowAction[] {
  const option = (label: string, decision: Decision): OverflowAction => ({
    label,
    onSelect: () => onDecide(decision),
    disabled: busy,
  });
  switch (status) {
    case "confirmed":
      return [option("정기 결제 아니에요", "rejected"), option("해지했어요", "ended")];
    case "rejected":
      return [option("정기 결제 맞아요", "confirmed")];
    case "ended":
      return [option("다시 쓰고 있어요", "confirmed"), option("정기 결제 아니에요", "rejected")];
    default:
      return [];
  }
}

/** 상태별 묶음: 답이 필요한 것 → 정기 결제 → 아님·해지. 서버 순서(최근 결제순)는 유지한다. */
function groupSeries(items: readonly RecurringSeriesItem[]) {
  const review: RecurringSeriesItem[] = [];
  const active: RecurringSeriesItem[] = [];
  const closed: RecurringSeriesItem[] = [];
  for (const item of items) {
    if (item.status === "confirmed") active.push(item);
    else if (item.status === "rejected" || item.status === "ended") closed.push(item);
    else review.push(item);
  }
  return { review, active, closed };
}

/** 정기 결제 한 줄. 행을 누르면 그 가맹점의 결제 내역(전체 기간)으로 간다. */
function SeriesRow({
  item,
  busy,
  onDecide,
}: {
  item: RecurringSeriesItem;
  busy: boolean;
  onDecide: (decision: Decision) => void;
}) {
  const review = needsReviewText(item);
  const forecast = item.status === "confirmed" ? forecastText(item) : null;
  const declineHint = declineReasonHint(
    item.recentDeclineReason as CardSmsDeclineReason | null,
  );
  const varies = item.amountMin !== item.amountMax;
  const undecided = item.status === "candidate" || item.status === "needs_review";
  const actions = changeActions(item.status, onDecide, busy);
  const chips = statusChips(item);
  // 가려진 이름으로는 거래를 찾을 수 없다 — 링크를 걸지 않는다.
  const href =
    item.merchant === REDACTED_MERCHANT
      ? undefined
      : transactionsHref({ month: "all", q: item.merchant });

  return (
    <li className="flex flex-col">
      <div className="flex min-w-0 items-center">
        <ListRow
          className="min-w-0 flex-1"
          href={href}
          chevron={href != null}
          title={
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate">{item.merchant}</span>
              {chips.map((chip) => (
                <StatusChip key={chip.label} tone={chip.tone}>
                  {chip.label}
                </StatusChip>
              ))}
            </span>
          }
          subtitle={forecast ? `${forecast} · ${cadenceText(item)}` : cadenceText(item)}
          subtitleClassName="whitespace-normal break-words"
          value={<Money amount={item.amount} currency={item.currency} />}
          valueSub={
            varies ? (
              // 변동형 구독은 대표 금액만 보여주면 사용자가 "왜 다르지?"를 앱 밖에서 찾는다.
              <>
                <Money amount={item.amountMin} currency={item.currency} muted />~
                <Money amount={item.amountMax} currency={item.currency} muted />
              </>
            ) : undefined
          }
        />
        {actions.length > 0 ? (
          <OverflowMenu
            label={`${item.merchant} 답 바꾸기`}
            actions={actions}
            className="-mr-2 shrink-0"
          />
        ) : null}
      </div>

      {review ? (
        <p className="text-caption text-muted-foreground px-1 pb-2 sm:px-2">{review}</p>
      ) : null}

      {item.recentDeclineAttempts >= 2 ? (
        // 반복 거절은 기존 사유별 조치 화면으로 연결한다 — 여기서 조치를 새로 만들지 않는다.
        <Link
          href="/declines"
          className="text-caption text-warning-strong flex min-h-11 items-center gap-1.5 px-1 transition-opacity active:opacity-60 sm:px-2"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate">
            {declineHint ?? `최근 ${item.recentDeclineAttempts}번 결제에 실패했어요`}
          </span>
        </Link>
      ) : null}

      {/*
       * 해지 확인 (금액 레이어 S4, 기획 D4 "묻는다, 끄지 않는다"). 답을 받을 때까지 이
       * series는 예상 총액에 **그대로 남는다** — 시스템이 미리 빼면 사용자 모르게 총액이
       * 줄어든다. "계속 써요"는 상태를 바꾸지 않고 물어본 사실만 남긴다.
       */}
      {item.stoppedCandidate ? (
        <div className="flex flex-col gap-2 px-1 pb-3 sm:px-2">
          <p className="text-caption text-warning-strong">
            예정일이 지나도 결제가 없는데, 해지하셨나요?
          </p>
          <div className="flex gap-2">
            <Button
              variant="weak"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => onDecide("ended")}
            >
              해지했어요
            </Button>
            <Button
              variant="weak"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => onDecide("still_active")}
            >
              계속 써요
            </Button>
          </div>
        </div>
      ) : null}

      {/* 답이 필요한 행에만 답 버튼을 둔다. 두 답은 같은 무게다(한쪽으로 기울이지 않는다). */}
      {undecided ? (
        <div className="flex gap-2 px-1 pb-3 sm:px-2">
          <Button
            variant="weak"
            size="sm"
            className="flex-1"
            disabled={busy}
            onClick={() => onDecide("confirmed")}
          >
            정기 결제 맞아요
          </Button>
          <Button
            variant="weak"
            size="sm"
            className="flex-1"
            disabled={busy}
            onClick={() => onDecide("rejected")}
          >
            아니에요
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** 상태 묶음 하나 = 섹션 하나(회색 띠로 나뉜다). */
function SeriesSection({
  id,
  title,
  description,
  count,
  collapsed,
  onToggle,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  count: number;
  /** 접을 수 있는 묶음이면 현재 접힘 여부. 없으면 항상 펼친다. */
  collapsed?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const countText = <span className="text-caption text-muted-foreground tabular-nums">{count}건</span>;
  return (
    <section id={id} className="finance-panel scroll-mt-[calc(var(--app-header-h)+1rem)] overflow-hidden pt-2">
      <SectionHeader
        className="px-5"
        title={title}
        {...(onToggle
          ? { actionLabel: collapsed ? `${count}건 보기` : "접기", onAction: onToggle }
          : { trailing: countText })}
      />
      {description && !collapsed ? (
        <p className="text-caption text-muted-foreground px-5">{description}</p>
      ) : null}
      {collapsed ? null : (
        <ul className="divide-border/60 flex flex-col divide-y px-3 pb-1 sm:px-4">
          {children}
        </ul>
      )}
    </section>
  );
}

/**
 * 이번 달 남은 정기 합계 (금액 레이어 S1). 화면의 대표 금액이다.
 *
 * 예정이 0건일 때: 확정된 정기 결제가 있으면 '더 나갈 것이 없다'는 사실만 말하고 자리를 지킨다
 * — 스켈레톤이 잡아 둔 자리가 사라지면 목록이 위로 당겨진다. 확정된 것이 없으면(예정은 확정만 센다)
 * 아무것도 그리지 않는다 — 빈 합계가 "정기 결제가 없다"로 읽히면 그건 없는 사실이다.
 */
function UpcomingSummary({
  data,
  hasConfirmed,
}: {
  data: RecurringUpcomingResponse;
  hasConfirmed: boolean;
}) {
  if (data.items.length === 0) {
    if (!hasConfirmed) return null;
    return (
      <section className="finance-panel px-5 py-5">
        <p className="text-caption text-muted-foreground">이번 달 남은 정기 결제</p>
        <p className="text-body mt-1 font-semibold">이번 달에 더 나갈 정기 결제는 없어요.</p>
      </section>
    );
  }

  const overdue = data.items.filter((i) => i.nextExpectedPhase === "overdue").length;
  const meta = [
    data.forecastableCount > 0 ? `${data.forecastableCount}건 남았어요` : null,
    overdue > 0 ? `${overdue}건은 예정일이 지났어요` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const leftOut = leftOutText(data.excludedCount, data.otherCurrencyCount);

  return (
    <section className="finance-panel px-5 py-5">
      <p className="text-caption text-muted-foreground">이번 달 남은 정기 결제</p>
      {data.forecastableCount > 0 ? (
        <p className="text-display mt-1">
          <Money amount={data.totalAmount} currency={data.totalCurrency} />
        </p>
      ) : (
        <p className="text-body mt-1 font-semibold">금액을 아직 확인하지 못했어요.</p>
      )}
      {meta ? <p className="text-caption text-muted-foreground mt-1">{meta}</p> : null}
      {leftOut ? <p className="text-caption text-muted-foreground mt-1">{leftOut}</p> : null}
    </section>
  );
}

/**
 * 합계가 올 자리. `UpcomingSummary`와 같은 줄 높이(caption · display · caption)라 합계가 뜰 때 목록이 움직이지 않는다.
 * 글자 '불러오는 중'은 읽기 프로그램에만 준다 — 목록 스켈레톤과 함께 여러 곳에 글자를 띄우지 않는다.
 */
function UpcomingSummarySkeleton() {
  return (
    <section role="status" aria-busy="true" className="finance-panel px-5 py-5">
      <span className="sr-only">이번 달 남은 정기 결제를 불러오는 중이에요.</span>
      <div aria-hidden="true" className="text-caption">
        <Skeleton className="inline-block h-3 w-28 align-middle" />
      </div>
      <div aria-hidden="true" className="text-display mt-1">
        <Skeleton className="inline-block h-7 w-40 align-middle" />
      </div>
      <div aria-hidden="true" className="text-caption mt-1">
        <Skeleton className="inline-block h-3 w-36 align-middle" />
      </div>
    </section>
  );
}

export default function RecurringPage() {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const queryClient = useQueryClient();
  /** 아님·해지 묶음은 접어 둔다 — 이미 정리가 끝난 것들이다. */
  const [showClosed, setShowClosed] = useState(false);

  const seriesQuery = useQuery<RecurringSeriesListResponse>({
    queryKey: recurringQueryKey(householdId),
    enabled: householdId != null,
    queryFn: () =>
      authedFetch((token) => fetchRecurringSeries(token, householdId as string)),
  });

  // 창은 화면이 정한다("이번 달"). 한 번 계산해 두고 렌더마다 바꾸지 않는다 —
  // 매 렌더 새 값을 만들면 queryKey가 달라져 요청이 무한히 늘어난다.
  const until = useMemo(() => endOfMonthKst(), []);

  const upcomingQuery = useQuery<RecurringUpcomingResponse>({
    queryKey: recurringUpcomingQueryKey(householdId, until),
    enabled: householdId != null && seriesQuery.data?.enabled === true,
    queryFn: () =>
      authedFetch((token) =>
        fetchRecurringUpcoming(token, householdId as string, until),
      ),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: recurringQueryKey(householdId) }),
      // 판단은 예정 목록도 바꾼다 — 한쪽만 갱신하면 합계가 목록과 어긋난다.
      queryClient.invalidateQueries({ queryKey: ["recurring-upcoming"] }),
    ]);

  // 답한 줄이 접힌 '아님·해지'로 옮겨 가면 화면에서 사라진 것처럼 보인다. 토스트의 '보기'로 그 묶음을
  // 펼쳐 어디로 갔는지(그리고 거기 ⋯에서 답을 바꿀 수 있음을) 보여 준다. 후보로 되돌리는 답은 API에 없어
  // '되돌리기' 대신 이 길을 둔다.
  const showClosedGroup = () => {
    setShowClosed(true);
    requestAnimationFrame(() =>
      document
        .getElementById(CLOSED_SECTION_ID)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Decision }) =>
      authedFetch((token) => decideRecurringSeries(token, id, decision)),
    onSuccess: async (_, variables) => {
      await invalidate();
      const movedToClosed =
        variables.decision === "rejected" || variables.decision === "ended";
      toast.success(
        DECISION_MESSAGE[variables.decision],
        movedToClosed
          ? { action: { label: "보기", onClick: showClosedGroup } }
          : undefined,
      );
    },
    onError: () => toast.error("저장하지 못했어요. 잠시 후 다시 시도해 주세요."),
  });

  const data = seriesQuery.data;
  const groups = useMemo(() => groupSeries(data?.items ?? []), [data]);
  // 손으로 다시 찾는 버튼 대신 서버가 마지막으로 찾은 시각을 말한다(30분마다 갱신).
  const checkedText =
    data?.enabled && data.computedAt
      ? `${formatRelativeTime(data.computedAt)} 확인`
      : undefined;

  const renderRows = (items: RecurringSeriesItem[]) =>
    items.map((item) => (
      <SeriesRow
        key={item.id}
        item={item}
        busy={decide.isPending}
        onDecide={(decision) => decide.mutate({ id: item.id, decision })}
      />
    ));

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4 pb-8">
      <PageBackHeader title="정기 지출" subtitle={checkedText} />

      {seriesQuery.isPending ? (
        <ListLoading rows={3} label="정기 지출을 불러오는 중이에요." />
      ) : null}

      {seriesQuery.isError ? (
        <ErrorState
          message="정기 지출을 불러오지 못했어요"
          retrying={seriesQuery.isFetching}
          onRetry={() => void seriesQuery.refetch()}
        />
      ) : null}

      {data && !data.enabled ? (
        // ⚠️ 빈 목록을 "정기 결제가 없다"로 읽히게 두지 않는다 — 그건 없는 사실이다.
        <EmptyState
          icon={<Repeat />}
          title="아직 준비 중이에요"
          description="정기 지출 찾기는 아직 켜지 않았어요."
        />
      ) : null}

      {data?.enabled ? (
        <>
          {/*
           * 합계를 목록 **위**에 둔다 — 사용자가 이 화면에 오는 이유는 "얼마 나가지?"이고,
           * 개별 확정은 그 답을 얻은 뒤의 작업이다.
           *
           * 예정 합계는 확정된 정기 결제만 센다(API). 그래서 자리를 잡는 조건을 '확정이 하나라도 있다'로
           * 두고, 그때는 예정이 0건이어도 요약이 자리를 지킨다 — 스켈레톤과 요약의 조건이 같아야 목록이 안 움직인다.
           */}
          {upcomingQuery.data ? (
            <UpcomingSummary
              data={upcomingQuery.data}
              hasConfirmed={groups.active.length > 0}
            />
          ) : groups.active.length === 0 ? null : upcomingQuery.isError ? (
            // 합계가 조용히 빠지면 '이번 달에 나갈 정기 결제가 없다'로 읽힌다.
            <section className="finance-panel px-5 py-5">
              <ErrorState
                align="start"
                message="이번 달 남은 정기 결제를 불러오지 못했어요"
                retrying={upcomingQuery.isFetching}
                onRetry={() => void upcomingQuery.refetch()}
              />
            </section>
          ) : (
            <UpcomingSummarySkeleton />
          )}

          {data.items.length === 0 ? (
            data.computedAt ? (
              <EmptyState
                icon={<Repeat />}
                title="아직 찾은 정기 결제가 없어요"
                description="같은 가맹점에서 서로 다른 달에 3번 이상 결제되면 여기에 나와요."
                action={
                  // 가맹점 이름이 여러 개로 나뉘어 있으면 반복으로 보이지 않는다.
                  <Button variant="weak" className="w-full" asChild>
                    <Link href="/more/merchants">가맹점 정리하기</Link>
                  </Button>
                }
              />
            ) : (
              // 후보 0건과 아직 계산 전을 구분한다(계약 `computedAt`).
              <EmptyState
                icon={<Repeat />}
                title="정기 결제를 찾고 있어요"
                description="잠시 뒤에 다시 열어 보세요."
              />
            )
          ) : (
            <>
              {groups.review.length > 0 ? (
                <SeriesSection
                  title="확인 필요"
                  description="최근 6개월에 반복된 결제예요."
                  count={groups.review.length}
                >
                  {renderRows(groups.review)}
                </SeriesSection>
              ) : null}
              {groups.active.length > 0 ? (
                <SeriesSection title="정기 결제" count={groups.active.length}>
                  {renderRows(groups.active)}
                </SeriesSection>
              ) : null}
              {groups.closed.length > 0 ? (
                <SeriesSection
                  id={CLOSED_SECTION_ID}
                  title="아님·해지"
                  count={groups.closed.length}
                  collapsed={!showClosed}
                  onToggle={() => setShowClosed((open) => !open)}
                >
                  {renderRows(groups.closed)}
                </SeriesSection>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
