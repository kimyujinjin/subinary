"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 자동 분류 규칙 (/more/category-rules)
 *
 * 이 화면이 생긴 이유는 실측이다. 자동분류는 잘 돌고 있었는데(`etc` 10.7%·미분류 2건)
 * 사용자가 **93건(전체의 절반)을 손으로 110번** 고쳤다. 같은 가맹점을 네 번까지 고친
 * 기록도 있었다(쿠팡 4회/3거래).
 *
 * 원인은 규칙이 **미래 거래에만** 적용되기 때문이다. 쿠팡 거래가 이미 3건 쌓인 상태에서
 * 하나를 고치면 규칙은 생기지만 나머지 2건은 그대로라, 나머지도 하나씩 또 고치게 된다.
 * 그 `never retroactive`는 의도된 안전장치였다 — 규칙 하나가 과거를 조용히 재분류하면
 * 지난달 통계가 사용자 모르게 바뀐다. 문제는 그 안전장치에 **대안이 없었다**는 것이다.
 *
 * 그래서 이 화면은 네 가지를 한 곳에서 한다.
 *   1. 규칙이 없는 가맹점의 분류를 정한다(가맹점 분류 검토 — 2026-11-05 카테고리 화면에서
 *      옮겨 왔다). 정하면 **최근 거래 1건과 앞으로의 거래**만 바뀐다. 예전 문구는 "확인
 *      가능한 거래 N건"이라 N건이 다 바뀌는 것처럼 읽혔지만 규칙은 소급하지 않는다 — 그래서
 *      정한 직후에 남은 지난 거래 수를 보여 주고 "지난 N건도 바꾸기"를 따로 묻는다.
 *   2. 무엇이 자동으로 붙는지 보여준다(규칙 목록 — 이전에는 볼 방법이 0개였다).
 *   3. "과거에도 적용"을 **미리보기와 함께** 제안한다(조용히 하지 않는다).
 *   4. 되돌린다(적용 단위 batch + 행별 이전 값).
 *
 * 세 목록(검토할 가맹점·규칙·바꾼 기록)은 못 불러오면 각자 자리에서 원인 한 줄 + '다시 불러오기'
 * (ErrorState)를 보인다 — 예전에는 빨간 글자만 있거나(검토) 아무것도 안 보였다(바꾼 기록).
 * ------------------------------------------------------------------------- */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type {
  CategoryRule,
  CategoryRuleList,
  MerchantLabelCandidate,
  RecategorizeBatch,
  RecategorizeBatchList,
  RecategorizePreview,
  TransactionSummary,
} from "@family/contracts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/components/widgets";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatMonthDay, formatMonthDayTime } from "@/lib/format";
import { useHousehold } from "@/lib/household-context";
import {
  invalidateTransactionScope,
  useCategoryList,
  useConfirmMerchantLabel,
  useMerchantLabelCandidates,
} from "@/lib/queries";
import { transactionDetailKey } from "@/lib/transaction-detail-cache";
import {
  applyRecategorize,
  categoryRulesKey,
  deleteCategoryRule,
  fetchCategoryRules,
  fetchRecategorizeBatches,
  fetchRecategorizePreview,
  recategorizeBatchesKey,
  revertRecategorize,
} from "./rules-api";

/** 소급 적용을 확인할 대상 — 규칙 목록에서도, 방금 정한 가맹점에서도 연다. */
interface RecategorizeTarget {
  merchantPattern: string;
  categoryId: string;
}

/** 방금 분류를 정한 가맹점 — 남은 지난 거래를 바꿀지 따로 묻는다. */
interface ConfirmedMerchant extends RecategorizeTarget {
  categoryName: string;
}

const previewKey = (householdId: string | null, target: RecategorizeTarget | null) =>
  [
    "recategorize-preview",
    householdId,
    target?.merchantPattern ?? "",
    target?.categoryId ?? "",
  ] as const;

/** 서버가 준 한국어 문구(`ApiError.message`)를 그대로 띄운다 — 실패 이유가 거기 있다. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** `YYYY-MM` → "8월". 연도는 올해가 아닐 때만 붙인다. */
function formatMonthLabel(month: string): string {
  const [year, mm] = month.split("-");
  const thisYear = String(new Date().getFullYear());
  return year === thisYear ? `${Number(mm)}월` : `${year}년 ${Number(mm)}월`;
}

export default function CategoryRulesPage() {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const queryClient = useQueryClient();

  /** 소급 적용을 확인 중인 대상. null이면 다이얼로그가 닫혀 있다. */
  const [target, setTarget] = useState<RecategorizeTarget | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<CategoryRule | null>(null);
  const [batchToRevert, setBatchToRevert] = useState<RecategorizeBatch | null>(null);

  const rulesQuery = useQuery<CategoryRuleList>({
    queryKey: categoryRulesKey(householdId),
    enabled: householdId != null,
    queryFn: () =>
      authedFetch((token) => fetchCategoryRules(token, householdId as string)),
  });

  const batchesQuery = useQuery<RecategorizeBatchList>({
    queryKey: recategorizeBatchesKey(householdId),
    enabled: householdId != null,
    queryFn: () =>
      authedFetch((token) =>
        fetchRecategorizeBatches(token, householdId as string),
      ),
  });

  /**
   * 미리보기는 다이얼로그가 열린 동안만 가져온다. 목록의 `staleTransactionCount`와 같은
   * 함수가 세지만, 여기서는 **금액·기간·영향 받는 달**까지 보여줘야 하므로 따로 묻는다.
   */
  const previewQuery = useQuery<RecategorizePreview>({
    queryKey: previewKey(householdId, target),
    enabled: householdId != null && target != null,
    queryFn: () =>
      authedFetch((token) =>
        fetchRecategorizePreview(
          token,
          householdId as string,
          target!.merchantPattern,
          target!.categoryId,
        ),
      ),
  });

  const invalidateRules = () =>
    queryClient.invalidateQueries({ queryKey: categoryRulesKey(householdId) });

  /** 분류가 바뀌면 거래·집계·예산·이력·미리보기가 모두 달라진다. */
  const invalidateAll = async () => {
    invalidateTransactionScope(queryClient);
    await invalidateRules();
  };

  /* ---- 가맹점 분류 검토 ---- */
  const categoriesQuery = useCategoryList();
  const labelCandidatesQuery = useMerchantLabelCandidates();
  const confirmLabel = useConfirmMerchantLabel();
  const categories = categoriesQuery.data ?? [];
  const categoryName = (id: string | null | undefined): string | null =>
    id ? (categories.find((c) => c.id === id)?.name ?? null) : null;

  const [selectedLabels, setSelectedLabels] = useState<Record<string, string>>({});
  const [deferredIds, setDeferredIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedMerchant | null>(null);

  const labelCandidates = labelCandidatesQuery.data?.items ?? [];
  const reviewQueue = labelCandidates.filter(
    (candidate) => !deferredIds.includes(candidate.representativeTransactionId),
  );
  const activeCandidate = reviewQueue[0] ?? null;
  const deferredInBatch = labelCandidates.length - reviewQueue.length;
  const hasMoreCandidates = labelCandidatesQuery.data?.hasMore ?? false;

  /**
   * 대표 거래(가장 최근)의 지금 분류. 규칙 없이 키워드로 분류된 가맹점도 후보에 오는데,
   * 후보 응답에는 그 분류가 없어 예전 화면은 "미분류"와 빈 선택칸을 보여 줬다.
   * 거래 상세와 같은 캐시 키를 써서 한 건만 읽는다.
   */
  const currentTxnQuery = useQuery<TransactionSummary>({
    queryKey: transactionDetailKey(
      householdId,
      activeCandidate?.representativeTransactionId ?? null,
    ),
    enabled: householdId != null && activeCandidate != null,
    retry: false,
    queryFn: () =>
      authedFetch((token) =>
        api.transactions.get(
          token,
          activeCandidate!.representativeTransactionId,
        ),
      ),
  });
  const currentCategoryId =
    currentTxnQuery.data?.id === activeCandidate?.representativeTransactionId
      ? (currentTxnQuery.data?.categoryId ?? null)
      : null;

  function selectedCategory(candidate: MerchantLabelCandidate): string {
    return (
      selectedLabels[candidate.representativeTransactionId] ??
      candidate.suggestedCategoryId ??
      currentCategoryId ??
      ""
    );
  }

  /** 방금 정한 가맹점에 남은 지난 거래 — 미리보기와 같은 정의로 센다. */
  const confirmedPreviewQuery = useQuery<RecategorizePreview>({
    queryKey: previewKey(householdId, confirmed),
    enabled: householdId != null && confirmed != null,
    queryFn: () =>
      authedFetch((token) =>
        fetchRecategorizePreview(
          token,
          householdId as string,
          confirmed!.merchantPattern,
          confirmed!.categoryId,
        ),
      ),
  });
  const confirmedRemaining = confirmedPreviewQuery.data?.count ?? null;

  async function onConfirmLabel(candidate: MerchantLabelCandidate) {
    const categoryId = selectedCategory(candidate);
    if (!categoryId || confirmLabel.isPending) return;
    try {
      // 대표 거래 1건을 바꾸고 이 가맹점 규칙을 만든다 — 지난 거래는 바꾸지 않는다.
      await confirmLabel.mutateAsync({
        transactionId: candidate.representativeTransactionId,
        categoryId,
      });
      setSelectedLabels((current) => {
        const next = { ...current };
        delete next[candidate.representativeTransactionId];
        return next;
      });
      setConfirmed({
        merchantPattern: candidate.merchantNormalized,
        categoryId,
        categoryName: categoryName(categoryId) ?? "고른 카테고리",
      });
      void invalidateRules();
    } catch (err) {
      toast.error(errorMessage(err, "분류를 정하지 못했어요."));
    }
  }

  /* ---- 소급 적용 · 되돌리기 · 규칙 지우기 ---- */
  const apply = useMutation({
    mutationFn: (input: { merchant: string; categoryId: string; expectedCount: number }) =>
      authedFetch((token) =>
        applyRecategorize(token, { householdId: householdId as string, ...input }),
      ),
    onSuccess: async (result, input) => {
      setTarget(null);
      if (
        confirmed &&
        confirmed.merchantPattern === input.merchant &&
        confirmed.categoryId === input.categoryId
      ) {
        setConfirmed(null);
      }
      await invalidateAll();
      // 서버가 센 숫자를 그대로 보여준다 — 클라이언트가 계산한 건수와 갈리면
      // 사용자가 틀린 숫자를 믿게 된다.
      toast.success(`지난 거래 ${result.appliedCount}건을 바꿨어요.`, {
        description: "아래 바꾼 기록에서 되돌릴 수 있어요.",
      });
    },
    onError: (error) => {
      // 409 = 미리보기 뒤에 거래가 바뀌었다. 같은 숫자로 다시 눌러도 또 거절되므로
      // 새 숫자를 불러와 시트에 보여 주고 다시 확인받는다.
      if (error instanceof ApiError && error.status === 409) {
        toast.error(error.message, { description: "바뀐 숫자를 다시 불러왔어요." });
        void previewQuery.refetch();
        void invalidateRules();
        return;
      }
      toast.error(errorMessage(error, "바꾸지 못했어요. 잠시 후 다시 시도해 주세요."));
    },
  });

  const revert = useMutation({
    mutationFn: (batchId: string) =>
      authedFetch((token) => revertRecategorize(token, batchId)),
    onSuccess: async (result) => {
      setBatchToRevert(null);
      await invalidateAll();
      toast.success(`${result.revertedCount}건을 되돌렸어요.`, {
        description:
          result.skippedCount > 0
            ? `${result.skippedCount}건은 그 뒤에 다시 분류해서 그대로 두었어요.`
            : undefined,
      });
    },
    onError: (error) => {
      setBatchToRevert(null);
      // 403(남이 적용한 기록)·409(이미 되돌림)는 목록이 낡았다는 뜻이다.
      void queryClient.invalidateQueries({ queryKey: recategorizeBatchesKey(householdId) });
      toast.error(errorMessage(error, "되돌리지 못했어요. 잠시 후 다시 시도해 주세요."));
    },
  });

  const removeRule = useMutation({
    mutationFn: (ruleId: string) =>
      authedFetch((token) => deleteCategoryRule(token, ruleId)),
    onSuccess: async () => {
      setRuleToDelete(null);
      await Promise.all([
        invalidateRules(),
        // 규칙이 없어진 가맹점은 다시 분류 검토 대상이 된다.
        queryClient.invalidateQueries({ queryKey: ["merchant-label-candidates"] }),
      ]);
      toast.success("규칙을 지웠어요.", {
        description: "이미 분류된 거래는 그대로예요.",
      });
    },
    // 서버 문구를 그대로 띄운다 — 학습 기록이 참조하는 규칙은 409로 "카테고리를 바꾸는
    // 것으로 대신해 주세요"라고 답하는데, "지우지 못했어요"만 보이면 다시 눌러 보게 된다.
    onError: (error) => {
      setRuleToDelete(null);
      toast.error(errorMessage(error, "규칙을 지우지 못했어요."));
    },
  });

  const rules = rulesQuery.data?.items ?? [];
  const batches = batchesQuery.data?.items ?? [];
  const preview = previewQuery.data;
  const showReview =
    labelCandidatesQuery.isLoading ||
    labelCandidatesQuery.isError ||
    labelCandidates.length > 0 ||
    confirmed !== null;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6">
      <PageBackHeader title="자동 분류 규칙" backHref="/more" />

      {/* ---- 가맹점 분류 검토 ---- */}
      {showReview ? (
        <section className="finance-panel min-w-0 overflow-hidden pt-3 pb-1">
          <SectionHeader
            className="px-5"
            title="가맹점 분류 검토"
            trailing={
              reviewQueue.length > 0 ? (
                <span className="text-caption text-muted-foreground tabular-nums">
                  {reviewQueue.length}곳{hasMoreCandidates ? " 이상" : ""} 남음
                </span>
              ) : undefined
            }
          />
          <p className="text-caption text-muted-foreground px-5">
            정하면 그 가게의 최근 거래와 앞으로의 거래에 이 분류가 붙어요.
          </p>

          {confirmed ? (
            <div className="flex min-w-0 items-center gap-1 px-4">
              <ListRow
                className="flex-1"
                icon={<Check />}
                iconClassName="bg-success/15 text-success-strong"
                title={confirmed.merchantPattern}
                subtitle={
                  confirmedPreviewQuery.isPending
                    ? `${confirmed.categoryName} 분류로 정했어요`
                    : confirmedRemaining !== null && confirmedRemaining > 0
                      ? `${confirmed.categoryName} 분류로 정했어요 · 지난 거래 ${confirmedRemaining}건은 그대로예요`
                      : confirmedRemaining === 0
                        ? `${confirmed.categoryName} 분류로 정했어요 · 지난 거래도 모두 같아요`
                        : `${confirmed.categoryName} 분류로 정했어요 · 지난 거래는 그대로예요`
                }
                value={
                  confirmedRemaining !== null && confirmedRemaining > 0 ? (
                    <Button
                      size="sm"
                      variant="weak"
                      onClick={() =>
                        setTarget({
                          merchantPattern: confirmed.merchantPattern,
                          categoryId: confirmed.categoryId,
                        })
                      }
                    >
                      지난 {confirmedRemaining}건도 바꾸기
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : null}

          {labelCandidatesQuery.isLoading ? (
            <ListLoading rows={1} label="검토할 가맹점을 불러오는 중이에요." className="px-5 py-4" />
          ) : labelCandidatesQuery.isError ? (
            <ErrorState
              align="start"
              className="px-5 py-4"
              message="검토할 가맹점을 불러오지 못했어요"
              retrying={labelCandidatesQuery.isFetching}
              onRetry={() => void labelCandidatesQuery.refetch()}
            />
          ) : activeCandidate === null ? (
            deferredInBatch > 0 ? (
              <div className="flex flex-col items-start gap-3 px-5 py-4">
                <p className="text-body">
                  이번 목록의 {deferredInBatch}곳을 모두 나중으로 미뤘어요.
                </p>
                <Button variant="weak" onClick={() => setDeferredIds([])}>
                  <RotateCcw /> 다시 보기
                </Button>
              </div>
            ) : null
          ) : (
            <div className="flex flex-col gap-3 px-5 pt-3 pb-4">
              <div className="min-w-0">
                <p className="text-body break-all font-semibold">
                  {activeCandidate.merchantNormalized}
                </p>
                <p className="text-caption text-muted-foreground">
                  거래 {activeCandidate.transactionCount}건
                  {currentTxnQuery.isSuccess
                    ? ` · 최근 분류 ${categoryName(currentCategoryId) ?? "미분류"}`
                    : ""}
                </p>
              </div>
              <Select
                value={selectedCategory(activeCandidate)}
                disabled={confirmLabel.isPending}
                onValueChange={(categoryId) =>
                  setSelectedLabels((current) => ({
                    ...current,
                    [activeCandidate.representativeTransactionId]: categoryId,
                  }))
                }
              >
                <SelectTrigger
                  className="w-full data-[size=default]:h-11"
                  aria-label={`${activeCandidate.merchantNormalized} 카테고리`}
                >
                  <SelectValue placeholder="카테고리 고르기" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button
                  variant="weak"
                  className="flex-1"
                  disabled={confirmLabel.isPending}
                  onClick={() =>
                    setDeferredIds((current) =>
                      current.includes(activeCandidate.representativeTransactionId)
                        ? current
                        : [...current, activeCandidate.representativeTransactionId],
                    )
                  }
                >
                  나중에 하기
                </Button>
                {/* 이 화면의 주 행동 — 채움 버튼은 이것 하나다. */}
                <Button
                  className="flex-1"
                  disabled={
                    !selectedCategory(activeCandidate) || confirmLabel.isPending
                  }
                  onClick={() => void onConfirmLabel(activeCandidate)}
                >
                  {confirmLabel.isPending ? <Loader2 className="animate-spin" /> : null}
                  정하기
                </Button>
              </div>
              {hasMoreCandidates ? (
                <p className="text-caption text-muted-foreground">
                  하나씩 정하면 다음 가맹점이 이어서 나와요.
                </p>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {/* ---- 규칙 목록 ---- */}
      <section className="finance-panel min-w-0 overflow-hidden pt-3 pb-1">
        <SectionHeader
          className="px-5"
          title="가맹점 규칙"
          trailing={
            rules.length > 0 ? (
              <span className="text-caption text-muted-foreground tabular-nums">
                {rules.length}개
              </span>
            ) : undefined
          }
        />
        {rulesQuery.isPending ? (
          <ListLoading rows={3} label="자동 분류 규칙을 불러오는 중이에요." className="px-5 pb-4" />
        ) : rulesQuery.isError ? (
          <ErrorState
            message="규칙을 불러오지 못했어요"
            retrying={rulesQuery.isFetching}
            onRetry={() => void rulesQuery.refetch()}
          />
        ) : rules.length === 0 ? (
          <EmptyState
            title="아직 규칙이 없어요"
            description="거래를 열어 카테고리를 바꾼 뒤 ‘앞으로도 이렇게 분류하기’를 누르면 여기에 생겨요."
          />
        ) : (
          <ul className="divide-border/60 divide-y px-4">
            {rules.map((rule) => (
              <li key={rule.id} className="flex min-w-0 items-center gap-1">
                <ListRow
                  className="flex-1"
                  title={rule.merchantPattern}
                  subtitle={
                    <>
                      {rule.categoryName ?? "알 수 없는 카테고리"}
                      {rule.source === "human_confirmed" ? "" : " · 자동으로 정해짐"}
                      {/* 과거에 남은 것이 있을 때만 알린다 — 0건인데 버튼을 띄우면 눌러도
                          아무 일이 없고, 그건 버튼이 거짓말을 하는 것이다. */}
                      {rule.staleTransactionCount > 0 ? (
                        <span className="text-warning-strong">
                          {" "}
                          · 지난 {rule.staleTransactionCount}건은 다른 분류
                        </span>
                      ) : null}
                    </>
                  }
                  value={
                    rule.staleTransactionCount > 0 ? (
                      <Button
                        size="sm"
                        variant="weak"
                        onClick={() =>
                          setTarget({
                            merchantPattern: rule.merchantPattern,
                            categoryId: rule.categoryId,
                          })
                        }
                      >
                        지난 거래도 바꾸기
                      </Button>
                    ) : undefined
                  }
                />
                <OverflowMenu
                  label={`${rule.merchantPattern} 규칙 메뉴`}
                  className="-mr-2 shrink-0"
                  actions={[
                    {
                      label: "규칙 지우기",
                      destructive: true,
                      disabled: removeRule.isPending,
                      onSelect: () => setRuleToDelete(rule),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- 바꾼 기록 · 되돌리기 ---- */}
      {batchesQuery.isError ? (
        <section className="finance-panel min-w-0 overflow-hidden pt-3 pb-1">
          <SectionHeader className="px-5" title="바꾼 기록" />
          {/* 못 불러오면 되돌릴 길이 사라진 것처럼 보인다 — 비워 두지 않고 알린다. */}
          <ErrorState
            align="start"
            className="px-5 pt-1 pb-4"
            message="바꾼 기록을 불러오지 못했어요"
            retrying={batchesQuery.isFetching}
            onRetry={() => void batchesQuery.refetch()}
          />
        </section>
      ) : batches.length > 0 ? (
        <section className="finance-panel min-w-0 overflow-hidden pt-3 pb-1">
          <SectionHeader className="px-5" title="바꾼 기록" />
          <ul className="divide-border/60 divide-y px-4">
            {batches.map((batch) => (
              <li key={batch.id} className="flex min-w-0 items-center gap-1">
                <ListRow
                  className="flex-1"
                  title={`${batch.merchantCanonical} → ${batch.toCategoryName ?? "알 수 없는 카테고리"}`}
                  titleClassName="font-medium"
                  subtitle={`${formatMonthDayTime(batch.appliedAt)} · ${batch.appliedCount}건`}
                  valueSub={
                    batch.revertedAt ? (
                      <StatusChip>
                        {batch.revertedCount === batch.appliedCount
                          ? "되돌림"
                          : `${batch.revertedCount ?? 0}건 되돌림`}
                      </StatusChip>
                    ) : undefined
                  }
                />
                {/* 서버가 권한까지 따져 `revertable`을 준다 — 남이 적용한 기록은 일반
                    구성원이 되돌릴 수 없으므로(403) 메뉴 자체를 두지 않는다. */}
                {batch.revertable ? (
                  <OverflowMenu
                    label={`${batch.merchantCanonical} 기록 메뉴`}
                    className="-mr-2 shrink-0"
                    actions={[
                      {
                        label: "되돌리기",
                        destructive: true,
                        disabled: revert.isPending,
                        onSelect: () => setBatchToRevert(batch),
                      },
                    ]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- 소급 적용 확인 ---- */}
      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>지난 거래도 바꿀까요?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-left">
                {previewQuery.isPending ? (
                  <span>불러오는 중…</span>
                ) : previewQuery.isError || !preview ? (
                  <span>바꿀 거래를 세지 못했어요. 닫았다가 다시 열어 주세요.</span>
                ) : preview.count === 0 ? (
                  <span>바꿀 지난 거래가 없어요. 모두 이미 이 분류예요.</span>
                ) : (
                  <>
                    <span>
                      <strong>{preview.merchantCanonical}</strong>{" "}
                      <strong>{preview.count}건</strong>을{" "}
                      <strong>{preview.toCategoryName}</strong> 분류로 바꿔요
                      {preview.oldestAt
                        ? ` (${formatMonthDay(preview.oldestAt)}부터)`
                        : ""}
                      .
                    </span>
                    <span className="text-muted-foreground">
                      지금 분류: {preview.fromCategoryNames.join(", ")} · 합계{" "}
                      <Money amount={preview.amount} currency="KRW" muted />
                    </span>
                    {preview.months.length > 0 ? (
                      <span className="text-muted-foreground">
                        영향 받는 달:{" "}
                        {preview.months
                          .map(
                            (m) =>
                              `${formatMonthLabel(m.month)} ${m.count}건${
                                m.budgetAffected ? " (예산 영향)" : ""
                              }`,
                          )
                          .join(" · ")}
                      </span>
                    ) : null}
                    {/*
                      자산이동은 지출 합계에서 빠진다. 그 경계를 넘으면 "카테고리만
                      바꾸니 총액은 그대로"가 거짓이 되므로 다른 문장으로 경고한다.
                    */}
                    {preview.transferBoundaryCrossed ? (
                      <span className="text-warning-strong">
                        자산이동 여부가 바뀌어서 그 달 <strong>총지출도 달라져요.</strong>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        카테고리만 바뀌고 총지출은 그대로예요.
                      </span>
                    )}
                    {preview.exceedsLimit ? (
                      <span className="text-destructive">
                        한 번에 {preview.limit}건까지만 바꿀 수 있어요.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        바꾼 뒤 이 화면의 바꾼 기록에서 되돌릴 수 있어요.
                      </span>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !preview ||
                previewQuery.isFetching ||
                preview.count === 0 ||
                preview.exceedsLimit ||
                apply.isPending
              }
              onClick={(event) => {
                event.preventDefault();
                if (!preview || !target) return;
                apply.mutate({
                  merchant: target.merchantPattern,
                  categoryId: target.categoryId,
                  // 사용자가 **본 숫자**를 그대로 보낸다. 서버가 다시 세어 다르면 409다.
                  expectedCount: preview.count,
                });
              }}
            >
              {apply.isPending
                ? "바꾸는 중…"
                : preview && preview.count > 0
                  ? `${preview.count}건 바꾸기`
                  : "바꾸기"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- 규칙 지우기 확인 ---- */}
      <AlertDialog
        open={ruleToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRuleToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              &lsquo;{ruleToDelete?.merchantPattern}&rsquo; 규칙을 지울까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              이미 분류된 거래는 그대로이고, 다음 거래부터는 이 분류가 자동으로 붙지 않아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeRule.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (ruleToDelete) removeRule.mutate(ruleToDelete.id);
              }}
            >
              {removeRule.isPending ? "지우는 중…" : "지우기"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- 되돌리기 확인 ---- */}
      <AlertDialog
        open={batchToRevert !== null}
        onOpenChange={(open) => {
          if (!open) setBatchToRevert(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 변경을 되돌릴까요?</AlertDialogTitle>
            <AlertDialogDescription>
              &lsquo;{batchToRevert?.merchantCanonical}&rsquo; {batchToRevert?.appliedCount}건을
              바꾸기 전 분류로 돌리고, 그 뒤에 다시 고친 거래는 그대로 둬요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revert.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (batchToRevert) revert.mutate(batchToRevert.id);
              }}
            >
              {revert.isPending ? "되돌리는 중…" : "되돌리기"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
