"use client";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import type { BankConnection, BankConnectionList, BankConnectionResult } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { FinanceLoading } from "@/components/manual-finance/shared";
import { useAuth } from "@/lib/auth-context";
import { bankConnectionsApi, useOwnedBankConnections } from "@/lib/bank-connections-client";
import { createConnectionSession, connectionFailureStatus, connectionTime, connectionDecimal } from "./model";
import { BANK_ERROR, BANK_STATUS, bankAccountLabel, reconcileBankOperation, type PendingBankOperation } from "./bank-model";
import { BankRegistrationForm, type BankRegistrationInput } from "./bank-registration-form";

export function BankConnectionScreen({ householdId, userId, canManage, summary = false }: {
  householdId: string; userId: string; canManage: boolean; summary?: boolean;
}) {
  const { authedFetch } = useAuth();
  const session = useRef(createConnectionSession()).current;
  const [data, setData] = useState<BankConnectionList | null>(null), [busy, setBusy] = useState(false);
  const [form, setForm] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<PendingBankOperation | null>(null), active = useRef<PendingBankOperation | null>(null);
  const [uncertain, setUncertain] = useState<PendingBankOperation | null>(null);
  const firstRead = useRef(true);
  const beforeRead = useCallback(() => {
    if (active.current) { pending.current = active.current; setUncertain(active.current); }
    active.current = null; session.invalidate(); setData(null); setForm(false); setBusy(true); setNotice(null);
  }, [session]);
  const owned = useOwnedBankConnections(householdId, userId, beforeRead);
  const openingRefresh = useCallback(async (list: BankConnectionList) => {
    if (session.pending || pending.current || !canManage || !list.enabled) return;
    setBusy(true);
    await session.run(async signal => {
      let next = list;
      for (const item of list.items) {
        if (!item.refreshOnOpen || !item.canRefresh) continue;
        const operation: PendingBankOperation = { kind: "refresh", id: item.id, version: item.version };
        active.current = operation;
        try {
          const result = await authedFetch(token => bankConnectionsApi.refresh(token, item.id,
            { householdId, expectedVersion: item.version, requestId: crypto.randomUUID() }, userId, signal));
          next = { ...next, items: next.items.map(row => row.id === result.item.id ? result.item : row) };
        } catch (error) {
          signal.throwIfAborted();
          const status = connectionFailureStatus(error);
          if (status === 401 || status === 403 || status === 404) throw error;
          return { list: next, failed: !status || status === 408 || status >= 500 ? operation : null, failedRead: true };
        } finally { if (active.current === operation) active.current = null; }
      }
      return { list: next, failed: null, failedRead: false };
    }, result => {
      setData(result.list); pending.current = result.failed; setUncertain(result.failed); setBusy(false);
      if (result.failedRead) setNotice("최신 연결 상태를 확인해 주세요. 조회를 반복하지 않아도 돼요.");
    }, () => { setData(null); setBusy(false); setNotice("은행 연결 상태를 확인하지 못했어요. 다시 확인해 주세요."); });
  }, [authedFetch, canManage, householdId, session, userId]);
  useEffect(() => {
    if (owned.isPending || owned.isFetching) return;
    const opening = firstRead.current; firstRead.current = false;
    if (owned.error || !owned.data) { setData(null); setBusy(false); setNotice("은행 연결 상태를 불러오지 못했어요."); return; }
    pending.current = reconcileBankOperation(pending.current, owned.data.items); setUncertain(pending.current);
    setData(owned.data); setBusy(false); setNotice(pending.current ? "요청 결과가 확인될 때까지 다시 로그인하지 않아요. 연결 상태를 확인해 주세요." : null);
    if (opening && !pending.current) void openingRefresh(owned.data);
  }, [owned.data, owned.dataUpdatedAt, owned.error, owned.isPending, owned.isFetching, openingRefresh]);
  useEffect(() => () => { session.invalidate(); }, [session]);

  async function write(operation: PendingBankOperation, request: (signal: AbortSignal) => Promise<BankConnectionResult>) {
    if (session.pending || pending.current || !canManage) return;
    active.current = operation; setBusy(true); setNotice(null);
    await session.run(request, ({ item }) => {
      setData(current => current ? { ...current, items: [...current.items.filter(row => row.id !== item.id), item] } : current);
      setBusy(false); if (item.status === "disconnected") setNotice("연결을 해제하고 저장한 로그인 정보를 폐기했어요.");
    }, error => {
      const status = connectionFailureStatus(error);
      if (!status || status === 408 || status >= 500) { pending.current = operation; setUncertain(operation); }
      if (status === 401 || status === 403 || status === 404) setData(null);
      setBusy(false); setNotice("요청을 완료하지 못했어요. 연결 상태를 먼저 확인해 주세요.");
      if (status === 403 || status === 404) void owned.reread();
    });
    if (active.current === operation) active.current = null;
  }
  async function register(input: BankRegistrationInput) {
    if (!data?.enabled || !canManage || session.pending || pending.current) return;
    const connectionId = crypto.randomUUID(); setForm(false);
    const body = { householdId, connectionId, provider: "shinhan_bank", ...input,
      consent: { ownAccount: true, storeCredentials: true, automaticLogin: true, refreshOnOpen: true } } as const;
    try {
      await write({ kind: "register", id: connectionId, version: 0 }, async signal => {
        const saved = await authedFetch(token => bankConnectionsApi.register(token, body, userId, signal));
        if (!saved.item.canRefresh) return saved;
        return authedFetch(token => bankConnectionsApi.refresh(token, saved.item.id,
          { householdId, expectedVersion: saved.item.version, requestId: crypto.randomUUID() }, userId, signal));
      });
    } finally { Object.assign(body, { loginId: "", password: "" }); input.loginId = ""; input.password = ""; }
  }
  function openRegistration(event: MouseEvent<HTMLButtonElement>): void {
    // 등록 완료로 폼이 닫힌 직후 같은 더블 클릭의 두 번째 입력을 받지 않는다.
    if (event.detail > 1 || session.pending || pending.current || !canManage) return;
    setForm(true);
  }
  const items = data?.items.filter(item => item.status !== "disconnected") ?? [];
  const disabled = busy || !!uncertain;
  // Capability setup belongs in connection management; don't fill assets with
  // an unconfigured bank panel or an empty provider-specific skeleton.
  if (summary && !items.length) return null;
  return <section className="min-w-0 space-y-4" aria-label="신한은행 자동조회">
    {!data && (busy || owned.isPending) ? <FinanceLoading /> : null}
    {notice ? <p role="alert" className="rounded-xl border p-3 text-sm leading-relaxed">{notice}</p> : null}
    {data && !data.enabled ? <p role="status" className="rounded-xl bg-muted/60 p-4 text-sm leading-relaxed">신한 자동조회를 위한 실행 환경을 준비하고 있어요. 지금은 아이디·비밀번호를 입력하지 않아도 돼요.</p> : null}
    {data?.enabled && !items.length ? <p className="text-muted-foreground text-sm">연결한 신한 계좌가 없어요.</p> : null}
    {items.map(item => <BankConnectionCard key={`${item.id}/${item.version}`} item={item} canManage={!summary && canManage} disabled={disabled} onRefresh={() => {
      if (item.canRefresh) void write({ kind: "refresh", id: item.id, version: item.version }, signal => authedFetch(token => bankConnectionsApi.refresh(token, item.id,
        { householdId, expectedVersion: item.version, requestId: crypto.randomUUID() }, userId, signal)));
    }} onDisconnect={() => { void write({ kind: "disconnect", id: item.id, version: item.version }, signal => authedFetch(token => bankConnectionsApi.disconnect(token, item.id,
      { householdId, expectedVersion: item.version }, userId, signal))); }} />)}
    {!summary && form && data?.enabled && canManage ? <BankRegistrationForm busy={busy} onSubmit={register} onClose={() => setForm(false)} /> : null}
    {!summary && data?.enabled && canManage && !form ? <Button className="min-h-12 w-full" disabled={disabled} onClick={openRegistration}>신한 계좌 연결</Button> : null}
    {!summary ? <Button variant="outline" className="min-h-11 w-full" disabled={busy || owned.isFetching} onClick={() => { void owned.reread(); }}>연결 상태 확인</Button> : null}
    {summary ? <Link href="/more/connections?provider=shinhan_bank" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">신한 연결 관리</Link> : <p className="text-muted-foreground text-xs leading-relaxed">자산·연결 화면을 열면 저장한 로그인 정보로 조회해요. 같은 은행 아이디의 로그인 간격은 최소 15분이에요. 앱을 닫아 둔 동안의 정기 조회는 설정하지 않아요.</p>}
  </section>;
}

export function BankConnectionCard({ item, canManage, disabled, onRefresh, onDisconnect }: {
  item: BankConnection; canManage: boolean; disabled: boolean; onRefresh: () => void; onDisconnect: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return <article aria-label="신한 계좌 연결 정보" className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{bankAccountLabel(item.selector)} · 끝 {item.selector.accountLast4}</h3><span className="text-xs text-muted-foreground">{BANK_STATUS[item.status]}</span></div>
    {item.errorCode ? <p role="status" className="rounded-lg bg-muted p-3 text-sm leading-relaxed">{BANK_ERROR[item.errorCode]}</p> : null}
    {item.snapshot ? <div className="space-y-2 border-t pt-3">
      {item.status !== "ready" ? <p className="text-xs text-muted-foreground">이전 조회 내역</p> : null}
      {item.snapshot.pageKind === "deposit_account_list" ? <>
        <p className="text-xs text-muted-foreground">통장 잔액</p><p className="break-all text-2xl font-semibold tabular-nums">{connectionDecimal(item.snapshot.balanceKrw)}원</p>
        <p className="text-xs text-muted-foreground">출금 가능 금액·대출 한도는 포함하지 않아요.</p>
      </> : <>
        <p className="text-xs text-muted-foreground">남은 원금</p><p className="break-all text-2xl font-semibold tabular-nums">{connectionDecimal(item.snapshot.outstandingPrincipalKrw)}원</p>
        <p className="text-sm">만기일 {item.snapshot.maturityDate ?? "미확인"}</p>
      </>}
      <p className="text-xs text-muted-foreground">화면 확인 {connectionTime(item.snapshot.capturedAt)} · 은행 잔액 기준일 미확인</p>
    </div> : <p className="text-sm text-muted-foreground">{'accountType' in item.selector ? '아직 조회한 잔액이 없어요.' : '아직 조회한 원금·만기일이 없어요.'}</p>}
    <p className="text-xs text-muted-foreground">마지막 조회 성공 {connectionTime(item.lastSuccessAt)}</p>
    <p className="text-xs leading-relaxed text-muted-foreground">본인에게만 표시해요. 기존 자산·가족 합계와 별도로 보관해 중복 합산을 막아요.</p>
    {canManage ? <div className="flex flex-wrap gap-2"><Button className="min-h-11 flex-1" disabled={disabled || !item.canRefresh} onClick={onRefresh}>새로 조회</Button><Button variant="outline" className="min-h-11" disabled={disabled} onClick={() => setConfirm(true)}>연결 해제</Button></div> : null}
    {confirm ? <div className="space-y-3 rounded-xl border p-3" role="group" aria-label="신한 연결 해제 확인"><p className="text-sm leading-relaxed">저장한 로그인 정보를 폐기하고 자동조회를 중단할까요? 이전 조회 기록은 보관되며 연결 화면에서 숨겨져요.</p><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={disabled} onClick={() => { setConfirm(false); onDisconnect(); }}>연결 해제</Button><Button variant="outline" onClick={() => setConfirm(false)}>취소</Button></div></div> : null}
  </article>;
}
