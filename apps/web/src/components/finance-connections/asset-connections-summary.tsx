"use client";

import Link from "next/link";
import { ChevronRight, Landmark } from "lucide-react";
import type { FinanceConnectionList } from "@family/contracts";
import { CONNECTION_ERROR, CONNECTION_STATUS, connectionDecimal, connectionTime, hasPreviousSnapshot } from "./model";

/** Presentation only: all reads, authorization fences and refreshes belong to ConnectionScreen. */
export function AssetConnectionsSummary({ data, busy, loading, notice, uncertainId }: {
  data: FinanceConnectionList | null;
  busy: boolean;
  loading: boolean;
  notice: string | null;
  uncertainId: string | null;
}) {
  // Authorization revalidation hides even a previously supplied snapshot immediately.
  const visibleData = loading ? null : data;
  const items = visibleData?.items.filter((item) => item.status !== "disconnected") ?? [];
  return (
    <section className="min-w-0 space-y-3 border-t-2 pt-5" aria-label="본인 연결 계좌">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">가족 합계와 별도</p>
          <h2 className="mt-1 text-lg font-semibold">내 연결 계좌</h2>
        </div>
        <Link href="/more/connections" className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">토스증권 연결 관리<ChevronRight className="size-4 shrink-0" aria-hidden="true" /></Link>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">본인이 연결한 계좌만 보여요. 가족에게 공유하거나 가족 자산 합계에 더하지 않아요.</p>
      {notice ? <p role="alert" className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed">{notice}</p> : null}
      {loading ? <p role="status" className="text-sm text-muted-foreground">연결 계좌를 확인하고 있어요.</p> : null}
      {visibleData && !visibleData.enabled ? <p role="status" className="text-sm text-muted-foreground">토스증권 연결을 준비하고 있어요. 설정이 완료되면 연결할 수 있어요.</p> : null}
      {visibleData?.enabled && !items.length ? <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><Landmark className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0"><h3 className="text-sm font-semibold">토스증권 보유 주식</h3><p className="mt-1 text-xs text-muted-foreground">국내·미국 주식을 통화별로 확인해요</p></div>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">연결한 토스증권 계좌가 없어요. 연결 관리에서 본인 계좌를 추가해 주세요.</p>
      </div> : null}
      {busy && visibleData ? <p role="status" className="text-sm text-muted-foreground">보유 주식을 새로 확인하고 있어요.</p> : null}
      {items.map((item) => {
        const selected = item.accountOptions.find((option) => option.id === item.selectedAccountId);
        const uncertain = uncertainId === item.id;
        const stale = hasPreviousSnapshot(item) || uncertain || !visibleData?.enabled;
        return <article key={item.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4" aria-label="연결 계좌 요약">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 basis-32 gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><Landmark className="size-5" aria-hidden="true" /></span>
              <div className="min-w-0"><h3 className="text-sm font-semibold">토스증권</h3>{selected ? <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{selected.label}</p> : null}</div>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-medium ${item.status === "ready" && item.snapshot && !stale ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>{uncertain ? "조회 확인 필요" : item.status === "ready" && !item.snapshot ? "조회 전" : CONNECTION_STATUS[item.status]}</span>
          </div>
          {item.errorCode ? <p className="text-xs leading-relaxed text-muted-foreground">{CONNECTION_ERROR[item.errorCode]}</p> : null}
          {item.snapshot ? <>
            {stale ? <p className="text-xs font-medium text-muted-foreground">이전 조회 내역</p> : null}
            <dl className="min-w-0 space-y-3 border-t pt-3">
              {(["KRW", "USD"] as const).map((currency) => {
                const total = item.snapshot!.totals.find((value) => value.currency === currency);
                return <div key={currency} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <dt className="text-xs leading-relaxed text-muted-foreground">{currency === "KRW" ? "원화 주식 평가금액" : "달러 주식 평가금액"}</dt>
                  <dd className={`ml-auto min-w-0 max-w-full break-all text-right font-semibold tabular-nums ${total ? "text-xl tracking-tight" : "text-sm text-muted-foreground"}`}>{total ? `${connectionDecimal(total.marketValue)} ${currency === "KRW" ? "원" : "USD"}` : "조회 내역 없음"}</dd>
                </div>;
              })}
            </dl>
            <p className="text-xs leading-relaxed text-muted-foreground">정보 확인 {connectionTime(item.snapshot.observedAt)} (한국 시간)<br />증권사 평가 기준 시각: 제공되지 않음</p>
          </> : <p className="text-sm text-muted-foreground">{item.status === "select_account" ? "연결 관리에서 조회할 계좌를 선택해 주세요." : "아직 보유 주식 조회 내역이 없어요."}</p>}
          <p className="text-xs text-muted-foreground">마지막 조회 성공: {connectionTime(item.lastSuccessAt)}</p>
        </article>;
      })}
      <p className="text-xs leading-relaxed text-muted-foreground">원화와 달러는 합산하거나 환산하지 않아요. 은행 잔액은 포함하지 않아요.</p>
      {visibleData?.enabled ? <details className="border-t text-xs leading-relaxed text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-3">조회 시점 안내</summary>
        <p className="pb-1">동의한 계좌는 자산 또는 연결 화면을 열 때 새로 조회해요. 조회 간격 제한이나 처리 중인 요청이 있으면 마지막 내역을 보여줘요. 앱을 닫아 둔 동안에는 자동 조회하지 않아요.</p>
      </details> : null}
    </section>
  );
}
