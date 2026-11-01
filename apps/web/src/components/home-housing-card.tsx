import type { ManualHousingSummary } from "@family/contracts";
import { ArrowRight, House } from "lucide-react";
import Link from "next/link";
import React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { manualDateText, manualKrwText } from "@/lib/home-finance-summary";

const PAYMENT_LABEL = { contract: "계약금", interim: "중도금", balance: "잔금", option: "옵션" } as const;

export function HomeHousingCard({ summary, loading, error, scope }: {
  summary?: ManualHousingSummary;
  loading: boolean;
  error: boolean;
  scope: "household" | "private";
}) {
  const next = !loading && !error ? summary?.nextPayment : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><House className="size-4" aria-hidden="true" />주택 지급에 필요한 돈</CardTitle>
        <CardDescription>{scope === "household" ? "공유한" : "내 비공개"} 계획의 수동 지급 기록이에요</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">입력된 미지급 일정 중 가장 이른 지급</p>
        <p className="break-words text-2xl font-bold tracking-tight tabular-nums">{manualKrwText(next?.remainingAmountKrw)}</p>
        {loading ? <p className="text-muted-foreground text-sm" role="status">주택 지급 기록을 확인하고 있어요.</p> : error ? <p className="text-destructive text-sm" role="alert">주택 지급 기록을 불러오지 못했어요.</p> : next ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">계획</dt><dd className="break-words">{next.label}</dd>
            <dt className="text-muted-foreground">항목</dt><dd>{PAYMENT_LABEL[next.kind]}{next.installment !== null ? ` ${next.installment}회차` : ""}</dd>
            <dt className="text-muted-foreground">지급일</dt><dd>{manualDateText(next.dueDate)}</dd>
          </dl>
        ) : <p className="text-muted-foreground text-sm">확정해서 표시할 미지급 일정이 없어요. 금액·지급일·납부 기록을 계획에서 확인해 주세요.</p>}
        {!loading && !error && summary?.hasIncompletePayments ? <p className="text-muted-foreground text-xs leading-relaxed">미입력 정보가 있어 전체 필요자금은 확정할 수 없어요. 모르는 금액이나 납부 여부를 0원·완납으로 채우지 않아요.</p> : null}
        <p className="text-muted-foreground text-xs leading-relaxed">계약금액을 현재 자산 가치로 더하지 않아요. 재원 배정·자동 잔액 변경·현금 전망은 계산하지 않아요.</p>
        <Link href={`/plan?scope=${scope}`} className="text-primary inline-flex min-h-11 items-center gap-1 text-sm font-medium">지급 일정과 재원 메모 보기 <ArrowRight className="size-4" aria-hidden="true" /></Link>
      </CardContent>
    </Card>
  );
}
