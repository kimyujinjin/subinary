"use client";
/* ---------------------------------------------------------------------------
 * 거래 상세 시트 — "이 가맹점 최근 결제"(2026-11-05).
 *
 * 같은 곳에서 얼마나 자주·얼마씩 썼는지는 시트를 닫고 검색해야만 알 수 있었다. 최근 5건을
 * 보여 주고, 누르면 그 거래 상세로 바로 넘어간다(목록에 없으면 기존 딥링크 폴백이 단건 조회).
 * 넘어간 시트 머리에는 '‹ 이전 거래'가 생겨 한 단계 돌아갈 수 있다(page.tsx, HIG 검수 3·4단계).
 * 보조 정보라 실패·없음에는 아무것도 그리지 않는다.
 *
 * 불러오는 동안에는 섹션 머리와 같은 높이의 회색 막대 줄로 자리를 잡아 둔다(2026-11-06 사용자 지적).
 * 예전에는 null을 그리다가 결과가 오면 머리와 줄 여러 개가 한꺼번에 생겨, 내용만큼 아래에 붙는 시트의 윗변이
 * 위로 튀었다. 0건이면 그때 섹션을 지운다(한 번 줄어드는 것은 둔다).
 * ------------------------------------------------------------------------- */
import type { TransactionSummary } from "@family/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/widgets";
import { SectionHeader } from "@/components/widgets/section-header";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatMonthDayTime } from "@/lib/format";
import { useHousehold } from "@/lib/household-context";
import { queryKeys } from "@/lib/queries";
import {
  sameMerchantHistory,
  transactionOccurredAt,
} from "@/lib/transaction-display";
import { cn } from "@/lib/utils";

import { pressPrefetchHandlers, usePressPrefetch } from "./press-prefetch";

type AuthedFetch = ReturnType<typeof useAuth>["authedFetch"];

/** 같은 가맹점에서 불러 올 최근 결제 수. 검색은 가맹점·메모 부분 일치라 넉넉히 받아 정확히 같은 이름만 남긴다. */
const MERCHANT_HISTORY_SCAN_LIMIT = 30;

/** 시트에 보이는 최근 결제 줄 수. */
export const MERCHANT_HISTORY_ROWS = 5;

/**
 * 불러오는 동안 잡아 둘 줄 수 — 보일 수 있는 최대(5줄)가 아니라 3줄이다. 폰에서 상세는 3줄만 더해도
 * 85% 높이에 닿아 그 뒤로 늘어나는 줄은 시트 안 스크롤이 되고, 결과가 0~2건일 때 줄어드는 폭도 작다.
 */
export const MERCHANT_HISTORY_SKELETON_ROWS = Math.min(MERCHANT_HISTORY_ROWS, 3);

/**
 * '이 가맹점 최근 결제' 조회. 훅과 상세 미리 받기(detail-prefetch.ts)가 같은 키·요청을 쓴다.
 * 쿼리 키는 useTransactions({ q, limit: 30 })와 같아서 캐시를 함께 쓴다.
 */
export function merchantHistoryQuery(
  householdId: string | null,
  searchTerm: string,
  authedFetch: AuthedFetch
) {
  const filters = { q: searchTerm, limit: MERCHANT_HISTORY_SCAN_LIMIT };
  return queryOptions({
    queryKey: queryKeys.transactions(householdId, filters),
    queryFn: () =>
      authedFetch((token) =>
        api.transactions.list(token, {
          householdId: householdId as string,
          ...filters,
        })
      ),
  });
}

/**
 * 시트에 그릴 '이 가맹점 최근 결제' 줄(같은 가맹점 최근 30건 중 최신 5건)과 불러오는 중인지. 목록 표시용이다 —
 * 중복 의심의 짝 결제는 이 5건 밖에 있을 수 있어 비교 안내는 duplicate-pair.ts가 따로 찾는다
 * (예전에는 이 목록이 보이는지로 안내를 냈다가, 짝이 없는 목록을 보고 '정상'을 누르게 했다).
 * 검색어가 없으면 요청하지 않는다.
 */
function useMerchantHistoryRows(
  txn: TransactionSummary,
  searchTerm: string | null
): { rows: TransactionSummary[]; loading: boolean } {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const query = useQuery({
    ...merchantHistoryQuery(householdId, searchTerm ?? "", authedFetch),
    enabled: householdId != null && Boolean(searchTerm),
  });
  if (!searchTerm) return { rows: [], loading: false };
  if (!query.isSuccess) return { rows: [], loading: query.isLoading };
  return {
    rows: sameMerchantHistory(query.data.items, txn, MERCHANT_HISTORY_ROWS),
    loading: false,
  };
}

export function MerchantHistory({
  txn,
  searchTerm,
  disabled,
  openingId,
  onOpen,
  onPrefetch,
}: {
  txn: TransactionSummary;
  searchTerm: string;
  disabled: boolean;
  /** 열려고 하위 데이터를 기다리는 거래 — 그 줄은 손을 뗀 뒤에도 눌린 모양으로 둔다. */
  openingId: string | null;
  /** 줄을 눌렀을 때. 키보드로 누른 click(detail 0)이면 `viaKeyboard`가 참이다. */
  onOpen: (item: TransactionSummary, viaKeyboard: boolean) => void;
  /**
   * 줄을 누르려 할 때 — 그 거래 시트의 하위 데이터를 미리 받는다. 목록 줄과 같은 판별(press-prefetch.ts)을 거쳐,
   * 시트를 스크롤하려고 댄 손가락에는 불리지 않는다.
   */
  onPrefetch: (item: TransactionSummary) => void;
}) {
  const { rows, loading } = useMerchantHistoryRows(txn, searchTerm);
  const press = usePressPrefetch();
  if (loading) {
    return (
      <section
        aria-label="이 가맹점 최근 결제"
        aria-busy="true"
        className="flex min-w-0 flex-col"
      >
        <SectionHeader as="h3" title="이 가맹점 최근 결제" />
        {/* 실제 줄과 같은 높이(min-h-12)·구분선. 날짜·금액 자리에 내용 없는 회색 막대만 둔다. */}
        <ul aria-hidden="true" className="divide-border/60 divide-y">
          {Array.from({ length: MERCHANT_HISTORY_SKELETON_ROWS }, (_, index) => (
            <li key={index} className="flex min-h-12 min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-28 max-w-full" />
              </div>
              <Skeleton className="h-4 w-16 shrink-0" />
              <div className="size-4 shrink-0" />
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (rows.length === 0) return null;
  return (
    <section aria-label="이 가맹점 최근 결제" className="flex min-w-0 flex-col">
      <SectionHeader as="h3" title="이 가맹점 최근 결제" />
      <ul className="divide-border/60 divide-y">
        {rows.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={disabled}
              {...pressPrefetchHandlers(press, () => onPrefetch(item))}
              onClick={(event) => onOpen(item, event.detail === 0)}
              className={cn(
                "hover:bg-muted/50 focus-visible:outline-ring flex min-h-12 w-full min-w-0 items-center gap-3 text-left focus-visible:outline-2 disabled:opacity-50 active:bg-muted",
                openingId === item.id && "bg-muted"
              )}
            >
              <span className="text-caption text-muted-foreground min-w-0 flex-1 truncate">
                {formatMonthDayTime(transactionOccurredAt(item))}
              </span>
              <span className="text-body shrink-0 tabular-nums">
                <Money
                  amount={
                    item.transactionType === "cancellation"
                      ? -item.amount
                      : item.netAmount
                  }
                  currency={item.currency}
                />
              </span>
              <ChevronRight
                className="text-muted-foreground/70 size-4 shrink-0"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
