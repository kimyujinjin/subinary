"use client";
/* ---------------------------------------------------------------------------
 * 거래 상세 시트 — "이 가맹점 최근 결제"(2026-11-05).
 *
 * 같은 곳에서 얼마나 자주·얼마씩 썼는지는 시트를 닫고 검색해야만 알 수 있었다. 최근 5건을
 * 보여 주고, 누르면 그 거래 상세로 바로 넘어간다(목록에 없으면 기존 딥링크 폴백이 단건 조회).
 * 넘어간 시트 머리에는 '‹ 이전 거래'가 생겨 한 단계 돌아갈 수 있다(page.tsx, HIG 검수 3·4단계).
 * 보조 정보라 로딩·실패·없음에는 아무것도 그리지 않는다.
 * ------------------------------------------------------------------------- */
import type { TransactionSummary } from "@family/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

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

/**
 * 시트에 그릴 '이 가맹점 최근 결제' 줄(같은 가맹점 최근 30건 중 최신 5건). 목록 표시용이다 —
 * 중복 의심의 짝 결제는 이 5건 밖에 있을 수 있어 비교 안내는 duplicate-pair.ts가 따로 찾는다
 * (예전에는 이 목록이 보이는지로 안내를 냈다가, 짝이 없는 목록을 보고 '정상'을 누르게 했다).
 * 검색어가 없으면 요청하지 않는다. 쿼리 키는 useTransactions({ q, limit: 30 })와 같아서 캐시를 함께 쓴다.
 */
function useMerchantHistoryRows(
  txn: TransactionSummary,
  searchTerm: string | null
): ReturnType<typeof sameMerchantHistory> {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const filters = { q: searchTerm ?? "", limit: 30 };
  const query = useQuery({
    queryKey: queryKeys.transactions(householdId, filters),
    enabled: householdId != null && Boolean(searchTerm),
    queryFn: () =>
      authedFetch((token) =>
        api.transactions.list(token, {
          householdId: householdId as string,
          ...filters,
        })
      ),
  });
  if (!searchTerm || !query.isSuccess) return [];
  return sameMerchantHistory(query.data.items, txn);
}

export function MerchantHistory({
  txn,
  searchTerm,
  disabled,
  onOpen,
}: {
  txn: TransactionSummary;
  searchTerm: string;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const rows = useMerchantHistoryRows(txn, searchTerm);
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
              onClick={() => onOpen(item.id)}
              className="hover:bg-muted/50 focus-visible:outline-ring flex min-h-12 w-full min-w-0 items-center gap-3 text-left focus-visible:outline-2 disabled:opacity-50 active:bg-muted"
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
