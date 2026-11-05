"use client";

import { useState } from "react";
import type { FinanceConnection } from "@family/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldList, FieldRow } from "@/components/widgets/field-row";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { OverflowMenu } from "@/components/widgets/overflow-menu";
import { StatusChip, type ChipTone } from "@/components/widgets/status-chip";
import { CONNECTION_ERROR, CONNECTION_STATUS, connectionDecimal, connectionMoney, connectionTime, hasPreviousSnapshot } from "./model";

const CURRENCY_LABEL = { KRW: "국내 주식", USD: "미국 주식" } as const;

/**
 * 토스증권 연결 한 장.
 *
 * `primary`면 이 카드의 다음 행동(계좌 선택 단계는 '이 계좌 조회하기', 그 뒤로는 자주 쓰는 '새로 조회하기')이
 * 화면의 채움 버튼이다. 화면당 채움 버튼은 하나라 여러 장이면 화면(connection-screen)이 한 장만 고른다.
 * 마지막 조회 시각은 믿을 만한 값인지 판단하는 정보라 칩 크기가 아니라 본문 크기 정보 줄로 둔다.
 * 조회가 멈춘 이유(errorCode)는 그 아래 오류 알림이다.
 */
export function ConnectionCard({ item, disabled, unconfirmed = false, canManage, enabled, primary = true, onSelect, onRefresh, onDisconnect }: {
  item: FinanceConnection; disabled: boolean; unconfirmed?: boolean; canManage: boolean; enabled: boolean; primary?: boolean;
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
        <h2 className="text-body min-w-0 font-semibold">{selected?.label ?? "토스증권"}</h2>
        <div className="flex shrink-0 items-center gap-1">
          {chip ? <StatusChip tone={chip[0]}>{chip[1]}</StatusChip> : null}
          {canManage ? <OverflowMenu label="토스증권 연결 메뉴" actions={[{ label: "연결 해제", destructive: true, disabled, onSelect: () => setConfirmDelete(true) }]} /> : null}
        </div>
      </div>
      <FieldList>
        <FieldRow label="마지막 조회 성공" value={connectionTime(item.lastSuccessAt)} muted={!item.lastSuccessAt} />
      </FieldList>
      {/* 조회가 멈춘 이유는 연결 상태라 위쪽 상태 정보(상태 칩·마지막 조회 성공) 바로 아래에 둔다(신한 조회 상태의 실패 이유와 같은 자리).
          예전 회색 caption은 안내 줄과 똑같아 실패로 읽히지 않았다 — 오류 알림(role="alert")으로 구분한다. */}
      {item.errorCode ? <InlineNotice tone="error">{CONNECTION_ERROR[item.errorCode]}</InlineNotice> : null}
      {!item.selectedAccountId && item.status === "select_account" ? (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!disabled && item.accountOptions.some((option) => option.id === selection)) onSelect(selection); }}>
          <p className="text-body">조회할 계좌를 선택해 주세요.</p>
          {item.accountOptions.length === 0 ? <p className="text-caption text-muted-foreground">조회할 수 있는 종합매매 계좌가 없어요.</p> : null}
          {/* 값 고르기는 앱 공통 줄(⌃⌄ — 누른 자리 아래 드롭다운)이다. 예전에는 모양이 다른 Select 상자였다(2026-11-05 HIG 검수).
              다시 읽는 동안(disabled)에도 고르는 줄은 막지 않는다 — 막으면 열어 둔 목록이 닫힌다. 제출만 막는다(고르기 전에는
              제출 버튼이 꺼져 있다). */}
          <FieldList>
            <FieldRow
              label="조회할 계좌"
              value={item.accountOptions.find((account) => account.id === selection)?.label ?? "계좌 선택"}
              muted={!selection}
              disabled={!canManage || !enabled || item.accountOptions.length === 0}
              menu={{
                label: "조회할 계좌",
                options: item.accountOptions.map((account) => ({ value: account.id, label: account.label })),
                value: selection || null,
                onSelect: setSelection,
              }}
            />
          </FieldList>
          <Button type="submit" size="lg" variant={primary ? "default" : "weak"} disabled={disabled || !canManage || !enabled || !selection} className="w-full">이 계좌 조회하기</Button>
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
      {enabled && item.nextRefreshAt && !item.canRefresh && settled && item.selectedAccountId ? <p className="text-caption text-muted-foreground">{connectionTime(item.nextRefreshAt)} 이후에 다시 조회할 수 있어요.</p> : null}
      {canManage && enabled && item.selectedAccountId ? <Button size="lg" variant={primary ? "default" : "weak"} className="w-full" disabled={disabled || !enabled || !item.canRefresh} onClick={onRefresh}>새로 조회하기</Button> : null}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>연결을 해제할까요?</AlertDialogTitle>
            <AlertDialogDescription>모아에 저장한 두 키를 지우고 조회를 멈춰요. 토스증권에서 발급한 키는 그대로이고, 이전 조회 기록은 보관돼요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={disabled} onClick={onDisconnect}>연결 해제하기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
