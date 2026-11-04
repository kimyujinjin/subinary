"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { FinanceConnection, FinanceConnectionList, FinanceConnectionResult } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/widgets/status-chip";
import { FinanceLoading } from "@/components/manual-finance/shared";
import { PageBackHeader } from "@/components/widgets/page-back-header";
import { useAuth } from "@/lib/auth-context";
import { financeConnectionsApi, useOwnedFinanceConnections } from "@/lib/finance-connections-client";
import { ConnectionCard } from "./connection-card";
import { ConnectionRegistrationForm, type ConnectionCredentials } from "./registration-form";
import { AssetConnectionsSummary } from "./asset-connections-summary";
import { canRefreshOnOpen, connectionFailureMessage, connectionFailureStatus, createConnectionSession, reconcileConnectionOperation, type ConnectionOperation } from "./model";

export function ConnectionScreen({ householdId, userId, canManage, presentation = "full" }: {
  householdId: string; userId: string; canManage: boolean; presentation?: "full" | "asset-summary" | "embedded";
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
    // Invalidation must discard visible values/input immediately, even if the GET fails offline.
    if (activeOperation.current) {
      uncertainRef.current = activeOperation.current;
      setUncertain(activeOperation.current);
    }
    activeOperation.current = null;
    session.invalidate();
    setData(null);
    setShowForm(false);
    setBusy(true);
    setNotice(null);
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
    if (owned.isFetching || owned.isPending) return;
    const opening = firstRead.current;
    firstRead.current = false;
    if (owned.error || !owned.data) {
      setData(null);
      setNotice(connectionFailureMessage(owned.error));
      setBusy(false);
      return;
    }
    const next = reconcileConnectionOperation(uncertainRef.current, owned.data.items);
    uncertainRef.current = next;
    setUncertain(next);
    setData(owned.data);
    setNotice(next ? "아직 요청 결과를 확인하지 못했어요. 연결 상태를 다시 확인해 주세요. 새로 연결하지 않아도 돼요." : null);
    setBusy(false);
    if (opening && !next) void refreshOnOpening(owned.data);
  }, [owned.data, owned.dataUpdatedAt, owned.error, owned.isFetching, owned.isPending, refreshOnOpening]);
  useEffect(() => () => { session.invalidate(); }, [session]);

  async function write(operation: ConnectionOperation, request: (signal: AbortSignal) => Promise<FinanceConnectionResult>) {
    if (session.pending || uncertainRef.current || !canManage) return;
    activeOperation.current = operation;
    setBusy(true);
    setNotice(null);
    await session.run(request, ({ item }) => {
      setData((current) => current ? { ...current, items: [...current.items.filter((entry) => entry.id !== item.id), item] } : current);
      setNotice(item.status === "disconnected" ? "연결을 해제했어요. 모아에서 더 이상 조회하지 않아요." : null);
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
  const items = data?.items.filter((item) => item.status !== "disconnected") ?? [];
  const pendingRegistration = items.some((item) => item.status === "connecting");
  if (presentation === "asset-summary") return <AssetConnectionsSummary data={data} busy={busy}
    loading={!data && (busy || owned.isPending)} notice={notice} uncertainId={uncertain?.id ?? null} />;
  const reread = <Button variant="weak" size="sm" disabled={busy || owned.isFetching} onClick={() => { void owned.reread(); }}>{busy ? "확인 중…" : "다시 확인"}</Button>;
  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-5 pb-8">
      {presentation !== "embedded" ? <PageBackHeader title="연결 관리" backHref="/more" /> : null}
      {notice ? <section role="alert" className="flex items-center justify-between gap-3">
        <p className="text-caption text-muted-foreground">{notice}{uncertain ? " 결과가 확인될 때까지 새 요청은 보내지 않아요." : ""}</p>
        {reread}
      </section> : null}
      {!data && (busy || owned.isPending) ? <FinanceLoading /> : null}
      {data && !data.enabled ? <section role="status" className="finance-panel flex items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <h2 className="text-heading">연결 준비 중이에요</h2>
          <p className="text-caption text-muted-foreground mt-1">운영자 설정이 끝나면 연결할 수 있어요.</p>
        </div>
        <StatusChip tone="pending">준비 중</StatusChip>
      </section> : null}
      {data && !canManage ? <p className="text-caption text-muted-foreground">현재 가족에서는 조회만 할 수 있어요.</p> : null}
      {data?.enabled && items.length === 0 && !showForm ? <section className="finance-panel p-5">
        <h2 className="text-heading">연결한 계좌가 없어요</h2>
        <p className="text-caption text-muted-foreground mt-1">본인 명의 토스증권 계좌만 연결할 수 있어요.</p>
      </section> : null}
      {items.map((item) => <ConnectionCard key={`${item.id}/${item.version}`} item={item} disabled={busy || !!uncertain} unconfirmed={uncertain?.id === item.id} canManage={canManage} enabled={!!data?.enabled}
        onSelect={(accountId) => selectAccount(item, accountId)} onRefresh={() => refresh(item)} onDisconnect={() => disconnect(item)} />)}
      {!notice && items.some((item) => item.status === "connecting" || item.status === "refreshing") ? <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-muted-foreground">처리 중이에요.</p>{reread}
      </div> : null}
      {showForm && data?.enabled && canManage ? <ConnectionRegistrationForm busy={busy} onSubmit={register} onClose={() => { setShowForm(false); }} /> : null}
      {data?.enabled && canManage && !showForm ? <Button size="lg" className="w-full" disabled={busy || !!uncertain || pendingRegistration} onClick={() => setShowForm(true)}><Plus aria-hidden="true" />토스증권 연결</Button> : null}
    </div>
  );
}
