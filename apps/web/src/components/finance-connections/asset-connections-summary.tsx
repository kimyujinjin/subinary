"use client";

import Link from "next/link";
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
    <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5" aria-label="본인 연결 계좌">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">계좌 연결</h2>
        <Link href="/more/connections" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">토스증권 연결 관리 →</Link>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">본인이 연결한 계좌만 보여요. 가족에게 공유하거나 가족 자산 합계에 더하지 않아요.</p>
      {notice ? <p role="alert" className="text-sm leading-relaxed">{notice}</p> : null}
      {loading ? <p role="status" className="text-sm text-muted-foreground">연결 계좌를 확인하고 있어요.</p> : null}
      {visibleData && !visibleData.enabled ? <p role="status" className="text-sm text-muted-foreground">토스증권 연결을 준비하고 있어요. 설정이 완료되면 연결할 수 있어요.</p> : null}
      {visibleData?.enabled && !items.length ? <p className="text-sm text-muted-foreground">연결한 토스증권 계좌가 없어요. 연결 관리에서 본인 계좌를 추가해 주세요.</p> : null}
      {busy && visibleData ? <p role="status" className="text-sm text-muted-foreground">보유 주식을 새로 확인하고 있어요.</p> : null}
      {items.map((item) => {
        const selected = item.accountOptions.find((option) => option.id === item.selectedAccountId);
        const uncertain = uncertainId === item.id;
        const stale = hasPreviousSnapshot(item) || uncertain || !visibleData?.enabled;
        return <article key={item.id} className="min-w-0 space-y-3 border-t pt-3" aria-label="연결 계좌 요약">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h3 className="text-sm font-semibold">토스증권</h3>{selected ? <p className="mt-1 break-words text-xs text-muted-foreground">{selected.label}</p> : null}</div>
            <span className="rounded-full bg-muted px-2 py-1 text-xs">{uncertain ? "조회 확인 필요" : item.status === "ready" && !item.snapshot ? "조회 전" : CONNECTION_STATUS[item.status]}</span>
          </div>
          {item.errorCode ? <p className="text-xs leading-relaxed text-muted-foreground">{CONNECTION_ERROR[item.errorCode]}</p> : null}
          {item.snapshot ? <>
            {stale ? <p className="text-xs font-medium text-muted-foreground">이전 조회 내역</p> : null}
            <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              {(["KRW", "USD"] as const).map((currency) => {
                const total = item.snapshot!.totals.find((value) => value.currency === currency);
                return <div key={currency} className="min-w-0 rounded-xl bg-muted/50 p-3">
                  <dt className="text-xs text-muted-foreground">{currency === "KRW" ? "원화 주식 평가금액" : "달러 주식 평가금액"}</dt>
                  <dd className="mt-1 break-all text-xl font-semibold tabular-nums">{total ? `${connectionDecimal(total.marketValue)} ${currency === "KRW" ? "원" : "USD"}` : "조회 내역 없음"}</dd>
                </div>;
              })}
            </dl>
            <p className="text-xs leading-relaxed text-muted-foreground">정보 확인 {connectionTime(item.snapshot.observedAt)} (한국 시간)<br />증권사 평가 기준 시각: 제공되지 않음</p>
          </> : <p className="text-sm text-muted-foreground">{item.status === "select_account" ? "연결 관리에서 조회할 계좌를 선택해 주세요." : "아직 보유 주식 조회 내역이 없어요."}</p>}
          <p className="text-xs text-muted-foreground">마지막 조회 성공: {connectionTime(item.lastSuccessAt)}</p>
        </article>;
      })}
      {visibleData?.enabled ? <p className="text-xs leading-relaxed text-muted-foreground">동의한 계좌는 자산 또는 연결 화면을 열 때 새로 조회해요. 조회 간격 제한이나 처리 중인 요청이 있으면 마지막 내역을 보여줘요. 은행 잔액은 포함하지 않아요.</p> : null}
    </section>
  );
}
