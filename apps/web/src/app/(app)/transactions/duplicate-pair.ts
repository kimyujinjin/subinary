/* ---------------------------------------------------------------------------
 * 중복 의심 거래의 '짝 결제' 찾기(2026-11-05 HIG 검수 후속).
 *
 * 예전 상세는 '이 가맹점 최근 결제'(같은 가맹점 최근 30건 중 최신 5건)가 보이기만 하면
 * '아래 최근 결제에 같은 금액이 있는지 보세요'라고 했다. 오래된 중복 의심 거래를 할 일 화면에서
 * 열면 짝 결제가 그 5건 밖에 있어 목록에 없는데도 안내가 나왔고, 같은 금액을 못 찾은 사용자가
 * '정상 결제예요'를 누르면 진짜 중복이 합계에 두 번 잡혔다.
 *
 * 그래서 서버가 duplicate_suspected를 매긴 조건 그대로 짝을 직접 찾는다
 * (apps/worker/src/promotion/transaction-promotion.service.ts `isDuplicateApproval`):
 * - 같은 가구의 승인(approval) 거래
 * - 같은 금액(minor units)·같은 통화
 * - 승인 시각(approvedAt) 차이 5분 이내(양 끝 포함). 승인 시각이 없으면 비교하지 않는다.
 * - 카드가 있으면 같은 카드, 없으면 카드 없는 같은 구성원의 결제
 * - 가맹점(merchantNormalized)이 있으면 같은 가맹점
 * 화면은 여기에 두 가지를 더 거른다: 자기 자신, 비공개(masked) 행(가맹점을 알 수 없고 열 수도 없다).
 * 서버 판정은 공개 범위를 보지 않지만 목록 API는 내가 볼 수 있는 거래만 준다 — 못 보는 짝은
 * 찾지 못한 것으로 두고 비교 안내를 하지 않는다.
 * ------------------------------------------------------------------------- */
import type { TransactionSummary } from "@family/contracts";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { queryKeys } from "@/lib/queries";

/** 서버의 유사 중복 시각 창(`DUPLICATE_TIME_WINDOW_MS`)과 같은 값. */
export const DUPLICATE_PAIR_WINDOW_MS = 5 * 60 * 1000;

/**
 * 창 안의 승인을 한 번에 부를 상한 — 거래 목록 API의 최대 limit.
 * 같은 가족의 승인이 10분 안에 100건을 넘을 일은 없어 다음 쪽은 부르지 않는다.
 */
const DUPLICATE_PAIR_SCAN_LIMIT = 100;

type PairFields = Pick<
  TransactionSummary,
  | "id"
  | "memberId"
  | "cardId"
  | "transactionType"
  | "status"
  | "amount"
  | "currency"
  | "merchantNormalized"
  | "approvedAt"
  | "masked"
  | "excludedAt"
>;

function approvedAtMs(
  txn: Pick<TransactionSummary, "approvedAt">
): number | null {
  if (txn.approvedAt == null) return null;
  const ms = Date.parse(txn.approvedAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 짝을 찾으러 조회할 승인 시각 창. 찾을 필요가 없으면 null — 중복 의심 승인이 아니거나,
 * 이미 합계에서 뺐거나(묻지 않는다), 승인 시각이 없거나(서버도 비교하지 않는다), 비공개 행일 때.
 *
 * 목록 API의 `to`는 미만(`<`)이라 끝 시각을 1ms 늘려 서버 판정의 '이하'를 담는다.
 * 기간 필터는 승인 시각 기준이다(승인 시각이 없는 행만 수신 시각으로 대신한다 — 그런 행은 매칭에서 빠진다).
 */
export function duplicatePairWindow(
  txn: PairFields
): { from: string; to: string } | null {
  if (
    txn.status !== "duplicate_suspected" ||
    txn.transactionType !== "approval" ||
    txn.excludedAt != null ||
    txn.masked
  ) {
    return null;
  }
  const at = approvedAtMs(txn);
  if (at == null) return null;
  return {
    from: new Date(at - DUPLICATE_PAIR_WINDOW_MS).toISOString(),
    to: new Date(at + DUPLICATE_PAIR_WINDOW_MS + 1).toISOString(),
  };
}

/**
 * 서버 판정과 같은 조건으로 짝 결제를 고른다. 여럿이면 시각이 가장 가까운 것, 같으면 먼저 난 것.
 * 없으면 null.
 */
export function findDuplicatePair<T extends PairFields>(
  candidates: readonly T[],
  txn: PairFields
): T | null {
  const at = approvedAtMs(txn);
  if (at == null || txn.masked) return null;
  let best: { item: T; gap: number; ms: number } | null = null;
  for (const item of candidates) {
    if (item.id === txn.id || item.masked) continue;
    if (item.transactionType !== "approval") continue;
    if (item.amount !== txn.amount || item.currency !== txn.currency) continue;
    if (txn.cardId != null) {
      if (item.cardId !== txn.cardId) continue;
    } else if (item.cardId != null || item.memberId !== txn.memberId) {
      continue;
    }
    if (
      txn.merchantNormalized != null &&
      item.merchantNormalized !== txn.merchantNormalized
    ) {
      continue;
    }
    const ms = approvedAtMs(item);
    if (ms == null) continue;
    const gap = Math.abs(ms - at);
    if (gap > DUPLICATE_PAIR_WINDOW_MS) continue;
    if (
      best == null ||
      gap < best.gap ||
      (gap === best.gap &&
        (ms < best.ms || (ms === best.ms && item.id < best.item.id)))
    ) {
      best = { item, gap, ms };
    }
  }
  return best?.item ?? null;
}

/**
 * 중복 의심 승인의 짝 결제. 찾을 필요가 없거나, 불러오는 중·실패·없음이면 null —
 * 상세는 null이면 비교 안내를 하지 않는다(보여 줄 수 없는 결제를 찾게 하지 않는다).
 * 쿼리 키는 `["transactions", …]` 접두라 거래가 바뀌면 함께 무효화된다.
 */
export function useDuplicatePair(
  txn: TransactionSummary
): TransactionSummary | null {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const range = duplicatePairWindow(txn);
  const filters = {
    type: "approval",
    from: range?.from,
    to: range?.to,
    limit: DUPLICATE_PAIR_SCAN_LIMIT,
  };
  const query = useQuery({
    queryKey: queryKeys.transactions(householdId, filters),
    enabled: householdId != null && range != null,
    queryFn: () =>
      authedFetch((token) =>
        api.transactions.list(token, {
          householdId: householdId as string,
          ...filters,
        })
      ),
  });
  if (range == null || !query.isSuccess) return null;
  return findDuplicatePair(query.data.items, txn);
}
