"use client";
/**
 * 기존 홈의 월별 소비·예산·분석·최근 거래와 초기 설정 흐름을 보존한다.
 * 거래 검토·문자 처리의 전체 목록은 /todo, 판단이 필요한 거래는 /transactions?review=1.
 * 집계는 기존 서버 계약을 그대로 사용하며 이 화면에서 금액을 재합산하지 않는다.
 */
import { Check, CreditCard, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  BudgetScopeType,
  MemberColor,
  TransactionSummary,
} from "@family/contracts";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BarList,
  EmptyState,
  ListRow,
  Money,
  MonthSwitcher,
  StatusBadge,
  UsageBar,
  type BarListItem,
} from "@/components/widgets";
import { UpcomingSpendCard } from "../../dashboard/upcoming-card";
import { LedgerNav } from "@/components/ledger-nav";
import { MonthlyInsightsCard } from "@/components/monthly-insights-card";
import { AddTransactionDialog } from "../../transactions/add-transaction-dialog";
import { ApiError } from "@/lib/api-client";
import {
  currentMonth,
  formatDate,
  formatMonth,
  formatWon,
  percent,
} from "@/lib/format";
import { categoryIcon } from "@/lib/category-icon";
import { budgetTransactionsHref, transactionsHref } from "@/lib/deep-link";
import { useHousehold } from "@/lib/household-context";
import { memberColorClass, sharedColorClass } from "@/lib/member-color";
import {
  attributedMemberId,
  sharedCardIdSet,
} from "@/lib/transaction-attribution";
import { addMonths, isMonthKey } from "@/lib/month";
import {
  useAnalyticsMonths,
  useBudgets,
  useCardList,
  useCards,
  useCategories,
  useCategoryList,
  useDevices,
  useHouseholdMembers,
  useHouseholdSummary,
  useMembers,
  useMerchants,
  useMonthly,
  useTransactions,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

/** BarList 상위 노출 개수(구성원/카드/카테고리 공통). */
const BREAKDOWN_TOP_N = 6;

/** 예산 사용률 패널에 노출할 상위 예산 개수. */
const BUDGET_TOP_N = 5;

/** 최근 거래 홈 노출 개수(쿼리는 10건 유지, 표시만 5건). */
const RECENT_DISPLAY_N = 5;

/** 실시간 카드문자 반영 폴링 간격(ms). 포커스 상태에서만 동작. */
// 실시간 반영의 주 채널은 SSE(ActivityProvider) — 폴링은 SSE 불통 시 안전망이라
// 저빈도(60초)로 둔다. staleTime 30초 + 포커스 리페치가 2차 안전망.
const REALTIME_POLL_MS = 60_000;

/** 온보딩 체크리스트 1단계. `done`은 이미 로딩 중인 쿼리로만 판정한다. */
interface ChecklistStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  /** 미완료일 때 이동할 설정 화면. */
  href?: string;
  /** 미완료일 때 버튼 라벨('등록'/'연결'). */
  cta?: string;
}

/** 공개범위로 마스킹된 가맹점 라벨(서버 analytics가 이 문자열로 접는다). */
const MASKED_MERCHANT = "(비공개)";

/** 예산 스코프 → 한국어 보조 라벨(UsageBar meta). */
const SCOPE_LABEL: Record<BudgetScopeType, string> = {
  household: "가족 전체",
  member: "구성원",
  category: "카테고리",
  card: "카드",
  card_group: "여러 카드 합산",
};

// --- 페이지 -----------------------------------------------------------------

/**
 * `useSearchParams`는 Suspense 경계를 요구한다(정적 export 포함) — 홈 화면의
 * 달·필터는 URL이 소유하므로 여기서 경계를 친다. `/login`·`/join`·`/register`가
 * 쓰던 것과 같은 형태로 맞춰, 어떤 화면은 감싸고 어떤 화면은 아닌 상태를 없앤다.
 */
export default function LedgerAnalysisPage() {
  return (
    <Suspense fallback={null}>
      <LedgerAnalysisView />
    </Suspense>
  );
}

function LedgerAnalysisView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const thisMonth = currentMonth();
  // 보고 있는 달은 URL(`?month=YYYY-MM`)이 소유한다 — 새로고침·공유·알림 딥링크가
  // 같은 화면을 재현해야 하고, 뒤로가기가 달 이동을 되돌리는 것이 자연스럽다.
  // 무효한 값(수동 편집·오래된 링크)은 조용히 이번 달로 되돌린다.
  const monthParam = searchParams.get("month");
  const month = monthParam && isMonthKey(monthParam) ? monthParam : thisMonth;
  const isCurrentMonth = month === thisMonth;

  const { activeMembership } = useHousehold();
  const canCreateBudget =
    month >= thisMonth &&
    (activeMembership?.role === "owner" || activeMembership?.role === "admin");

  // 이번 달이면 쿼리스트링을 없애 링크를 짧게 유지한다(기본 상태 = 파라미터 없음).
  // replace: 달을 5번 넘겼다고 뒤로가기를 5번 눌러야 하면 안 된다.
  const changeMonth = useCallback(
    (next: string) => {
      router.replace(
        next === thisMonth
          ? "/ledger/analysis"
          : `/ledger/analysis?month=${encodeURIComponent(next)}`,
        { scroll: false }
      );
    },
    [router, thisMonth]
  );

  // 실시간 카드문자가 파싱돼 들어오면 화면에 자동 반영되도록, 문자 유입에 민감한
  // 쿼리는 폴링한다(포커스 상태에서만 — TanStack 기본이 백그라운드 폴링 정지).
  const poll = { refetchInterval: REALTIME_POLL_MS };

  // 이번 달 집계.
  const monthlyQuery = useMonthly(month, poll);
  const membersQuery = useMembers(month);
  // 구성원이 직접 고른 색(memberId → 팔레트 키). 없으면 해시 색 폴백.
  const householdMembersQuery = useHouseholdMembers();
  // 공용 카드 결제의 표시 색(가구 설정). null이면 중립 회색.
  const sharedColor = useHouseholdSummary().data?.sharedColor ?? null;

  const memberColorById = useMemo(() => {
    const map = new Map<string, MemberColor | null>();
    for (const m of householdMembersQuery.data ?? [])
      map.set(m.memberId, m.color);
    return map;
  }, [householdMembersQuery.data]);
  // 전 구성원 이름(카드 소유자가 이달 지출이 없어 analytics.members에 없을 수 있어 폴백).
  const householdNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of householdMembersQuery.data ?? [])
      map.set(m.memberId, m.name);
    return map;
  }, [householdMembersQuery.data]);
  // 카드 소유자 매핑: 거래 색/이름은 "카드 소유자" 기준으로 표시한다(문자를 대신
  // 전달한 사람이 아니라 카드 주인이 누구 지출인지를 나타냄 — 카드 화면과 동일 색).
  const cardListQuery = useCardList();
  const cardOwnerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cardListQuery.data ?? []) map.set(c.id, c.ownerMemberId);
    return map;
  }, [cardListQuery.data]);
  // 공용으로 표시한 카드 — 최근 거래의 귀속 판정에 쓴다(거래 목록과 같은 규칙).
  const sharedCardIds = useMemo(
    () => sharedCardIdSet(cardListQuery.data ?? []),
    [cardListQuery.data]
  );
  const cardsQuery = useCards(month);
  const categoriesQuery = useCategories(month);
  const budgetsQuery = useBudgets(month);
  const merchantsQuery = useMerchants(month);
  // 거래가 있는 달 목록 — 스위처가 빈 달을 건너뛰는 데 쓴다.
  const monthsQuery = useAnalyticsMonths();
  const availableMonths = useMemo(
    () => monthsQuery.data?.items.map((i) => i.month),
    [monthsQuery.data]
  );

  // 최근 거래 10건(기간 무관, 최신순).
  const recentQuery = useTransactions({ limit: 10 }, poll);

  // --- 파생 데이터 ----------------------------------------------------------

  // 집계 행 → 거래 목록 딥링크(C-7). 축 값이 없는 행(미분류/미연결/마스킹)은
  // 링크를 걸지 않는다 — 필터가 안 걸린 전체 목록으로 보내면 사용자는 자기가
  // 누른 행과 무관한 화면을 보게 된다.
  const memberItems = useMemo<BarListItem[]>(
    () =>
      (membersQuery.data?.items ?? []).slice(0, BREAKDOWN_TOP_N).map((m) => ({
        // memberId가 null이면 '공용' 버킷이다(공용 표시한 카드의 결제). 사람이 아니라
        // 귀속을 보류한 묶음이라 `memberId` 필터로는 그 집합을 만들 수 없다 — 그래서
        // 오랫동안 링크가 없었다. 서버에 `attribution=shared` 필터가 생겨 이제 같은
        // 규칙(`payment_cards.is_shared`)으로 목록을 다시 만들 수 있다.
        key: m.memberId ?? "__shared__",
        label: m.name,
        value: m.net,
        ratio: m.ratio,
        meta: `${m.count}건`,
        href:
          m.memberId === null
            ? transactionsHref({ month, attribution: "shared" })
            : transactionsHref({ month, memberId: m.memberId }),
      })),
    [membersQuery.data, month]
  );

  const cardItems = useMemo<BarListItem[]>(
    () =>
      (cardsQuery.data?.items ?? []).slice(0, BREAKDOWN_TOP_N).map((c) => ({
        key: c.cardId ?? "unlinked",
        label: c.issuer ? `${c.alias} · ${c.issuer}` : c.alias,
        value: c.net,
        ratio: c.ratio,
        meta: `${c.count}건`,
        ...(c.cardId
          ? { href: transactionsHref({ month, cardId: c.cardId }) }
          : {}),
      })),
    [cardsQuery.data, month]
  );

  const categoryItems = useMemo<BarListItem[]>(
    () =>
      (categoriesQuery.data?.items ?? [])
        .slice(0, BREAKDOWN_TOP_N)
        .map((c) => ({
          key: c.categoryId ?? "uncategorized",
          label: c.categoryName,
          value: c.net,
          ratio: c.ratio,
          meta: `${c.count}건`,
          ...(c.categoryId
            ? { href: transactionsHref({ month, categoryId: c.categoryId }) }
            : {}),
        })),
    [categoriesQuery.data, month]
  );

  // 가맹점 상위 — 서버가 이미 net 내림차순 top 20을 주므로 앞에서 잘라 쓴다.
  // 거래 화면에 가맹점 필터는 없고 검색(`q`)이 그 역할을 한다. 공개범위로
  // 마스킹된 '(비공개)' 행은 검색해도 남의 거래가 나오지 않으므로 링크를 뺀다.
  const merchantItems = useMemo<BarListItem[]>(
    () =>
      (merchantsQuery.data?.items ?? []).slice(0, BREAKDOWN_TOP_N).map((m) => ({
        key: m.merchant,
        label: m.merchant,
        value: m.net,
        ratio: m.ratio,
        meta: `${m.count}건`,
        ...(m.merchant === MASKED_MERCHANT
          ? {}
          : { href: transactionsHref({ month, q: m.merchant }) }),
      })),
    [merchantsQuery.data, month]
  );

  // 상위 사용률 예산(사용률 내림차순).
  const topBudgets = useMemo(
    () =>
      [...(budgetsQuery.data?.items ?? [])]
        .sort((a, b) => b.usageRate - a.usageRate)
        .slice(0, BUDGET_TOP_N),
    [budgetsQuery.data]
  );

  // 최근 거래 리스트의 구성원명 매핑(analytics.members 결과 재활용).
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    // '공용'(memberId null)은 사람 이름 매핑에 넣지 않는다 — 이 맵은 거래 행의
    // memberId로 이름을 찾는 용도이고, 거래의 member_id는 언제나 실제 구성원이다.
    for (const m of membersQuery.data?.items ?? []) {
      if (m.memberId !== null) map.set(m.memberId, m.name);
    }
    return map;
  }, [membersQuery.data]);

  // 카테고리 아이콘 선택용 id→이름 맵(거래 목록과 동일한 카테고리 목록 사용).
  const categoryListQuery = useCategoryList();
  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categoryListQuery.data ?? []) map.set(c.id, c.name);
    return map;
  }, [categoryListQuery.data]);

  const recentRows = recentQuery.data?.items ?? [];

  // --- 온보딩 체크리스트(C-1) ------------------------------------------------
  // 합류 직후 홈은 빈 카드 6장이라 다음 행동이 없었다. 거래가 아직 하나도 없고
  // 3단계를 다 끝내지 않았으면 빈 카드 대신 체크리스트를 보여준다.
  //
  // 완료 판정은 **이미 로딩 중인 쿼리로만** 계산한다(새 백엔드 없음):
  //  1) 가족 만들기 — 이 화면이 렌더된다는 것 자체가 활성 가족이 있다는 뜻이다.
  //  2) 카드 등록  — useCardList
  //  3) 휴대폰 연결 — useDevices
  // 3/3이 되면 조건이 깨져 체크리스트가 사라지고 평소 홈으로 돌아간다.
  const devicesQuery = useDevices();
  const [addTxnOpen, setAddTxnOpen] = useState(false);
  /**
   * 인사이트를 연 달. 불리언이 아니라 달을 담는다 — 켜 둔 채로 달을 옮기면(화살표든
   * 브라우저 뒤로가기든) 넘기는 달마다 모델 호출이 하나씩 붙는다. 사용자가 누른
   * 그 달에서만 열어 둔다.
   */
  const [insightsMonth, setInsightsMonth] = useState<string | null>(null);

  const checklistSteps = useMemo<ChecklistStep[]>(
    () => [
      {
        key: "household",
        title: "가족 만들기",
        description: activeMembership
          ? `'${activeMembership.name}' 가족을 만들었어요`
          : "가족을 만들었어요",
        done: true,
      },
      {
        key: "card",
        title: "결제 카드 등록하기",
        description: "뒤 4자리를 넣으면 문자가 자동으로 연결돼요",
        done: (cardListQuery.data ?? []).length > 0,
        href: "/cards",
        cta: "등록",
      },
      {
        key: "device",
        title: "휴대폰 연결하기",
        description: "카드 문자를 자동으로 모아와요",
        done: (devicesQuery.data ?? []).length > 0,
        href: "/devices",
        cta: "연결",
      },
    ],
    [activeMembership, cardListQuery.data, devicesQuery.data]
  );
  const checklistDone = checklistSteps.filter((s) => s.done).length;
  // 참조 쿼리가 아직 안 왔을 때 체크리스트를 먼저 그리면, 이미 설정을 끝낸
  // 사용자에게 "카드를 등록하세요"가 한 번 깜빡인다 → 로딩 중에는 판단을 미룬다.
  // 실패한 쿼리도 같다 — 못 읽은 것을 '없음'으로 읽으면 없는 할 일을 만들어 낸다
  // (권한이 좁은 구성원은 장치 목록에서 403을 받을 수 있다).
  const setupLoaded =
    cardListQuery.isSuccess && devicesQuery.isSuccess && recentQuery.isSuccess;
  const showChecklist =
    setupLoaded &&
    checklistDone < checklistSteps.length &&
    (recentQuery.data?.items.length ?? 0) === 0;

  const monthly = monthlyQuery.data;

  /**
   * 총액에서 빠진 것들의 공시 문구. 0인 버킷은 줄을 만들지 않는다 —
   * "0건 제외했어요"는 정보가 아니라 소음이다.
   */
  const excludedNotes = useMemo(() => {
    if (!monthly) return [];
    const { excludedManual, excludedTransfer } = monthly.meta;
    const notes: { key: string; text: string }[] = [];
    if (excludedManual.count > 0) {
      notes.push({
        key: "manual",
        // 금액을 함께 말한다. 건수만으로는 "18.6%가 빠졌다"를 알 수 없다.
        text: `직접 빼놓은 ${excludedManual.count}건 ${formatWon(
          excludedManual.net
        )}은 합계에 넣지 않았어요.`,
      });
    }
    if (excludedTransfer.count > 0) {
      notes.push({
        key: "transfer",
        text: `자산 이동 ${excludedTransfer.count}건 ${formatWon(
          excludedTransfer.net
        )}은 쓴 돈이 아니라 옮긴 돈이라 빼놨어요.`,
      });
    }
    return notes;
  }, [monthly]);

  // 비교 대상 호칭: 이번 달이면 '지난달', 과거월이면 그 달의 직전 달을 명시한다.
  const prevLabel = isCurrentMonth
    ? "지난달"
    : formatMonth(addMonths(month, -1));
  const delta = monthly
    ? deltaSentence(
        monthly.deltaNet,
        monthly.deltaRate,
        monthly.previousNet,
        prevLabel
      )
    : null;

  // --- 렌더 -----------------------------------------------------------------

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6">
      <header className="space-y-1.5">
        <h1 className="text-[28px] font-bold tracking-tight">소비 분석</h1>
        <p className="text-muted-foreground text-sm">
          카드 승인·취소 기록을 기존 공개 범위에 따라 살펴봐요.
        </p>
      </header>
      <LedgerNav active="analysis" month={month} />

      {/* 거래가 한 건도 없으면 달을 옮길 이유가 없다 — 체크리스트 화면에서는 감춘다. */}
      {showChecklist ? null : (
        <div className="flex min-w-0 items-center justify-start">
          <MonthSwitcher
            month={month}
            months={availableMonths}
            onChange={changeMonth}
            className="-ml-2 [&>button]:size-11 [&>span]:text-2xl [&>span]:font-bold [&>span]:tracking-tight"
          />
        </div>
      )}

      {/* 온보딩 체크리스트 — 아직 거래가 없고 3단계를 다 못 끝낸 새 가족에게만.
          아래 집계 카드들은 전부 빈 상태가 되므로 그 자리를 이걸로 대신한다. */}
      {showChecklist ? (
        <OnboardingChecklist
          steps={checklistSteps}
          doneCount={checklistDone}
          onPasteSms={() => setAddTxnOpen(true)}
        />
      ) : null}

      {showChecklist ? null : (
        <>
          {/* 히어로 — 이번 달 소비 */}
          <Card className="finance-panel">
            <CardContent className="flex flex-col gap-4">
              {monthlyQuery.isLoading || monthlyQuery.isError ? (
                <StateNote
                  loading={monthlyQuery.isLoading}
                  error={monthlyQuery.error}
                />
              ) : monthly && delta ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-sm">
                      {isCurrentMonth
                        ? "이번 달 소비"
                        : `${formatMonth(month)} 소비`}
                    </span>
                    <span className="text-[clamp(1.75rem,7vw,2.5rem)] font-bold tracking-tight tabular-nums [overflow-wrap:anywhere]">
                      {formatWon(monthly.totalNet)}
                    </span>
                    <p className={cn("text-sm font-medium", delta.className)}>
                      {delta.text}
                    </p>
                    {monthly.previousNet !== 0 ? (
                      <p className="text-muted-foreground text-xs">
                        {prevLabel}에는 {formatWon(monthly.previousNet)} 썼어요
                      </p>
                    ) : null}
                  </div>

                  <dl className="bg-muted/70 grid min-w-0 grid-cols-3 divide-x divide-border/60 rounded-2xl py-4 text-center">
                    <div className="flex min-w-0 flex-col gap-1.5 px-2">
                      <dt className="text-muted-foreground text-xs">승인</dt>
                      <dd className="text-[13px] font-semibold tabular-nums [overflow-wrap:anywhere]">
                        {formatWon(monthly.totalApproved)}
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5 px-2">
                      <dt className="text-muted-foreground text-xs">취소</dt>
                      <dd className="text-[13px] font-semibold tabular-nums [overflow-wrap:anywhere]">
                        {formatWon(monthly.totalCancelled)}
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5 px-2">
                      <dt className="text-muted-foreground text-xs">거래</dt>
                      <dd className="text-[13px] font-semibold tabular-nums [overflow-wrap:anywhere]">
                        {monthly.transactionCount.toLocaleString("ko-KR")}건
                      </dd>
                    </div>
                  </dl>

                  {/* 직접 제외·자산 이동만 공시한다. 비공개 거래의 존재·건수는 표시하지 않는다. */}
                  <p className="text-muted-foreground text-xs">
                    카드 공개 정책으로 열람할 수 있는 기록만 집계해요.
                  </p>
                  {excludedNotes.length > 0 ? (
                    <div className="text-muted-foreground space-y-1 text-xs">
                      {excludedNotes.map((note) => (
                        <p key={note.key}>{note.text}</p>
                      ))}
                      {monthly.meta.excludedManual.count > 0 ? (
                        <Link
                          href={`/transactions?month=${month}&excluded=only`}
                          className="text-primary inline-block underline-offset-2 hover:underline"
                        >
                          빼놓은 거래 보기
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </CardContent>
          </Card>

          {/*
           * 앞으로 나갈 돈 (금액 레이어 S2). 히어로가 "얼마 썼나"를 말한 직후에 "얼마 더
           * 나가나"를 답한다 — 순서를 바꾸면 아직 안 쓴 돈이 쓴 돈보다 먼저 읽힌다.
           * 예정 0건·과거 달·Radar 꺼짐이면 컴포넌트가 스스로 사라진다.
           */}
          <UpcomingSpendCard
            isCurrentMonth={isCurrentMonth}
            monthlyNet={monthly?.totalNet ?? null}
          />

          {/* 화면을 열 때 별도 모델 호출을 만들지 않는다 — 그래서 인사이트는 버튼으로만
          연다. 누르기 전에는 마운트되지 않으므로 요청도 나가지 않는다. */}
          {insightsMonth === month ? (
            <MonthlyInsightsCard month={month} />
          ) : (
            <Button
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => setInsightsMonth(month)}
            >
              <Sparkles className="size-4" aria-hidden="true" />이 달의 특징
              보기
            </Button>
          )}
        </>
      )}

      {showChecklist ? null : (
        <>
          {/* 카테고리별 지출 */}
          <Card className="finance-panel">
            <CardHeader>
              <CardTitle>어디에 많이 썼나요?</CardTitle>
              <CardDescription>
                {isCurrentMonth ? "이번 달" : formatMonth(month)} 카테고리별
                지출이에요
              </CardDescription>
            </CardHeader>
            <CardContent>
              {categoriesQuery.isLoading || categoriesQuery.isError ? (
                <StateNote
                  loading={categoriesQuery.isLoading}
                  error={categoriesQuery.error}
                />
              ) : (
                <BarList
                  items={categoryItems}
                  formatValue={formatWon}
                  emptyLabel="아직 지출 내역이 없어요"
                />
              )}
            </CardContent>
          </Card>

          {/* 예산 요약 */}
          <Card className="finance-panel">
            <CardHeader>
              <CardTitle>
                {isCurrentMonth ? "이번 달 예산" : `${formatMonth(month)} 예산`}
              </CardTitle>
              <CardDescription>
                {isCurrentMonth
                  ? "사용률이 높은 예산부터 보여드려요"
                  : "그 달의 예산 달성률이에요"}
              </CardDescription>
              <CardAction>
                <SeeAllLink
                  href={`/budgets?month=${encodeURIComponent(month)}`}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              {budgetsQuery.isLoading || budgetsQuery.isError ? (
                <StateNote
                  loading={budgetsQuery.isLoading}
                  error={budgetsQuery.error}
                />
              ) : topBudgets.length === 0 ? (
                <EmptyState
                  emoji="🎯"
                  title="아직 예산이 없어요"
                  description={
                    canCreateBudget
                      ? "예산을 만들면 선택한 달의 사용률을 확인할 수 있어요"
                      : "선택한 달에 등록된 예산이 없어요"
                  }
                  action={
                    <Button asChild variant="tint" className="w-full">
                      <Link
                        href={`/budgets?month=${encodeURIComponent(month)}`}
                      >
                        {canCreateBudget ? "예산 만들기" : "예산 확인하기"}
                      </Link>
                    </Button>
                  }
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {topBudgets.map((b) => {
                    // 이름이 있으면 대상까지("구성원 · 홍길동") 표시 — 어떤 구성원 예산인지
                    // 대시보드에서도 바로 보이게(/budgets 전체보기와 동일). 이름이 없으면
                    // label에 이미 scopeLabel이 나오므로 meta는 스코프 타입만.
                    const scope =
                      b.name && b.scopeType !== "card_group"
                        ? `${SCOPE_LABEL[b.scopeType]} · ${b.scopeLabel}`
                        : SCOPE_LABEL[b.scopeType];
                    const href =
                      b.scopeType === "card_group"
                        ? `/budgets?month=${encodeURIComponent(month)}`
                        : budgetTransactionsHref(
                            b.scopeType,
                            b.scopeRefId,
                            month
                          );
                    return (
                      <div key={b.id} className="min-w-0 space-y-1">
                        <UsageBar
                          label={
                            b.name ??
                            (b.scopeType === "card_group"
                              ? "카드 묶음 예산"
                              : b.scopeLabel)
                          }
                          {...(href
                            ? { href, hrefLabel: "어디서 썼는지 보기" }
                            : {})}
                          meta={
                            b.usageRate >= 1 ? (
                              <span className="text-destructive font-semibold">
                                {scope} · 예산을 넘었어요
                              </span>
                            ) : (
                              scope
                            )
                          }
                          spent={b.spent}
                          amount={b.amount}
                          currency={b.currency}
                          usageRate={b.usageRate}
                        />
                        {b.scopeType === "card_group" ? (
                          <p className="text-muted-foreground break-words text-[13px]">
                            {b.scopeLabel}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <details className="min-w-0 rounded-2xl border border-border/70 bg-card/70 px-4 py-1">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring">
              세부 분석 · 가맹점, 구성원, 카드, 최근 거래
            </summary>
            <div className="mt-3 flex min-w-0 flex-col gap-5">
              {/* 가맹점별 지출 — 서버 `analytics/merchants`(타 구성원 summary_only는 '(비공개)'로
          마스킹된 상태)를 그대로 표시한다. 이 집계는 이미 있었지만 화면 소비자가
          없었다(ADR-0026). '이번 달 어디서 많이 썼나'는 카테고리보다 구체적이라
          회고에서 먼저 눈에 들어온다. */}
              <Card className="finance-panel">
                <CardHeader>
                  <CardTitle>자주 간 곳은 어디인가요?</CardTitle>
                  <CardDescription>
                    {isCurrentMonth ? "이번 달" : formatMonth(month)} 가맹점별
                    지출 상위예요
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {merchantsQuery.isLoading || merchantsQuery.isError ? (
                    <StateNote
                      loading={merchantsQuery.isLoading}
                      error={merchantsQuery.error}
                    />
                  ) : (
                    <BarList
                      items={merchantItems}
                      formatValue={formatWon}
                      emptyLabel="아직 지출 내역이 없어요"
                    />
                  )}
                </CardContent>
              </Card>

              {/* 구성원 · 카드별 지출 */}
              <Card className="finance-panel">
                <CardHeader>
                  <CardTitle>누가, 어떤 카드로 썼나요?</CardTitle>
                  <CardDescription>
                    구성원과 카드별로 모아봤어요
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <section className="flex flex-col gap-1">
                    <h3 className="text-muted-foreground text-[13px] font-semibold">
                      구성원
                    </h3>
                    {membersQuery.isLoading || membersQuery.isError ? (
                      <StateNote
                        loading={membersQuery.isLoading}
                        error={membersQuery.error}
                      />
                    ) : memberItems.length === 0 ? (
                      <p className="text-muted-foreground py-4 text-center text-[13px]">
                        아직 구성원 지출이 없어요
                      </p>
                    ) : (
                      <div className="-mx-2 flex flex-col">
                        {memberItems.map((item) => (
                          <ListRow
                            key={item.key}
                            {...(item.href ? { href: item.href } : {})}
                            icon={
                              <span className="text-sm font-semibold">
                                {initialOf(item.label)}
                              </span>
                            }
                            iconClassName={
                              // 공용 버킷(`__shared__`)은 사람 팔레트의 해시 색을 쓰면 안 된다 —
                              // 그 키는 memberId가 아니라 자리표시자라 임의의 색이 배정되고,
                              // 거래 화면(회색)과 어긋나 같은 묶음이 두 색으로 보인다.
                              item.key === "__shared__"
                                ? sharedColorClass(sharedColor)
                                : memberColorClass(
                                    item.key,
                                    memberColorById.get(item.key)
                                  )
                            }
                            title={item.label}
                            subtitle={`전체의 ${percent(item.ratio)}`}
                            value={<Money amount={item.value} />}
                            valueSub={item.meta}
                            chevron={item.href != null}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="flex flex-col gap-1">
                    <h3 className="text-muted-foreground text-[13px] font-semibold">
                      카드
                    </h3>
                    {cardsQuery.isLoading || cardsQuery.isError ? (
                      <StateNote
                        loading={cardsQuery.isLoading}
                        error={cardsQuery.error}
                      />
                    ) : cardItems.length === 0 ? (
                      <p className="text-muted-foreground py-4 text-center text-[13px]">
                        아직 카드 지출이 없어요
                      </p>
                    ) : (
                      <div className="-mx-2 flex flex-col">
                        {cardItems.map((item) => {
                          // 카드 아이콘 색 = 그 카드 소유자 색(카드 화면과 동일). item.key=cardId,
                          // 미연결('unlinked')이면 소유자가 없어 기본 색.
                          const ownerId = cardOwnerById.get(item.key);
                          return (
                            <ListRow
                              key={item.key}
                              {...(item.href ? { href: item.href } : {})}
                              icon={<CreditCard />}
                              iconClassName={
                                ownerId
                                  ? memberColorClass(
                                      ownerId,
                                      memberColorById.get(ownerId)
                                    )
                                  : undefined
                              }
                              title={item.label}
                              subtitle={`전체의 ${percent(item.ratio)}`}
                              value={<Money amount={item.value} />}
                              valueSub={item.meta}
                              chevron={item.href != null}
                            />
                          );
                        })}
                      </div>
                    )}
                  </section>
                </CardContent>
              </Card>

              {/* 최근 거래 */}
              <Card className="finance-panel">
                <CardHeader>
                  <CardTitle>최근 거래</CardTitle>
                  <CardDescription>가장 최근에 기록된 거래예요</CardDescription>
                  <CardAction>
                    <SeeAllLink href="/transactions" />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {recentQuery.isLoading || recentQuery.isError ? (
                    <StateNote
                      loading={recentQuery.isLoading}
                      error={recentQuery.error}
                    />
                  ) : recentRows.length === 0 ? (
                    <EmptyState
                      emoji="🧾"
                      title="아직 거래가 없어요"
                      description="카드 문자 수집을 시작하면 거래가 여기에 쌓여요"
                    />
                  ) : (
                    <div className="-mx-2 flex flex-col">
                      {recentRows
                        .slice(0, RECENT_DISPLAY_N)
                        .map((t: TransactionSummary) => {
                          const cancelled =
                            t.transactionType === "cancellation";
                          // 제외(excludedAt)는 status와 직교하는 플래그 — 거래 화면과 동일하게
                          // status 배지보다 우선해 '제외됨'으로 표기하고 금액을 흐리게 처리한다.
                          const excluded = t.excludedAt != null;
                          const signed = cancelled ? -t.amount : t.netAmount;
                          // 색·이름 기준 구성원 — 규칙은 `lib/transaction-attribution`이
                          // 단일 출처다. 종전에는 여기서만 **카드 소유자**를 썼고, 그래서
                          // 공용 카드 결제가 소유자 이름으로 보였다(실측 88건 1,458,011원).
                          // 공용 카드 소유자가 한 명이라 최근 거래 목록이 그 이름으로 덮였다.
                          const attributedId = attributedMemberId(
                            t,
                            sharedCardIds
                          );
                          const who =
                            attributedId === null
                              ? "공용"
                              : householdNameById.get(attributedId) ??
                                memberNameById.get(attributedId);
                          // 카테고리 = 아이콘(모양), 구성원 = 배경색 — 거래 목록과 동일 규칙.
                          const Icon = cancelled
                            ? RotateCcw
                            : categoryIcon(
                                t.categoryId
                                  ? categoryNameById.get(t.categoryId)
                                  : null
                              );
                          return (
                            <ListRow
                              key={t.id}
                              icon={<Icon />}
                              iconClassName={
                                cancelled || excluded
                                  ? "bg-muted text-muted-foreground"
                                  : attributedId === null
                                  ? sharedColorClass(sharedColor)
                                  : memberColorClass(
                                      attributedId,
                                      memberColorById.get(attributedId)
                                    )
                              }
                              title={merchantLabel(t)}
                              subtitle={
                                who
                                  ? `${formatDate(t.approvedAt)} · ${who}`
                                  : formatDate(t.approvedAt)
                              }
                              value={
                                <span
                                  className={cn(
                                    excluded && "line-through opacity-60"
                                  )}
                                >
                                  <Money
                                    amount={signed}
                                    currency={t.currency}
                                    muted={cancelled}
                                  />
                                </span>
                              }
                              valueSub={
                                cancelled ? (
                                  <StatusBadge
                                    status="cancelled"
                                    label="취소"
                                  />
                                ) : excluded ? (
                                  <StatusBadge
                                    status="excluded"
                                    label="제외됨"
                                    tone="neutral"
                                  />
                                ) : (
                                  <StatusBadge status={t.status} />
                                )
                              }
                            />
                          );
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </details>
        </>
      )}

      {/* 체크리스트의 '문자 붙여넣어 거래 추가하기' — 거래 화면과 같은 다이얼로그를
          그대로 재사용한다(장치 연결 전에도 첫 거래를 만들어 볼 수 있게). */}
      <AddTransactionDialog open={addTxnOpen} onOpenChange={setAddTxnOpen} />
    </div>
  );
}

/**
 * 온보딩 체크리스트 (C-1 · 디자인 진단 E-1).
 *
 * 합류 직후 홈이 빈 카드 6장이면 "다음에 뭘 해야 하는지"가 아무 데도 없다.
 * 진행률 + 3단계 + 지금 당장 해볼 수 있는 행동(문자 붙여넣기) 하나를 준다.
 */
function OnboardingChecklist({
  steps,
  doneCount,
  onPasteSms,
}: Readonly<{
  steps: ReadonlyArray<ChecklistStep>;
  doneCount: number;
  onPasteSms: () => void;
}>) {
  const progress = Math.round((doneCount / steps.length) * 100);
  return (
    <Card className="finance-panel">
      <CardHeader>
        <CardTitle>시작하기</CardTitle>
        <CardDescription>
          카드 문자가 자동으로 모이기까지 {steps.length - doneCount}단계
          남았어요
        </CardDescription>
        <CardAction>
          <span className="text-muted-foreground text-[13px] tabular-nums">
            {doneCount} / {steps.length}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          className="bg-muted h-2 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={doneCount}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-label="시작하기 진행률"
        >
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ul className="flex flex-col divide-y">
          {steps.map((step, index) => (
            <li key={step.key} className="flex items-center gap-3 py-3">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                  step.done
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground"
                )}
                aria-hidden="true"
              >
                {step.done ? <Check className="size-4" /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-[15px] font-medium",
                    step.done && "text-muted-foreground"
                  )}
                >
                  {step.title}
                </span>
                <span className="text-muted-foreground text-[13px]">
                  {step.description}
                </span>
              </span>
              {!step.done && step.href && step.cta ? (
                <Button
                  asChild
                  size="sm"
                  variant="tint"
                  className="h-9 shrink-0"
                >
                  <Link href={step.href}>{step.cta}</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-[15px] font-semibold">지금 바로 넣어볼까요?</p>
          <p className="text-muted-foreground text-[13px]">
            받은 카드 문자를 붙여넣으면 거래 한 건을 바로 만들어 볼 수 있어요.
          </p>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="mt-1 h-11 w-full"
            onClick={onPasteSms}
          >
            문자 붙여넣어 거래 추가하기
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- 로컬 헬퍼 --------------------------------------------------------------

/**
 * 순지출 delta → 히어로 해요체 문장.
 * 증가 = text-destructive, 감소 = text-accent-foreground(오늘의집 민트).
 */
function deltaSentence(
  deltaNet: number,
  deltaRate: number | null,
  previousNet: number,
  /**
   * 비교 대상 달의 호칭. 이번 달을 볼 때는 '지난달'이지만, 과거월을 볼 때는
   * '2026년 6월'처럼 실제 달을 쓴다 — 7월 화면에서 '지난달보다'는 6월이 아니라
   * 지금 기준의 지난달로 읽힌다.
   */
  prevLabel: string
): { text: string; className: string } {
  if (previousNet === 0) {
    return {
      text:
        prevLabel === "지난달"
          ? "지난달 기록이 없어요. 이번 달부터 차곡차곡 모아봐요"
          : `${prevLabel} 기록이 없어요`,
      className: "text-muted-foreground",
    };
  }
  if (deltaNet === 0) {
    return {
      text: `${prevLabel}과 똑같이 썼어요`,
      className: "text-muted-foreground",
    };
  }
  const rate = deltaRate != null ? ` (${percent(Math.abs(deltaRate))})` : "";
  if (deltaNet > 0) {
    return {
      text: `${prevLabel}보다 ${formatWon(deltaNet)} 더 썼어요${rate}`,
      className: "text-destructive",
    };
  }
  return {
    text: `${prevLabel}보다 ${formatWon(Math.abs(deltaNet))} 덜 썼어요${rate}`,
    className: "text-accent-foreground",
  };
}

/** 마스킹/미확인을 고려한 가맹점 표시명. */
function merchantLabel(t: TransactionSummary): string {
  if (t.masked) return "(비공개)";
  return t.merchantNormalized ?? t.merchantRaw ?? "미확인 가맹점";
}

/** 구성원 아바타용 첫 글자(라벨이 문자열일 때만). */
function initialOf(label: ReactNode): string {
  return typeof label === "string" && label.length > 0
    ? label.slice(0, 1)
    : "?";
}

/** 섹션 로딩/에러 표기. 둘 다 아니면 아무것도 렌더하지 않는다. */
function StateNote({
  loading,
  error,
}: Readonly<{ loading: boolean; error: unknown }>) {
  if (loading) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        불러오고 있어요…
      </p>
    );
  }
  if (error) {
    const message =
      error instanceof ApiError ? error.message : "데이터를 불러오지 못했어요.";
    return (
      <p className="text-destructive text-sm" role="alert">
        {message}
      </p>
    );
  }
  return null;
}

/** 섹션 우측 "전체 보기" 텍스트 링크(오늘의집 톤). */
function SeeAllLink({
  href,
  label = "전체 보기",
}: Readonly<{ href: string; label?: string }>) {
  return (
    <Link
      href={href}
      className="text-accent-foreground text-[13px] font-medium hover:underline"
    >
      {label}
    </Link>
  );
}
