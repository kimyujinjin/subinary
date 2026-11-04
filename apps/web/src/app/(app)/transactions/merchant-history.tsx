"use client";
/* ---------------------------------------------------------------------------
 * 거래 상세 시트 — "이 가맹점 최근 결제"(2026-11-05).
 *
 * 같은 곳에서 얼마나 자주·얼마씩 썼는지는 시트를 닫고 검색해야만 알 수 있었다. 최근 5건을
 * 보여 주고, 누르면 그 거래 상세로 바로 넘어간다(목록에 없으면 기존 딥링크 폴백이 단건 조회).
 * 보조 정보라 로딩·실패·없음에는 아무것도 그리지 않는다.
 * ------------------------------------------------------------------------- */
import type { TransactionSummary } from "@family/contracts";
import { ChevronRight } from "lucide-react";

import { Money } from "@/components/widgets";
import { SectionHeader } from "@/components/widgets/section-header";
import { formatDate } from "@/lib/format";
import { useTransactions } from "@/lib/queries";
import {
  sameMerchantHistory,
  transactionOccurredAt,
} from "@/lib/transaction-display";

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
  const query = useTransactions({ q: searchTerm, limit: 30 });
  if (!query.isSuccess) return null;
  const rows = sameMerchantHistory(query.data.items, txn);
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
              className="hover:bg-muted/50 focus-visible:outline-ring flex min-h-12 w-full min-w-0 items-center gap-3 text-left focus-visible:outline-2 disabled:opacity-50"
            >
              <span className="text-caption text-muted-foreground min-w-0 flex-1 truncate">
                {formatDate(transactionOccurredAt(item))}
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
                className="text-muted-foreground/60 size-4 shrink-0"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
