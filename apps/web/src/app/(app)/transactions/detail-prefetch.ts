/* ---------------------------------------------------------------------------
 * 거래 상세 시트 — 하위 데이터 미리 받기와 열기 전 짧은 기다림(2026-11-06 사용자 지적).
 *
 * "상세 바텀시트를 열 때 데이터가 들어오는 게 살짝 느려서 끊기면서 렌더링된다." 시트는 내용 높이만큼 아래에
 * 붙는다(최대 85%, sheet-layout.ts — 사용자가 고른 모양이라 고정 높이로 바꾸지 않는다). 본문은 목록 행으로
 * 바로 그려지지만 '이 가맹점 최근 결제'·짝 결제 안내·가족에게 물어보기는 시트가 열린 뒤 따로 불러와서,
 * 도착할 때마다 시트 윗변이 위로 튀었다.
 *
 * 1) 줄을 누르려 하면(press-prefetch.ts — 스크롤하려고 댄 손가락은 거른다) 그 거래 시트가 쓸 하위 데이터를 받기
 *    시작한다 — 각 훅과 같은 쿼리 옵션(merchantHistoryQuery·duplicatePairQuery·reviewRequestsQuery)이라 캐시를
 *    그대로 함께 쓰고, 이미 받아 둔 것이 신선하면(staleTime) 요청하지 않는다.
 * 2) 열 때 아직 캐시에 없으면 최대 250ms만 기다렸다가 연다(끝나면 바로). 그래도 늦으면 각 섹션이 같은 높이의
 *    자리를 잡아 둔다(merchant-history.tsx·review-request-action.tsx·page.tsx 결정 블록).
 * ------------------------------------------------------------------------- */
import type { TransactionSummary } from "@family/contracts";
import type { QueryClient } from "@tanstack/react-query";

import { reviewRequestsQuery } from "@/components/review-request-action";
import type { useAuth } from "@/lib/auth-context";
import { transactionDetailKey } from "@/lib/transaction-detail-cache";
import type { detailFallbackReason } from "@/lib/transaction-detail-fallback";
import { merchantSearchTerm } from "@/lib/transaction-display";

import { duplicatePairQuery, duplicatePairWindow } from "./duplicate-pair";
import { merchantHistoryQuery } from "./merchant-history";

/**
 * 열기 전에 하위 데이터를 기다리는 최대 시간. 누른 줄은 그동안 눌린 모양으로 남는다 — 이보다 길면
 * 누른 게 안 먹은 것처럼 느껴진다.
 */
export const DETAIL_OPEN_WAIT_MS = 250;

export type DetailPrefetchContext = Readonly<{
  householdId: string | null;
  authedFetch: ReturnType<typeof useAuth>["authedFetch"];
  /**
   * 물어볼 가족(나 말고 활동 중인 구성원)이 있는가. 없으면 '가족에게 물어보기' 줄이 그려지지 않아
   * 그 요청 목록을 기다릴 까닭이 없다.
   */
  askFamily: boolean;
}>;

/**
 * 상세 시트가 열린 뒤 따로 불러오는 하위 데이터를 받기 시작한다. 이 거래에 쓰이는 것만 부른다 —
 * 가맹점 검색어가 있을 때 최근 결제, 중복 의심 승인일 때 짝 결제, 가족 공개 결제일 때 확인 요청.
 *
 * 돌려주는 값: 그중 하나라도 캐시에 아직 없으면 모두 받았을 때(실패 포함) 풀리는 Promise, 다 있으면 null
 * (기다릴 것이 없다 — 오래된 것은 뒤에서 새로 받는다). 같은 요청이 이미 가는 중이면 그 요청을 같이 기다린다.
 */
export function prefetchTransactionDetail(
  queryClient: QueryClient,
  txn: TransactionSummary,
  { householdId, authedFetch, askFamily }: DetailPrefetchContext
): Promise<void> | null {
  if (householdId == null) return null;
  const tasks: Promise<void>[] = [];
  let missing = false;

  const searchTerm = merchantSearchTerm(txn);
  if (searchTerm) {
    const options = merchantHistoryQuery(householdId, searchTerm, authedFetch);
    if (queryClient.getQueryData(options.queryKey) === undefined)
      missing = true;
    tasks.push(queryClient.prefetchQuery(options));
  }

  const range = duplicatePairWindow(txn);
  if (range != null) {
    const options = duplicatePairQuery(householdId, range, authedFetch);
    if (queryClient.getQueryData(options.queryKey) === undefined)
      missing = true;
    tasks.push(queryClient.prefetchQuery(options));
  }

  // ReviewRequestAction과 같은 조건 — 가족 공개이고 비공개 행이 아닐 때만 요청 목록을 쓴다.
  if (askFamily && txn.visibility === "household" && !txn.masked) {
    const options = reviewRequestsQuery(householdId, txn.id, authedFetch);
    if (queryClient.getQueryData(options.queryKey) === undefined)
      missing = true;
    tasks.push(queryClient.prefetchQuery(options));
  }

  return missing ? Promise.all(tasks).then(() => undefined) : null;
}

/**
 * `task`가 끝나거나(성공·실패 모두) `ms`가 지나면 풀린다 — 먼저 오는 쪽. 끝나면 타이머를 지운다.
 * 실패도 끝난 것으로 본다: 시트는 어차피 열어야 하고, 실패한 섹션은 그리지 않는다.
 */
export function settleWithin(
  task: Promise<unknown>,
  ms: number
): Promise<"settled" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  const settled = task.then(
    () => "settled" as const,
    () => "settled" as const
  );
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}

export type DetailOpenGate = Readonly<{
  /**
   * `ready`가 null이면 바로 `run`을 부른다. 아니면 `ready`가 끝나거나 `waitMs`가 지난 뒤 부른다.
   * - 같은 거래를 기다리는 중에 또 누르면 무시한다(두 번 열리지 않게).
   * - 다른 거래를 누르면 앞의 기다림을 버린다(마지막에 누른 것만 연다).
   */
  open: (
    id: string,
    ready: Promise<unknown> | null,
    run: () => void,
    waitMs?: number
  ) => void;
  /** 기다리던 열기를 버린다(화면을 떠날 때). */
  cancel: () => void;
}>;

/**
 * 시트 열기 대기 — 한 번에 하나만 기다린다. `onPendingChange`로 기다리는 거래 id를 알려
 * 누른 줄이 손을 뗀 뒤에도 눌린 모양으로 남게 한다(기다림이 끝나면 null).
 */
export function createDetailOpenGate(
  onPendingChange: (id: string | null) => void
): DetailOpenGate {
  let pending: { id: string; token: object } | null = null;
  const clear = () => {
    if (pending == null) return;
    pending = null;
    onPendingChange(null);
  };
  return {
    open(id, ready, run, waitMs = DETAIL_OPEN_WAIT_MS) {
      if (pending?.id === id) return;
      if (ready == null) {
        clear();
        run();
        return;
      }
      const token = {};
      pending = { id, token };
      onPendingChange(id);
      void settleWithin(ready, waitMs).then(() => {
        if (pending?.token !== token) return;
        clear();
        run();
      });
    },
    cancel: clear,
  };
}

/**
 * 시트 안에서 목록 밖 거래(다른 달의 최근 결제·짝 결제)로 넘어갈 때, 이미 가진 요약을 상세 캐시에 먼저 넣는다.
 * 예전에는 단건 조회가 끝날 때까지 상세가 사라졌다가(목록이 비쳤다가) 다시 올라왔다. 넣은 값은 오래된 것으로
 * 두어(updatedAt 0) 열리자마자 단건 조회로 한 번 확인한다 — 받던 데이터는 예전과 같다. 이미 있으면 건드리지 않는다.
 * 그 확인이 실패하면 무엇을 보일지는 resolveDetailFallback이 정한다.
 */
export function seedTransactionDetail(
  queryClient: QueryClient,
  householdId: string | null,
  txn: TransactionSummary
): void {
  const key = transactionDetailKey(householdId, txn.id);
  if (queryClient.getQueryData(key) !== undefined) return;
  queryClient.setQueryData<TransactionSummary>(key, txn, { updatedAt: 0 });
}

type DetailFallbackFailure = ReturnType<typeof detailFallbackReason>;

/**
 * 목록 밖 거래 상세(단건 조회)로 시트에 무엇을 그리고 얼럿을 띄울지 — 둘 중 하나만 고른다.
 *
 * 단건 조회는 실패해도 캐시에 있던 데이터(seedTransactionDetail로 넣은 요약, 앞서 받은 값)를 지우지 않는다. 그대로
 * 쓰면 그 요약으로 상세 시트가 그려진 위에 '열 수 없는 거래' 얼럿이 겹쳐 떴다(2026-11-06 검토).
 * - 일시적 오류: 가진 요약으로 시트를 그대로 둔다. 연결이 잠깐 끊긴 것으로 멀쩡한 시트를 얼럿으로 덮지 않는다 —
 *   거기서 고른 값의 저장은 실패하면 그 줄이 따로 말한다.
 * - 없음·막힘: 서버가 이 거래를 더는 보여 주지 않는다(삭제·남의 비공개·가족에서 나감). 가진 요약을 버리고 얼럿만
 *   띄운다 — 예전(미리 넣기 전) 흐름과 같다.
 */
export function resolveDetailFallback<T>(
  data: T | undefined,
  failure: DetailFallbackFailure | null
): Readonly<{ txn: T | null; failure: DetailFallbackFailure | null }> {
  if (failure == null) return { txn: data ?? null, failure: null };
  if (failure === "error" && data !== undefined) {
    return { txn: data, failure: null };
  }
  return { txn: null, failure };
}
