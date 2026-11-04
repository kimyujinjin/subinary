import type { ManualHousingSummary } from "@family/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import React from "react";

import { manualDateText, manualKrwText } from "@/lib/home-finance-summary";

const PAYMENT_LABEL = {
  contract: "계약금",
  interim: "중도금",
  balance: "잔금",
  option: "옵션",
} as const;

/** 홈에서 다음 주택 납부 한 줄(§5 홈 4). 일정이 없으면 홈이 이 카드를 숨긴다. */
export function HomeHousingCard({
  summary,
  loading,
  error,
  scope,
}: {
  summary?: ManualHousingSummary;
  loading: boolean;
  error: boolean;
  scope: "household" | "private";
}) {
  const next = !loading && !error ? summary?.nextPayment : null;
  const incomplete = !loading && !error && summary?.hasIncompletePayments;
  return (
    <Link
      href={`/plan?scope=${scope}`}
      aria-label="주택 납부 일정"
      className="finance-panel hover:bg-muted/40 focus-visible:outline-ring flex min-h-16 min-w-0 items-center gap-3 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span className="min-w-0 flex-1">
        <span className="text-caption text-muted-foreground block">
          {next
            ? `다음 주택 납부 · ${PAYMENT_LABEL[next.kind]}${
                next.installment !== null ? ` ${next.installment}회차` : ""
              }`
            : "주택 납부 일정"}
        </span>
        {next ? (
          <span className="text-body block break-words font-semibold">
            {manualDateText(next.dueDate)} · {next.label}
          </span>
        ) : (
          <span
            className={`text-body block ${
              error ? "text-destructive" : "text-muted-foreground"
            }`}
            role={error ? "alert" : loading ? "status" : undefined}
          >
            {loading
              ? "납부 일정을 불러오는 중이에요."
              : error
              ? "납부 일정을 불러오지 못했어요."
              : incomplete
              ? "금액·날짜·납부 내역이 비어 있는 항목이 있어요."
              : "예정된 납부 일정이 없어요."}
          </span>
        )}
        {next && incomplete ? (
          <span className="text-caption text-muted-foreground block">
            금액·날짜·납부 내역이 비어 있는 항목이 있어요.
          </span>
        ) : null}
      </span>
      {next ? (
        <span className="text-heading shrink-0 text-right tabular-nums">
          {manualKrwText(next.remainingAmountKrw)}
        </span>
      ) : null}
      <ChevronRight
        className="text-muted-foreground/60 size-5 shrink-0"
        aria-hidden="true"
      />
    </Link>
  );
}
