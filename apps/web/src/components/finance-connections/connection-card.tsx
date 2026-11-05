"use client";

import { useState } from "react";
import type { FinanceConnection } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BottomSheet } from "@/components/widgets/bottom-sheet";
import { OverflowMenu } from "@/components/widgets/overflow-menu";
import { StatusChip, type ChipTone } from "@/components/widgets/status-chip";
import { CONNECTION_ERROR, CONNECTION_STATUS, connectionDecimal, connectionMoney, connectionTime, hasPreviousSnapshot } from "./model";

const CURRENCY_LABEL = { KRW: "국내 주식", USD: "미국 주식" } as const;

export function ConnectionCard({ item, disabled, unconfirmed = false, canManage, enabled, onSelect, onRefresh, onDisconnect }: {
  item: FinanceConnection; disabled: boolean; unconfirmed?: boolean; canManage: boolean; enabled: boolean;
  onSelect: (accountId: string) => void; onRefresh: () => void; onDisconnect: () => void;
}) {
  const [selection, setSelection] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const selected = item.accountOptions.find((account) => account.id === item.selectedAccountId);
  const stale = hasPreviousSnapshot(item) || unconfirmed || !enabled;
  const settled = item.status !== "connecting" && item.status !== "refreshing";
  const fresh = item.status === "ready" && item.snapshot && !stale;
  const chip: [ChipTone, string] | null = unconfirmed
    ? ["attention", "조회 확인 필요"]
    : fresh ? null
    : item.status === "ready" && !item.snapshot ? ["neutral", "조회 전"]
    // 이전 값은 본문의 `이전 조회 내역` 줄이 이미 말한다 — 칩에 '조회 완료'를 달면 지금 값처럼 읽힌다.
    : item.status === "ready" ? null
    : item.status === "error" || item.status === "reauth_required" ? ["error", CONNECTION_STATUS[item.status]]
    : ["pending", CONNECTION_STATUS[item.status]];
  return (
    <article className="finance-panel min-w-0 space-y-4 p-5" aria-label="토스증권 연결 정보">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-body font-semibold">{selected?.label ?? "토스증권"}</h2>
          <p className="text-micro text-muted-foreground">마지막 조회 성공: {connectionTime(item.lastSuccessAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {chip ? <StatusChip tone={chip[0]}>{chip[1]}</StatusChip> : null}
          {canManage ? <OverflowMenu label="토스증권 연결 메뉴" actions={[{ label: "연결 해제", destructive: true, disabled, onSelect: () => setConfirmDelete(true) }]} /> : null}
        </div>
      </div>
      {item.errorCode ? <p role="status" className="text-caption text-muted-foreground">{CONNECTION_ERROR[item.errorCode]}</p> : null}
      {!item.selectedAccountId && item.status === "select_account" ? (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!disabled && item.accountOptions.some((option) => option.id === selection)) onSelect(selection); }}>
          <p className="text-body">조회할 계좌를 선택해 주세요.</p>
          {item.accountOptions.length === 0 ? <p className="text-caption text-muted-foreground">조회할 수 있는 종합매매 계좌가 없어요.</p> : null}
          {/* 공용 Select(채움형)를 그대로 쓴다. 다시 읽는 동안(disabled)에도 고르는 칸은 막지 않는다 — 막으면 열어 둔
              목록이 닫힌다. 제출만 막는다(고르기 전에는 제출 버튼이 꺼져 있다). */}
          <Select value={selection} onValueChange={setSelection} disabled={!canManage || !enabled || item.accountOptions.length === 0}>
            <SelectTrigger aria-label="조회할 계좌" className="min-h-12 w-full min-w-0 [&>[data-slot=select-value]]:min-w-0">
              <SelectValue placeholder="계좌 선택" />
            </SelectTrigger>
            <SelectContent>
              {item.accountOptions.map((account) => <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="submit" size="lg" disabled={disabled || !canManage || !enabled || !selection} className="w-full">이 계좌 조회하기</Button>
        </form>
      ) : null}
      {item.snapshot ? (
        <section className="space-y-3" aria-label="보유 주식 조회 내역">
          {stale ? <p className="text-caption text-muted-foreground">이전 조회 내역 · {connectionTime(item.snapshot.observedAt)}</p> : null}
          <dl className="space-y-2">
            {(["KRW", "USD"] as const).map((currency) => {
              const total = item.snapshot!.totals.find((value) => value.currency === currency);
              return <div key={currency} className="flex min-w-0 items-baseline justify-between gap-3">
                <dt className="text-body text-muted-foreground shrink-0">{CURRENCY_LABEL[currency]}</dt>
                <dd className={`min-w-0 break-all text-right tabular-nums ${total ? "text-heading" : "text-body text-muted-foreground"}`}>{total ? connectionMoney(total.marketValue, currency) : "조회 내역 없음"}</dd>
              </div>;
            })}
          </dl>
          {item.snapshot.items.length === 0 ? <p className="text-caption text-muted-foreground">조회된 보유 주식이 없어요.</p> : (
            <ul className="divide-y divide-border/60 border-t border-border/60" aria-label="보유 주식">
              {item.snapshot.items.slice(0, visibleCount).map((holding, index) => (
                <li key={`${holding.symbol}/${holding.currency}/${index}`} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1"><p className="text-body break-words font-medium">{holding.name || holding.symbol}</p><p className="text-caption text-muted-foreground break-all">{holding.symbol} · {connectionDecimal(holding.quantity)}주</p></div>
                  <p className="text-body min-w-0 break-all text-right font-semibold tabular-nums">{connectionMoney(holding.marketValue, holding.currency)}</p>
                </li>
              ))}
            </ul>
          )}
          {visibleCount < item.snapshot.items.length ? <Button variant="ghost" className="w-full" onClick={() => setVisibleCount((count) => count + 20)}>보유 주식 더 보기</Button> : null}
        </section>
      ) : item.selectedAccountId && settled ? <p className="text-body text-muted-foreground">아직 보유 주식을 가져오지 못했어요.</p> : null}
      {enabled && item.nextRefreshAt && !item.canRefresh && settled && item.selectedAccountId ? <p className="text-caption text-muted-foreground">다음 조회 가능: {connectionTime(item.nextRefreshAt)} 이후</p> : null}
      {canManage && enabled && item.selectedAccountId ? <Button variant="weak" className="w-full" disabled={disabled || !enabled || !item.canRefresh} onClick={onRefresh}>새로 조회</Button> : null}
      <BottomSheet open={confirmDelete} onOpenChange={setConfirmDelete} title="연결을 해제할까요?">
        <p className="text-body text-muted-foreground pb-3">모아에 저장한 연결 키를 삭제하고 조회를 멈춰요. 토스증권의 API 키 자체는 폐기되지 않고, 이전 조회 기록은 보관돼요.</p>
        <Button variant="destructive" size="lg" className="w-full" disabled={disabled} onClick={() => { setConfirmDelete(false); onDisconnect(); }}>삭제하고 연결 해제</Button>
      </BottomSheet>
    </article>
  );
}
