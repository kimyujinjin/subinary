"use client";

import { useState } from "react";
import type { FinanceConnection } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { CONNECTION_ERROR, CONNECTION_STATUS, connectionDecimal, connectionTime, hasPreviousSnapshot } from "./model";

export function ConnectionCard({ item, disabled, unconfirmed = false, canManage, enabled, onSelect, onRefresh, onDisconnect }: {
  item: FinanceConnection; disabled: boolean; unconfirmed?: boolean; canManage: boolean; enabled: boolean;
  onSelect: (accountId: string) => void; onRefresh: () => void; onDisconnect: () => void;
}) {
  const [selection, setSelection] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const selected = item.accountOptions.find((account) => account.id === item.selectedAccountId);
  const stale = hasPreviousSnapshot(item) || unconfirmed;
  const settled = item.status !== "connecting" && item.status !== "refreshing";
  return (
    <article className="min-w-0 space-y-4 rounded-2xl border bg-card p-4" aria-label="토스증권 연결 정보">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><h2 className="font-semibold">토스증권</h2>{selected ? <p className="mt-1 break-words text-sm text-muted-foreground">{selected.label}</p> : null}</div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{unconfirmed ? "조회 확인 필요" : item.status === "ready" && !item.snapshot ? "조회 전" : CONNECTION_STATUS[item.status]}</span>
      </div>
      {item.errorCode ? <p role="status" className="rounded-lg bg-muted p-3 text-sm leading-relaxed">{CONNECTION_ERROR[item.errorCode]}</p> : null}
      {item.status === "connecting" || item.status === "refreshing" ? <p role="status" className="text-sm text-muted-foreground">처리 중이에요. 아래 ‘연결 상태 확인’으로 결과를 확인할 수 있어요.</p> : null}
      {!item.selectedAccountId && item.status === "select_account" ? (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!disabled && item.accountOptions.some((option) => option.id === selection)) onSelect(selection); }}>
          {item.accountOptions.length === 0 ? <p className="text-sm text-muted-foreground">조회할 수 있는 종합매매 계좌가 없어요.</p> : null}
          <label className="block space-y-2 text-sm font-medium">
            <span>조회할 계좌</span>
            <select value={selection} onChange={(event) => setSelection(event.target.value)} required disabled={disabled || !canManage || !enabled} className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm">
              <option value="">계좌를 선택해 주세요</option>
              {item.accountOptions.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </label>
          <Button type="submit" disabled={disabled || !canManage || !enabled || !selection} className="min-h-11 w-full">이 계좌 조회하기</Button>
        </form>
      ) : null}
      {item.snapshot ? (
        <section className="space-y-3" aria-label="보유 주식 조회 내역">
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="text-sm font-semibold">보유 주식 평가금액</h3>
            {stale ? <span className="text-xs font-medium text-muted-foreground">이전 조회 내역</span> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["KRW", "USD"] as const).map((currency) => {
              const total = item.snapshot!.totals.find((value) => value.currency === currency);
              return <div key={currency} className="min-w-0 rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{currency === "KRW" ? "원화 평가금액" : "달러 평가금액"}</p>
                <p className="mt-1 break-all text-xl font-semibold tabular-nums">{total ? `${connectionDecimal(total.marketValue)} ${currency === "KRW" ? "원" : "USD"}` : "조회 내역 없음"}</p>
              </div>;
            })}
          </div>
          <dl className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <div><dt className="inline">정보를 가져온 시각: </dt><dd className="inline">{connectionTime(item.snapshot.observedAt)} (한국 시간)</dd></div>
            <div><dt className="inline">증권사 평가 기준 시각: </dt><dd className="inline">제공되지 않음</dd></div>
          </dl>
          {item.snapshot.items.length === 0 ? <p className="py-2 text-sm text-muted-foreground">조회된 보유 주식이 없어요.</p> : (
            <ul className="divide-y" aria-label="보유 주식">
              {item.snapshot.items.slice(0, visibleCount).map((holding, index) => (
                <li key={`${holding.symbol}/${holding.currency}/${index}`} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0 flex-1 basis-28"><p className="break-words font-medium">{holding.name || holding.symbol}</p><p className="mt-1 break-all text-xs text-muted-foreground">{holding.symbol} · {connectionDecimal(holding.quantity)}주</p></div>
                  <p className="max-w-full break-all text-right tabular-nums">{connectionDecimal(holding.marketValue)} {holding.currency === "KRW" ? "원" : "USD"}</p>
                </li>
              ))}
            </ul>
          )}
          {visibleCount < item.snapshot.items.length ? <Button variant="outline" className="min-h-11 w-full" onClick={() => setVisibleCount((count) => count + 20)}>보유 주식 더 보기</Button> : null}
        </section>
      ) : item.selectedAccountId && settled ? <p className="text-sm text-muted-foreground">아직 보유 주식을 가져오지 못했어요. 조회 전 금액은 합계로 표시하지 않아요.</p> : null}
      <p className="text-xs leading-relaxed text-muted-foreground">마지막 조회 성공: {connectionTime(item.lastSuccessAt)}</p>
      {item.nextRefreshAt && !item.canRefresh && settled && item.selectedAccountId ? <p className="text-xs leading-relaxed text-muted-foreground">다음 조회 가능: {connectionTime(item.nextRefreshAt)} 이후 · 연결 상태를 확인해 주세요.</p> : null}
      {canManage ? <div className="flex flex-wrap gap-2">
        {item.selectedAccountId ? <Button variant="outline" className="min-h-11 flex-1" disabled={disabled || !enabled || !item.canRefresh} onClick={onRefresh}>새로 조회</Button> : null}
        <Button variant="ghost" className="min-h-11" disabled={disabled} onClick={() => setConfirmDelete(true)}>연결 해제</Button>
      </div> : null}
      {confirmDelete ? <section aria-label="연결 해제 확인" className="space-y-3 rounded-xl border p-3">
        <h3 className="text-sm font-semibold">연결을 해제할까요?</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">모아에 저장한 연결 키를 삭제하고 앞으로의 조회를 중단해요. 토스증권의 API 키 자체는 폐기되지 않아요.</p>
        <p className="text-xs leading-relaxed text-muted-foreground">이전에 조회한 기록은 보관되며, 연결 해제 뒤 이 화면에 표시되지 않아요.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" className="min-h-11 flex-1" disabled={disabled} onClick={() => { setConfirmDelete(false); onDisconnect(); }}>삭제하고 연결 해제</Button>
          <Button variant="outline" className="min-h-11" onClick={() => setConfirmDelete(false)}>취소</Button>
        </div>
      </section> : null}
    </article>
  );
}
