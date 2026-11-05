"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { FinanceConnection, FinanceConnectionList, FinanceConnectionResult } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { FinanceLoading } from "@/components/manual-finance/shared";
import { useAuth } from "@/lib/auth-context";
import { financeConnectionsApi, useOwnedFinanceConnections } from "@/lib/finance-connections-client";
import { ConnectionCard } from "./connection-card";
import { ConnectionRegistrationForm, type ConnectionCredentials } from "./registration-form";
import { canRefreshOnOpen, connectionFailureMessage, connectionFailureStatus, connectionListDuringRead, createConnectionSession, reconcileConnectionOperation, registrationFormVisible, type ConnectionOperation } from "./model";

/** 연결 해제가 끝났을 때의 안내 — 이것만 완료(success)이고 나머지 안내는 모두 실패·미확인이다. */
const DISCONNECTED_NOTICE = "연결을 해제했어요. 모아에서 더 이상 조회하지 않아요.";

/** headless 모드에서 부모(자산 목록)가 받는 값. 읽기·권한 확인·열 때 조회는 여전히 이 화면이 소유한다. */
export interface ConnectionSnapshot {
  /** 확인이 끝난 목록. 다시 읽거나 새로 조회하는 동안(busy)은 null이다 — 부모는 새 값이 왔을 때만 반응하면 된다. */
  data: FinanceConnectionList | null;
  loading: boolean;
  busy: boolean;
  notice: string | null;
  uncertainId: string | null;
}

/**
 * `embedded`는 기관 상세(토스증권) 본문, `headless`는 자산 화면이 열 때 조회만 맡기는 모드다.
 *
 * 결과 안내는 카드 목록 바로 아래, 연결 추가 버튼 바로 위 한 자리에 둔다(InlineNotice — 실패는 role="alert",
 * 완료는 role="status"). 예전에는 화면 맨 위 회색 한 줄이라 누른 버튼에서 멀고 성공·실패가 같은 모양이었다.
 * 채움 버튼은 한 화면에 하나: 연결이 없으면 '토스증권 연결하기', 있으면 카드 한 장의 다음 행동(primaryCardId)이고
 * '연결 추가하기'는 약한 버튼이다.
 */
export function ConnectionScreen({ householdId, userId, canManage, presentation = "embedded", onSnapshot }: {
  householdId: string; userId: string; canManage: boolean; presentation?: "embedded" | "headless";
  onSnapshot?: (snapshot: ConnectionSnapshot) => void;
}) {
  const { authedFetch } = useAuth();
  const session = useRef(createConnectionSession()).current;
  const [data, setData] = useState<FinanceConnectionList | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [uncertain, setUncertain] = useState<ConnectionOperation | null>(null);
  const uncertainRef = useRef<ConnectionOperation | null>(null);
  const activeOperation = useRef<ConnectionOperation | null>(null);
  const firstRead = useRef(true);

  const beforeRead = useCallback(() => {
    // 목록·안내·열린 등록 폼은 그대로 둔다 — 읽는 동안에는 쓰기만 막고(busy), 읽기가 실패하면 그때
    // 비운다(connectionListDuringRead·registrationFormVisible). 진행 중이던 요청은 결과 미확인으로 남긴다.
    if (activeOperation.current) {
      uncertainRef.current = activeOperation.current;
      setUncertain(activeOperation.current);
    }
    activeOperation.current = null;
    session.invalidate();
    setBusy(true);
  }, [session]);
  const owned = useOwnedFinanceConnections(householdId, userId, beforeRead);

  const refreshOnOpening = useCallback(async (list: FinanceConnectionList) => {
    if (session.pending || uncertainRef.current || !canManage || !list.enabled) return;
    setBusy(true);
    await session.run(async (signal) => {
      // Both presentations share this one opening controller: no separate refresh or polling.
      let updatedList = list;
      for (const item of list.items) {
        if (!canRefreshOnOpen(item)) continue;
        const operation: ConnectionOperation = { kind: "refresh", id: item.id, version: item.version };
        activeOperation.current = operation;
        const body = { householdId, expectedVersion: item.version, requestId: crypto.randomUUID() };
        try {
          const updated = await authedFetch((token) => financeConnectionsApi.refresh(token, item.id, body, userId, signal));
          updatedList = { ...updatedList, items: updatedList.items.map((entry) => entry.id === item.id ? updated.item : entry) };
        } catch (error) {
          signal.throwIfAborted();
          const status = connectionFailureStatus(error);
          if (status === 401 || status === 403 || status === 404) throw error;
          return { list: updatedList, failed: operation, message: connectionFailureMessage(error) };
        } finally {
          if (activeOperation.current === operation) activeOperation.current = null;
        }
      }
      return { list: updatedList, failed: null, message: null };
    }, ({ list: updated, failed, message }) => {
      setData(updated);
      uncertainRef.current = failed;
      setUncertain(failed);
      setNotice(message);
      setBusy(false);
    }, (error) => {
      const status = connectionFailureStatus(error);
      if (status === 401 || status === 403 || status === 404) setData(null);
      setNotice(connectionFailureMessage(error));
      setBusy(false);
      if (status === 403 || status === 404) void owned.reread();
    });
  }, [authedFetch, canManage, householdId, owned.reread, session, userId]);

  useEffect(() => {
    const list = owned.error ? undefined : owned.data;
    const reading = owned.isFetching || owned.isPending;
    setData((last) => connectionListDuringRead(last, { reading, failed: !list, data: list ?? null }));
    if (reading) return;
    const opening = firstRead.current;
    firstRead.current = false;
    if (!list) {
      setShowForm(false);
      setNotice(connectionFailureMessage(owned.error));
      setBusy(false);
      return;
    }
    const next = reconcileConnectionOperation(uncertainRef.current, list.items);
    uncertainRef.current = next;
    setUncertain(next);
    if (!list.enabled || next) setShowForm(false);
    setNotice(next ? "아직 요청 결과를 확인하지 못했어요. 연결 상태를 다시 확인해 주세요. 새로 연결하지 않아도 돼요." : null);
    setBusy(false);
    if (opening && !next) void refreshOnOpening(list);
  }, [owned.data, owned.dataUpdatedAt, owned.error, owned.isFetching, owned.isPending, refreshOnOpening]);
  useEffect(() => () => { session.invalidate(); }, [session]);

  async function write(operation: ConnectionOperation, request: (signal: AbortSignal) => Promise<FinanceConnectionResult>) {
    if (session.pending || uncertainRef.current || !canManage) return;
    activeOperation.current = operation;
    setBusy(true);
    setNotice(null);
    await session.run(request, ({ item }) => {
      setData((current) => current ? { ...current, items: [...current.items.filter((entry) => entry.id !== item.id), item] } : current);
      setNotice(item.status === "disconnected" ? DISCONNECTED_NOTICE : null);
      setBusy(false);
    }, (error) => {
      const status = connectionFailureStatus(error);
      if (!status || status === 408 || status >= 500) {
        uncertainRef.current = operation;
        setUncertain(operation);
      }
      if (activeOperation.current === operation) activeOperation.current = null;
      if (status === 401 || status === 403 || status === 404) setData(null);
      setNotice(connectionFailureMessage(error));
      setBusy(false);
      if (status === 403 || status === 404) void owned.reread();
    });
    if (activeOperation.current === operation) activeOperation.current = null;
  }

  async function register(credentials: ConnectionCredentials) {
    if (!data?.enabled || session.pending || uncertainRef.current || !canManage) return;
    const connectionId = crypto.randomUUID();
    setShowForm(false);
    const body = { householdId, connectionId, ...credentials, consent: { ownAccount: true, storeCredentials: true, refreshOnOpen: true } } as const;
    try {
      await write({ kind: "register", id: connectionId, version: 0 }, (signal) =>
        authedFetch((token) => financeConnectionsApi.register(token, body, userId, signal)));
    } finally {
      // The form also clears its input nodes before the request begins.
      Object.assign(body, { clientId: "", clientSecret: "" });
    }
  }

  function selectAccount(item: FinanceConnection, accountId: string) {
    if (!item.accountOptions.some((account) => account.id === accountId)) return;
    void write({ kind: "account", id: item.id, version: item.version }, async (signal) => {
      const selected = await authedFetch((token) => financeConnectionsApi.selectAccount(token, item.id, {
        householdId, expectedVersion: item.version, accountId,
      }, userId, signal));
      if (!selected.item.canRefresh) return selected;
      const body = {
        householdId, expectedVersion: selected.item.version, requestId: crypto.randomUUID(),
      };
      return authedFetch((token) => financeConnectionsApi.refresh(token, item.id, body, userId, signal));
    });
  }
  function refresh(item: FinanceConnection) {
    if (!item.canRefresh) return;
    const body = { householdId, expectedVersion: item.version, requestId: crypto.randomUUID() };
    void write({ kind: "refresh", id: item.id, version: item.version }, (signal) =>
      authedFetch((token) => financeConnectionsApi.refresh(token, item.id, body, userId, signal)));
  }
  function disconnect(item: FinanceConnection) {
    void write({ kind: "disconnect", id: item.id, version: item.version }, (signal) =>
      authedFetch((token) => financeConnectionsApi.disconnect(token, item.id, {
        householdId, expectedVersion: item.version,
      }, userId, signal)));
  }
  const settled = busy ? null : data;
  const snapshotLoading = !settled && (busy || owned.isPending);
  const uncertainId = uncertain?.id ?? null;
  useEffect(() => {
    if (presentation === "headless") onSnapshot?.({ data: settled, loading: snapshotLoading, busy, notice, uncertainId });
  }, [presentation, onSnapshot, settled, snapshotLoading, busy, notice, uncertainId]);
  if (presentation === "headless") return null;
  const items = data?.items.filter((item) => item.status !== "disconnected") ?? [];
  const pendingRegistration = items.some((item) => item.status === "connecting");
  // 화면의 채움 버튼을 받을 카드: 계좌를 고를 차례인 카드가 먼저, 없으면 조회하는 첫 카드.
  // 등록 폼이 열려 있으면 그 폼의 '동의하고 연결하기'가 주 버튼이라 카드는 모두 약한 버튼이다.
  const primaryCardId = showForm ? null : (items.find((item) => !item.selectedAccountId && item.status === "select_account") ?? items.find((item) => item.selectedAccountId))?.id ?? null;
  const reread = <Button variant="weak" disabled={busy || owned.isFetching} onClick={() => { void owned.reread(); }}>{busy ? "확인 중…" : "다시 확인하기"}</Button>;
  const success = notice === DISCONNECTED_NOTICE;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {!data && !showForm && (busy || owned.isPending) ? <FinanceLoading /> : null}
      {/* 제목이 이미 상태를 말하므로 '준비 중' 칩을 덧붙이지 않는다. */}
      {data && !data.enabled ? <section role="status" className="finance-panel p-5">
        <h2 className="text-heading">연결 준비 중이에요</h2>
        <p className="text-caption text-muted-foreground mt-1">준비가 끝나면 여기서 연결할 수 있어요.</p>
      </section> : null}
      {data && !canManage ? <p className="text-caption text-muted-foreground">현재 가족에서는 조회만 할 수 있어요.</p> : null}
      {data?.enabled && items.length === 0 && !showForm ? <section className="finance-panel p-5">
        <h2 className="text-heading">연결한 계좌가 없어요</h2>
        <p className="text-caption text-muted-foreground mt-1">본인 명의 토스증권 계좌만 연결할 수 있어요.</p>
      </section> : null}
      {items.map((item) => <ConnectionCard key={`${item.id}/${item.version}`} item={item} disabled={busy || !!uncertain} unconfirmed={uncertain?.id === item.id} canManage={canManage} enabled={!!data?.enabled} primary={item.id === primaryCardId}
        onSelect={(accountId) => selectAccount(item, accountId)} onRefresh={() => refresh(item)} onDisconnect={() => disconnect(item)} />)}
      {notice ? <div className="flex flex-col items-start gap-2">
        <InlineNotice tone={success ? "success" : "error"} className="w-full">{notice}{uncertain ? " 결과가 확인될 때까지 새 요청은 보내지 않아요." : ""}</InlineNotice>
        {success ? null : reread}
      </div> : null}
      {!notice && items.some((item) => item.status === "connecting" || item.status === "refreshing") ? <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-muted-foreground">처리 중이에요.</p>{reread}
      </div> : null}
      {registrationFormVisible({ open: showForm, canManage, data, busy }) ? <ConnectionRegistrationForm busy={busy} onSubmit={register} onClose={() => { setShowForm(false); }} /> : null}
      {data?.enabled && canManage && !showForm ? <Button size="lg" variant={items.length > 0 ? "weak" : "default"} className="w-full" disabled={busy || !!uncertain || pendingRegistration} onClick={() => setShowForm(true)}><Plus aria-hidden="true" />{items.length > 0 ? "연결 추가하기" : "토스증권 연결하기"}</Button> : null}
    </div>
  );
}
