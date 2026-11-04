"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, ChevronRight, CreditCard, House, Plus } from "lucide-react";
import type {
  ManualAsset,
  ManualAssetKind,
  ManualFinanceScope,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState, Fab, StatusChip } from "@/components/widgets";
import { connectionMoney } from "@/components/finance-connections/model";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { useHouseholdMembers } from "@/lib/queries";
import { manualFinanceApi, useManualAssets } from "@/lib/manual-finance-client";
import { useFinancialOverview } from "@/lib/loan-import-client";
import { LoanOverviewRow } from "@/components/loan-import/loan-rows";
import { ConnectionScreen, type ConnectionSnapshot } from "@/components/finance-connections/connection-screen";
import { useUsdKrwReference } from "@/lib/fx-client";
import { assetBreakdown, toHoldings, type ConnectedHolding } from "@/lib/net-worth";
import { connectedAccountsKey, useConnectedAccounts } from "@/lib/connected-accounts-client";
import { ConnectedSharingPrompt } from "@/components/connected-sharing";
import { useQueryClient } from "@tanstack/react-query";
import { BankConnectionScreen } from "@/components/finance-connections/bank-screen";
import {
  ASSET_LABELS,
  ASSET_VALUE_LABELS,
  createManualSaveSession,
  displayManualKrw,
  hideManualSharedEditor,
  manualFinanceCanCreate,
  manualFinanceEditorContext,
  manualEditorUnavailable,
} from "@/components/manual-finance/model";
import {
  FinanceLoading,
  FinanceLoadError,
  LegacyPrivateNotice,
} from "@/components/manual-finance/shared";
import { ManualAssetsSummary } from "@/components/manual-finance/asset-summary";
import { AssetEditor } from "@/components/manual-finance/asset-editor";
import { AssetAddSheet } from "@/components/manual-finance/asset-add-choices";

/** 자산 목록 안의 연결 계좌 한 줄(본인 것 + 공유에 동의한 가족 것). 원화 환산 합계 + 통화별 내역. */
function HoldingRow({ holding, fxRate, fxDate }: { holding: ConnectedHolding; fxRate: string | null; fxDate: string | null }) {
  const parts =
    holding.provider === "toss_securities"
      ? [
          holding.krw !== null ? `국내 ${displayManualKrw(holding.krw)}` : null,
          holding.usd !== null ? `미국 ${connectionMoney(holding.usd, "USD")}` : null,
        ].filter(Boolean)
      : [`기준일 ${new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date(holding.observedAt))}`];
  parts.unshift(holding.ownerName);
  const href = holding.own ? `/more/connections?provider=${holding.provider}` : "/assets";
  return (
    <Link href={href} className="-mx-2 flex min-h-16 w-[calc(100%+1rem)] min-w-0 items-center justify-between gap-3 rounded-control px-2 py-3 hover:bg-muted/50">
      <span className="min-w-0 flex-1">
        <strong className="text-body block break-words font-semibold">{holding.label}</strong>
        <span className="text-caption text-muted-foreground block">{parts.join(" · ")}</span>
        {holding.stale ? <StatusChip className="mt-1">이전 조회</StatusChip> : null}
      </span>
      <span className="min-w-0 max-w-[55%] text-right">
        <strong className="text-heading block break-all tabular-nums">
          {holding.totalKrw === null ? "—" : displayManualKrw(holding.totalKrw.toString())}
        </strong>
        <small className="text-caption text-muted-foreground">
          {holding.usd !== null && holding.usdInKrw === null
            ? "환율 확인 중"
            : holding.usd !== null && fxRate && fxDate
            ? `$1 = ${Number(fxRate).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원 · ${fxDate.slice(5).replace("-", "/")}`
            : holding.kind === "loan"
            ? "남은 원금"
            : holding.kind === "account"
            ? "현재 잔액"
            : "현재 평가액"}
        </small>
      </span>
    </Link>
  );
}

const MANAGE_ROW =
  "text-body hover:bg-muted/50 flex min-h-14 items-center gap-3 px-5 font-medium";

function ScopedAssets({
  householdId,
  scope,
  canCreate,
}: {
  householdId: string;
  scope: ManualFinanceScope;
  canCreate: boolean;
}) {
  const records = useManualAssets(scope);
  const overview = useFinancialOverview(scope);
  const { authedFetch, user } = useAuth();
  const [kind, setKind] = useState<ManualAssetKind | "all">("all");
  const [editor, setEditor] = useState<ManualAsset | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();
  const connected = useConnectedAccounts();
  // 내 토스 연결은 이 화면을 열 때 새로 조회한다(ConnectionScreen headless). 새 값이 오면 가족 합산을 다시 읽는다.
  const onConnections = useCallback(
    (snapshot: ConnectionSnapshot) => {
      if (snapshot.data) void queryClient.invalidateQueries({ queryKey: connectedAccountsKey(householdId, user?.id ?? null) });
    },
    [queryClient, householdId, user?.id]
  );
  const fx = useUsdKrwReference();
  // 누구의 자산인지(§8): 명의자를 적었으면 명의자, 아니면 등록한 구성원 이름.
  const members = useHouseholdMembers();
  const nameByUser = new Map((members.data ?? []).map((member) => [member.userId, member.name]));
  const ownerOf = (item: { ownerUserId: string; legalOwnerLabel?: string | null }) =>
    item.legalOwnerLabel ?? nameByUser.get(item.ownerUserId) ?? null;
  // 연결 계좌는 따로 두지 않고 같은 목록·합계에 섞는다(§8). 본인 것 + 공유에 동의한 가족 것. 달러는 ECB 기준환율로 환산.
  const holdings = scope === "household" ? toHoldings(connected.data?.holdings, fx.data) : [];
  const readSession = useRef(createManualSaveSession());
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      readSession.current.invalidate();
    },
    []
  );
  const open = async (id: string) => {
    if (readSession.current.pending) return;
    setAddOpen(false);
    const controller = new AbortController();
    abort.current = controller;
    setOpening(id);
    setNotice(null);
    await readSession.current.run(
      () =>
        authedFetch((token) =>
          manualFinanceApi.asset(token, householdId, id, controller.signal)
        ),
      (read) => {
        setOpening(null);
        if (read.item.visibility !== scope) {
          setNotice("공개 범위가 바뀌었어요. 목록을 다시 확인해 주세요.");
          void records.refetch();
          return;
        }
        setEditor(read.item);
      },
      () => {
        setOpening(null);
        setNotice("자산 정보를 열지 못했어요. 목록에서 다시 선택해 주세요.");
        void records.refetch();
      }
    );
  };
  const items =
    overview.data?.manualItems.filter(
      (item) => kind === "all" || item.kind === kind
    ) ?? [];
  const importedLoans =
    kind === "all" || kind === "loan" ? overview.data?.loanItems ?? [] : [];
  const hasRecords = Boolean(
    overview.data &&
      (overview.data.manualItems.length || overview.data.loanItems.length || holdings.length)
  );
  const visibleHoldings = holdings.filter((holding) => kind === "all" || kind === holding.kind);
  const replacedManualIds = new Set(
    overview.data?.loanItems
      .filter(
        (item) => item.includedInTotals && item.totalMode === "replacement"
      )
      .map((item) => item.replacesManualAssetId) ?? []
  );
  const sharedCacheCleared = hideManualSharedEditor({
    item: editor && editor !== "new" ? editor : null,
    actorUserId: user?.id ?? null,
    pending: records.isPending,
    hasData: records.data !== undefined,
  });
  const editorIsUnavailable = Boolean(
    editor &&
      manualEditorUnavailable({
        error: records.error,
        id: editor === "new" ? null : editor.id,
        succeeded: records.isSuccess,
        refreshing: records.isFetching,
        visibleIds: records.data?.items.map((item) => item.id) ?? [],
        cacheCleared: sharedCacheCleared,
      })
  );
  useEffect(() => {
    if (editorIsUnavailable) {
      setEditor(null);
      setNotice(
        "자산의 공개 범위나 상태가 바뀌었어요. 목록을 다시 확인해 주세요."
      );
    }
  }, [editorIsUnavailable]);
  const openAdd = () => {
    if (opening !== null) return;
    setAddOpen(true);
  };
  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 space-y-6 pb-8">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h1 className="text-title">
          {scope === "household" ? "자산" : "비공개 자산"}
        </h1>

      </div>
      {canCreate ? (
        <Fab label="자산 추가" onClick={openAdd}>
          <Plus />
        </Fab>
      ) : null}
      {canCreate ? (
        <AssetAddSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          onManual={() => setEditor("new")}
        />
      ) : null}
      {scope === "private" ? <LegacyPrivateNotice href="/assets" /> : null}
      {!canCreate && scope === "household" ? (
        <p role="status" className="text-caption text-muted-foreground">
          현재 권한으로는 조회만 가능해요.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-body text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {overview.isPending ? (
        <FinanceLoading />
      ) : overview.isError ? (
        <FinanceLoadError
          retry={() => {
            void overview.refetch();
          }}
        />
      ) : overview.data ? (
        <>
          {hasRecords ? (
            <ManualAssetsSummary
              summary={overview.data.summary}
              scope={scope}
              holdings={holdings}
              breakdown={assetBreakdown(
                overview.data.manualItems.map((item) => ({ ...item, label: ownerOf(item) ? `${item.label} · ${ownerOf(item)}` : item.label })),
                overview.data.loanItems.map((item) => ({ ...item, label: ownerOf(item) ? `${item.label} · ${ownerOf(item)}` : item.label })),
                holdings
              )}
            />
          ) : null}
          {scope === "household" ? <ConnectedSharingPrompt /> : null}
          {overview.data.unresolvedLoans > 0 ? (
            <p role="status" className="text-caption text-warning-strong">
              확인이 필요한 대출 {overview.data.unresolvedLoans}건은 합계에서
              뺐어요.
            </p>
          ) : null}
          <section className="min-w-0 space-y-3" aria-label="자산 목록">
            {hasRecords ? (
              <div
                role="group"
                aria-label="자산 종류 필터"
                className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]"
              >
                {(
                  [["all", "전체"], ...Object.entries(ASSET_LABELS)] as Array<
                    [ManualAssetKind | "all", string]
                  >
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={`text-caption h-9 shrink-0 rounded-full px-4 font-semibold transition-colors ${
                      kind === value
                        ? "bg-foreground text-background"
                        : "bg-card text-muted-foreground hover:text-foreground"
                    }`}
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            {items.length || importedLoans.length || visibleHoldings.length ? (
              <div className="finance-panel min-w-0 px-5">
                {(
                  Object.entries(ASSET_LABELS) as Array<
                    [ManualAssetKind, string]
                  >
                ).map(([groupKind, groupLabel]) => {
                  const groupItems = items.filter(
                    (item) => item.kind === groupKind
                  );
                  const groupLoans = groupKind === "loan" ? importedLoans : [];
                  const groupHoldings = visibleHoldings.filter((holding) => holding.kind === groupKind);
                  if (!groupItems.length && !groupLoans.length && !groupHoldings.length) return null;
                  return (
                    <section
                      key={groupKind}
                      className="border-border/60 border-b last:border-0"
                      aria-label={`${groupLabel} 내역`}
                    >
                      <h3 className="text-caption text-muted-foreground pt-4">
                        {groupLabel} · {groupItems.length + groupLoans.length + groupHoldings.length}건
                      </h3>
                      {groupItems.map((item) => {
                        const replaced = replacedManualIds.has(item.id);
                        return (
                          <button
                            type="button"
                            key={item.id}
                            disabled={opening !== null}
                            className="focus-visible:ring-ring -mx-2 flex min-h-16 w-[calc(100%+1rem)] min-w-0 items-center justify-between gap-3 rounded-control px-2 py-3 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
                            onClick={() => void open(item.id)}
                            aria-label={`${item.label} 상세`}
                          >
                            <span className="min-w-0 flex-1">
                              <strong className="text-body block break-words font-semibold">
                                {item.label}
                              </strong>
                              <span className="text-caption text-muted-foreground block">
                                {ownerOf(item) ? `${ownerOf(item)} · ` : ""}기준일 {item.asOfDate ?? "미입력"}
                                {opening === item.id ? " · 여는 중" : ""}
                              </span>
                              {replaced ? (
                                <StatusChip className="mt-1">
                                  새 대출로 대체 · 합계 제외
                                </StatusChip>
                              ) : null}
                            </span>
                            <span className="min-w-0 max-w-[55%] text-right">
                              <strong
                                className={`block break-all tabular-nums ${
                                  replaced
                                    ? "text-body text-muted-foreground font-medium"
                                    : "text-heading"
                                }`}
                              >
                                {displayManualKrw(item.amount)}
                              </strong>
                              <small className="text-caption text-muted-foreground">
                                {ASSET_VALUE_LABELS[item.kind]}
                              </small>
                            </span>
                          </button>
                        );
                      })}
                      {groupLoans.map((item) => (
                        <LoanOverviewRow key={item.id} item={item} owner={ownerOf(item)} />
                      ))}
                      {groupHoldings.map((holding) => (
                        <HoldingRow key={holding.id} holding={holding} fxDate={fx.data?.asOfDate ?? null} fxRate={fx.data?.rate ?? null} />
                      ))}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="finance-panel">
                <EmptyState
                  icon={<Building2 />}
                  title={
                    !hasRecords
                      ? "등록된 자산이 없어요"
                      : "이 종류의 자산이 없어요"
                  }
                  description={
                    canCreate && !hasRecords
                      ? "통장 잔액이나 대출부터 기록해 보세요."
                      : undefined
                  }
                  action={
                    canCreate && !hasRecords ? (
                      <Button
                        className="w-full"
                        disabled={opening !== null}
                        onClick={openAdd}
                      >
                        자산 추가
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </section>
          {overview.isFetching ? (
            <p role="status" className="sr-only">
              자산 정보를 새로 불러오는 중이에요.
            </p>
          ) : null}
        </>
      ) : null}
      {scope === "household" && user ? (
        <ConnectionScreen
          key={`${user.id}/${householdId}/${canCreate}`}
          householdId={householdId}
          userId={user.id}
          canManage={canCreate}
          presentation="headless"
          onSnapshot={onConnections}
        />
      ) : null}
      {scope === "household" && user ? (
        <BankConnectionScreen
          key={`bank/${user.id}/${householdId}/${canCreate}`}
          householdId={householdId}
          userId={user.id}
          canManage={canCreate}
          summary
        />
      ) : null}
      <nav className="finance-panel overflow-hidden" aria-label="자산 관리">
        <Link href="/plan" className={MANAGE_ROW}>
          <House className="size-[22px] shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">주택 납부 일정</span>
          <ChevronRight
            className="text-muted-foreground/60 size-5 shrink-0"
            aria-hidden="true"
          />
        </Link>
        <Link href="/cards" className={MANAGE_ROW}>
          <CreditCard className="size-[22px] shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">결제 카드</span>
          <ChevronRight
            className="text-muted-foreground/60 size-5 shrink-0"
            aria-hidden="true"
          />
        </Link>
      </nav>
      {editor && !editorIsUnavailable && (editor !== "new" || canCreate) ? (
        <AssetEditor
          householdId={householdId}
          item={editor === "new" ? undefined : editor}
          observedVersion={
            editor !== "new"
              ? records.data?.items.find((item) => item.id === editor.id)
                  ?.version
              : undefined
          }
          onClose={() => setEditor(null)}
          onChanged={(saved) => {
            if (kind !== "all" && kind !== saved.kind) setKind(saved.kind);
            setEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}
function AssetsScreen() {
  const { householdId, activeMembership } = useHousehold();
  const { user } = useAuth();
  const params = useSearchParams();
  const scope: ManualFinanceScope =
    params.get("scope") === "private" ? "private" : "household";
  if (!householdId || !user)
    return (
      <EmptyState
        title="가족을 선택해 주세요"
        description="가족을 선택하면 자산 목록을 볼 수 있어요."
      />
    );
  return (
    <ScopedAssets
      key={manualFinanceEditorContext(
        user.id,
        householdId,
        scope,
        activeMembership?.role
      )}
      householdId={householdId}
      scope={scope}
      canCreate={manualFinanceCanCreate(activeMembership?.role, scope)}
    />
  );
}
export default function AssetsPage() {
  return (
    <Suspense fallback={<FinanceLoading />}>
      <AssetsScreen />
    </Suspense>
  );
}
