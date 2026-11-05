"use client";
/**
 * 가계부 분석 탭 — 고른 달의 소비(대표 숫자 하나)·앞으로 나갈 돈·카테고리·예산·가맹점·구성원·카드와
 * 첫 설정 흐름(시작하기 체크리스트). 거래 목록은 거래 탭이 맡고, 여기는 그 달 거래로 가는 줄 하나만 둔다.
 * 거래 검토·문자 처리의 전체 목록은 /todo, 판단이 필요한 거래는 /transactions?review=1.
 * 집계는 기존 서버 계약을 그대로 사용하며 이 화면에서 금액을 재합산하지 않는다.
 */
import { Check, CreditCard, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { BudgetScopeType, MemberColor } from "@family/contracts";

import { Button, touchTarget } from "@/components/ui/button";
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
  ErrorState,
  ListLoading,
  ListRow,
  Money,
  MonthNav,
  UsageBar,
  type BarListItem,
} from "@/components/widgets";
import { UpcomingSpendCard } from "../../dashboard/upcoming-card";
import { LedgerHeader } from "@/components/ledger-header";
import { MonthlyInsightsCard } from "@/components/monthly-insights-card";
import { AddTransactionDialog } from "../../transactions/add-transaction-dialog";
import { currentMonth, formatMonth, formatWon, percent } from "@/lib/format";
import { budgetTransactionsHref, transactionsHref } from "@/lib/deep-link";
import { useHousehold } from "@/lib/household-context";
import { memberColorClass, sharedColorClass } from "@/lib/member-color";
import { addMonths, isMonthKey } from "@/lib/month";
import {
  useAnalyticsMonths,
  useBudgets,
  useCardList,
  useCards,
  useCategories,
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
  /** 미완료일 때 버튼 라벨('등록하기'/'연결하기'). */
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
  // 카드 소유자 매핑: 거래 색/이름은 "카드 소유자" 기준으로 표시한다(문자를 대신
  // 전달한 사람이 아니라 카드 주인이 누구 지출인지를 나타냄 — 카드 화면과 동일 색).
  const cardListQuery = useCardList();
  const cardOwnerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cardListQuery.data ?? []) map.set(c.id, c.ownerMemberId);
    return map;
  }, [cardListQuery.data]);
  const cardsQuery = useCards(month);
  const categoriesQuery = useCategories(month);
  const budgetsQuery = useBudgets(month);
  const merchantsQuery = useMerchants(month);
  // 거래가 있는 달 목록 — 달 이동이 빈 달을 건너뛰는 데 쓴다(데이터 범위 규칙이라 바꾸지 않는다).
  const monthsQuery = useAnalyticsMonths();
  const availableMonths = useMemo(
    () => monthsQuery.data?.items.map((i) => i.month),
    [monthsQuery.data]
  );

  // 거래가 하나라도 있는지(기간 무관) — 시작하기 체크리스트를 띄울지만 판단한다. 예전에는 최근 거래 10건을
  // 불러 화면에도 그렸는데, 고른 달과 상관없는 목록이라 10월 분석에 11월 거래가 보였다(2026-11-05 HIG 검수).
  // 거래 탭 빈 상태 판단과 같은 키({ limit: 1 })라 캐시를 함께 쓴다. 첫 문자가 들어오면 체크리스트가
  // 걷히도록 폴링은 남긴다.
  const anyTransactionQuery = useTransactions({ limit: 1 }, poll);

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
        cta: "등록하기",
      },
      {
        key: "device",
        title: "휴대폰 연결하기",
        description: "카드 문자를 자동으로 모아와요",
        done: (devicesQuery.data ?? []).length > 0,
        href: "/devices",
        cta: "연결하기",
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
    cardListQuery.isSuccess &&
    devicesQuery.isSuccess &&
    anyTransactionQuery.isSuccess;
  const showChecklist =
    setupLoaded &&
    checklistDone < checklistSteps.length &&
    (anyTransactionQuery.data?.items.length ?? 0) === 0;

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
        text: `합계 제외 거래 ${excludedManual.count}건 ${formatWon(
          excludedManual.net
        )}은 소비에 넣지 않았어요.`,
      });
    }
    if (excludedTransfer.count > 0) {
      notes.push({
        key: "transfer",
        text: `자산 이동 ${excludedTransfer.count}건 ${formatWon(
          excludedTransfer.net
        )}은 옮긴 돈이라 소비에 넣지 않았어요.`,
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
      <LedgerHeader active="analysis" month={month} />

      {/* 거래가 한 건도 없으면 달을 옮길 이유가 없다 — 체크리스트 화면에서는 감춘다.
          거래 탭과 같은 달 머리(`2026년 11월 ▾` + ‹ ›)다. 고를 수 있는 달은 거래가 있는 달이고,
          이번 달과 보고 있는 달은 목록에 없어도 MonthNav가 넣는다. 전체 기간은 분석에 뜻이 없어 두지 않는다. */}
      {showChecklist ? null : (
        <MonthNav
          month={month}
          months={availableMonths}
          onChange={changeMonth}
        />
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
                <QueryState
                  query={monthlyQuery}
                  message="소비 금액을 불러오지 못했어요"
                />
              ) : monthly && delta ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-muted-foreground">
                      {isCurrentMonth ? "이번 달 소비" : "소비"}
                    </span>
                    <span
                      className={cn(
                        // 홈과 같은 규칙: 숫자 중간에서 줄을 바꾸지 않고, 긴 금액은 한 단계 작은 글자로.
                        formatWon(monthly.totalNet).length > 12 ? "text-title" : "text-display",
                        "min-w-0 whitespace-nowrap tracking-tight tabular-nums"
                      )}
                    >
                      {formatWon(monthly.totalNet)}
                    </span>
                    {/* 이번 달은 끝나지 않아 지난달과 증감을 비교하지 않는다(홈과 같은 규칙·같은 말). */}
                    {isCurrentMonth ? (
                      monthly.previousNet !== 0 ? (
                        <p className="text-caption text-muted-foreground">
                          지난달 {formatWon(monthly.previousNet)}
                        </p>
                      ) : null
                    ) : (
                      <p className={cn("text-body font-medium", delta.className)}>
                        {delta.text}
                      </p>
                    )}
                  </div>

                  {/* 직접 제외·자산 이동만 공시한다. 비공개 거래의 존재·건수는 표시하지 않는다.
                      끝에 붙던 '볼 수 있는 기록만'은 무슨 뜻인지 알기 어려워 뺐다(2026-11-05 HIG 검수). */}
                  <p className="text-caption text-muted-foreground">
                    승인 {formatWon(monthly.totalApproved)} · 취소{" "}
                    {formatWon(monthly.totalCancelled)} ·{" "}
                    {monthly.transactionCount.toLocaleString("ko-KR")}건
                  </p>
                  {excludedNotes.length > 0 ? (
                    <div className="text-caption text-muted-foreground flex flex-col items-start gap-1">
                      {excludedNotes.map((note) => (
                        <p key={note.key}>{note.text}</p>
                      ))}
                      {monthly.meta.excludedManual.count > 0 ? (
                        <Link
                          href={`/transactions?month=${encodeURIComponent(
                            month
                          )}&excluded=only`}
                          className="text-primary inline-flex min-h-11 items-center font-medium underline-offset-2 hover:underline active:opacity-60"
                        >
                          합계 제외 거래 보기
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

          {/* 화면을 열 때 별도 모델 호출을 만들지 않는다 — 그래서 '이 달의 특징'은 버튼으로만
          연다. 누르기 전에는 마운트되지 않으므로 요청도 나가지 않는다. 대표 숫자 아래 보조 행동이라
          전체 폭 버튼이 아니라 텍스트 버튼이다(디자인 문서 §5 분석). 누르면 이 자리가 카드로 바뀐다. */}
          {insightsMonth === month ? (
            <MonthlyInsightsCard month={month} />
          ) : (
            <Button
              type="button"
              variant="link"
              className="-my-2 self-start px-0 has-[>svg]:px-0"
              onClick={() => setInsightsMonth(month)}
            >
              <Sparkles aria-hidden="true" />이 달의 특징 보기
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
            </CardHeader>
            <CardContent>
              {categoriesQuery.isLoading || categoriesQuery.isError ? (
                <QueryState
                  query={categoriesQuery}
                  message="카테고리별 지출을 불러오지 못했어요"
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
              <CardAction>
                <SeeAllLink
                  href={`/budgets?month=${encodeURIComponent(month)}`}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              {budgetsQuery.isLoading || budgetsQuery.isError ? (
                <QueryState
                  query={budgetsQuery}
                  message="예산을 불러오지 못했어요"
                />
              ) : topBudgets.length === 0 ? (
                <EmptyState
                  icon={<Wallet />}
                  title="아직 예산이 없어요"
                  description={
                    canCreateBudget
                      ? "예산을 만들면 선택한 달의 사용률을 확인할 수 있어요"
                      : "선택한 달에 등록된 예산이 없어요"
                  }
                  action={
                    <Button asChild variant="weak" className="w-full">
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
                          // 넘은 금액은 UsageBar가 'N원 초과' 글자로 말한다 — 여기서 한 번 더 말하지 않는다.
                          meta={scope}
                          spent={b.spent}
                          amount={b.amount}
                          currency={b.currency}
                          usageRate={b.usageRate}
                        />
                        {b.scopeType === "card_group" ? (
                          <p className="text-caption text-muted-foreground break-words">
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

          {/*
           * 가맹점·구성원·카드는 접지 않고 순서대로 둔다. 예전에는 브라우저 기본 접기(▶) 안에 카드를 또
           * 넣었고, 고른 달과 상관없는 '최근 거래'가 함께 있어 10월 분석에 11월 거래가 보였다(2026-11-05
           * HIG 검수). 거래 목록은 거래 탭이 맡는다 — 맨 아래에 그 달 거래로 가는 줄 하나만 둔다.
           */}

          {/* 가맹점별 지출 — 서버 `analytics/merchants`(타 구성원 summary_only는 '(비공개)'로
              마스킹된 상태)를 그대로 표시한다(ADR-0026). '이번 달 어디서 많이 썼나'는 카테고리보다
              구체적이라 회고에서 먼저 눈에 들어온다. */}
          <Card className="finance-panel">
            <CardHeader>
              <CardTitle>자주 간 곳은 어디인가요?</CardTitle>
            </CardHeader>
            <CardContent>
              {merchantsQuery.isLoading || merchantsQuery.isError ? (
                <QueryState
                  query={merchantsQuery}
                  message="자주 간 곳을 불러오지 못했어요"
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

          {/* 구성원 · 카드별 지출. 그 사람·카드의 거래 목록으로 가는 줄에만 ›를 단다
              (미연결 카드 묶음은 갈 곳이 없어 표시 없이 둔다). */}
          <Card className="finance-panel">
            <CardHeader>
              <CardTitle>누가, 어떤 카드로 썼나요?</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {membersQuery.isLoading || cardsQuery.isLoading ? (
                // 두 목록을 한 카드에 그리므로 스켈레톤도 하나 — 따로 뜨면 위 목록이 늘며 아래를 민다.
                <ListLoading rows={2} />
              ) : (
                <>
                  <section className="flex flex-col gap-1">
                    <h3 className="text-caption text-muted-foreground font-semibold">
                      구성원
                    </h3>
                    {membersQuery.isError ? (
                      <QueryState
                        query={membersQuery}
                        message="구성원별 지출을 불러오지 못했어요"
                      />
                    ) : memberItems.length === 0 ? (
                      <p className="text-caption text-muted-foreground py-4 text-center">
                        아직 구성원 지출이 없어요
                      </p>
                    ) : (
                      <div className="-mx-2 flex flex-col">
                        {memberItems.map((item) => (
                          <ListRow
                            key={item.key}
                            {...(item.href ? { href: item.href } : {})}
                            icon={
                              <span className="text-body font-semibold">
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
                    <h3 className="text-caption text-muted-foreground font-semibold">
                      카드
                    </h3>
                    {cardsQuery.isError ? (
                      <QueryState
                        query={cardsQuery}
                        message="카드별 지출을 불러오지 못했어요"
                      />
                    ) : cardItems.length === 0 ? (
                      <p className="text-caption text-muted-foreground py-4 text-center">
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
                </>
              )}
            </CardContent>
          </Card>

          {/* 예전 '최근 거래' 자리 — 고른 달의 거래 목록으로 가는 줄. */}
          <div className="finance-panel min-w-0 px-4 py-1">
            <ListRow
              href={transactionsHref({ month })}
              title="이 달 거래 보기"
              chevron
            />
          </div>
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
          <span className="text-caption text-muted-foreground tabular-nums">
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
                  "text-caption flex size-8 shrink-0 items-center justify-center rounded-full font-semibold",
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
                    "text-body font-medium",
                    step.done && "text-muted-foreground"
                  )}
                >
                  {step.title}
                </span>
                <span className="text-caption text-muted-foreground">
                  {step.description}
                </span>
              </span>
              {!step.done && step.href && step.cta ? (
                // size="sm"은 보이는 높이 36에 누르는 영역 44(touchTarget)다.
                <Button asChild size="sm" variant="weak" className="shrink-0">
                  <Link href={step.href}>{step.cta}</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-body font-semibold">지금 바로 넣어볼까요?</p>
          <p className="text-caption text-muted-foreground">
            받은 카드 문자를 붙여넣으면 거래 한 건을 바로 만들어 볼 수 있어요.
          </p>
          <Button
            type="button"
            variant="weak"
            className="mt-1 w-full"
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

/** 구성원 아바타용 첫 글자(라벨이 문자열일 때만). */
function initialOf(label: ReactNode): string {
  return typeof label === "string" && label.length > 0
    ? label.slice(0, 1)
    : "?";
}

/** 카드 하나의 불러오기 상태 — `useQuery` 결과에서 이 화면이 쓰는 부분만. */
type LoadState = Readonly<{
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}>;

/**
 * 카드 안 불러오기 상태. 로딩은 스켈레톤 하나, 실패는 원인 한 줄과 '다시 불러오기'(ErrorState).
 * 둘 다 아니면 아무것도 그리지 않는다.
 *
 * 예전에는 카드마다 '불러오고 있어요…' 글자가 동시에 떴고, 실패는 서버 문구 한 줄뿐이라 다시 시도할
 * 길이 없었다(2026-11-05 HIG 검수).
 */
function QueryState({
  query,
  message,
}: Readonly<{ query: LoadState; message: string }>) {
  if (query.isLoading) return <ListLoading rows={1} />;
  if (query.isError) {
    return (
      <ErrorState
        message={message}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="py-6"
      />
    );
  }
  return null;
}

/**
 * 카드 머리 오른쪽 '전체 보기' 텍스트 링크(SectionHeader의 행동 글자와 같은 모양).
 * 카드 머리 높이를 늘리지 않도록 보이는 글자는 그대로 두고 누르는 영역만 44px로 넓힌다(touchTarget).
 */
function SeeAllLink({
  href,
  label = "전체 보기",
}: Readonly<{ href: string; label?: string }>) {
  return (
    <Link
      href={href}
      className={cn(
        "text-caption text-muted-foreground hover:text-foreground active:text-foreground inline-flex items-center font-medium",
        touchTarget
      )}
    >
      {label}
    </Link>
  );
}
