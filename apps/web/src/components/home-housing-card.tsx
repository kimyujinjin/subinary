import type { ManualHousingSummary } from "@family/contracts";
import { ArrowRight, ChevronRight, House } from "lucide-react";
import Link from "next/link";
import React from "react";

import { manualDateText, manualKrwText } from "@/lib/home-finance-summary";

const PAYMENT_LABEL = { contract: "계약금", interim: "중도금", balance: "잔금", option: "옵션" } as const;

export function HomeHousingCard({ summary, loading, error, scope }: {
  summary?: ManualHousingSummary;
  loading: boolean;
  error: boolean;
  scope: "household" | "private";
}) {
  const next = !loading && !error ? summary?.nextPayment : null;
  if (!next) {
    const incomplete = !loading && !error && summary?.hasIncompletePayments;
    return (
      <section className="min-w-0 py-5 lg:py-0 lg:pl-7" aria-label="주택 납부 일정">
        <Link href={`/plan?scope=${scope}`} className="focus-visible:outline-ring flex min-h-11 items-center gap-3 rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-offset-4">
          <House className="text-primary size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">주택 납부 일정</h2>
            <span className={`mt-1 block text-xs leading-relaxed ${error ? "text-destructive" : "text-muted-foreground"}`} role={error ? "alert" : loading ? "status" : undefined}>
              {loading ? "납부 일정을 불러오는 중이에요." : error ? "납부 일정을 불러오지 못했어요." : incomplete ? "금액·날짜·납부 내역이 비어 있는 항목이 있어요." : "예정된 납부 일정이 없어요."}
            </span>
          </div>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        </Link>
      </section>
    );
  }
  return (
    <section className="flex min-w-0 flex-col pt-5 lg:pt-0 lg:pl-7" aria-labelledby="home-housing-heading">
      <div className="min-w-0 pb-4">
        <div className="flex min-h-11 items-center gap-2">
          <House className="text-primary size-4 shrink-0" aria-hidden="true" />
          <h2 id="home-housing-heading" className="text-[15px] font-semibold">다음 주택 납부</h2>
        </div>
        <p className="mt-1 min-w-0 break-all text-[clamp(1.625rem,4vw,1.875rem)] font-bold leading-tight tracking-tight tabular-nums">{manualKrwText(next.remainingAmountKrw)}</p>
        <p className="text-muted-foreground mt-2 text-xs">{scope === "household" ? "가족과 공유한 일정" : "나만 보는 일정"}</p>
        <dl className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 text-sm">
          <dt className="sr-only">납부일</dt><dd className="col-start-1 row-start-1 font-semibold tabular-nums">{manualDateText(next.dueDate)}</dd>
          <dt className="sr-only">항목</dt><dd className="text-muted-foreground col-start-2 row-start-1 text-right text-xs">{PAYMENT_LABEL[next.kind]}{next.installment !== null ? ` ${next.installment}회차` : ""}</dd>
          <dt className="sr-only">주택</dt><dd className="text-muted-foreground col-span-2 min-w-0 break-words text-xs">{next.label}</dd>
        </dl>
        {!loading && !error && summary?.hasIncompletePayments ? <p className="text-muted-foreground mt-4 text-xs leading-relaxed">금액·날짜·납부 내역이 비어 있는 항목이 있어요.</p> : null}
      </div>
      <Link href={`/plan?scope=${scope}`} className="text-primary hover:text-foreground focus-visible:outline-ring mt-auto flex min-h-11 items-center justify-between gap-2 rounded-lg border-t py-2.5 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">납부 일정 보기 <ArrowRight className="size-4 shrink-0" aria-hidden="true" /></Link>
    </section>
  );
}
