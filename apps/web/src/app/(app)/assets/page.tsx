"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, ChevronRight, CreditCard, HandCoins, House, PiggyBank, Plus, TrendingUp, Wallet } from "lucide-react";
import type {
  ManualAsset,
  ManualAssetKind,
  ManualFinanceScope,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState, Fab, StatusChip, type ChipTone } from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { useHouseholdMembers } from "@/lib/queries";
import { manualFinanceApi, useManualAssets } from "@/lib/manual-finance-client";
import { useFinancialOverview } from "@/lib/loan-import-client";
import { ConnectionScreen, type ConnectionSnapshot } from "@/components/finance-connections/connection-screen";
import { useUsdKrwReference } from "@/lib/fx-client";
import { assetBreakdown, toHoldings, type ConnectedHolding } from "@/lib/net-worth";
import { connectedAccountsKey, useConnectedAccounts } from "@/lib/connected-accounts-client";
import { ConnectedSharingPrompt } from "@/components/connected-sharing";
import { RefreshAllConnections } from "@/components/refresh-all-connections";
import { useQueryClient } from "@tanstack/react-query";
import { BankConnectionScreen } from "@/components/finance-connections/bank-screen";
import {
  ASSET_LABELS,
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

/**
 * 연결 계좌 부제의 금액 내역. 달러는 원화로 환산해 보여준다(§8).
 * 한쪽 통화만 있으면 금액을 되풀이하지 않고 '미국 주식'처럼 종류만 적는다.
 */
function holdingDetail(holding: ConnectedHolding): string | null {
  if (holding.provider !== "toss_securities") return null;
  const domestic = holding.krw !== null && holding.krw !== "0";
  if (holding.usd !== null && holding.usdInKrw === null) return "미국 주식 환율 확인 중";
  if (domestic && holding.usdInKrw !== null) {
    return `국내 ${displayManualKrw(holding.krw!)} · 미국 ${displayManualKrw(holding.usdInKrw.toString())}`;
  }
  return domestic ? "국내 주식" : holding.usdInKrw !== null ? "미국 주식" : null;
}

interface AssetRowData {
  key: string;
  title: string;
  subtitle: string;
  amount: bigint | null;
  /** 합계에 들어가는 행인지(소계 계산용). */
  counted: boolean;
  chip: [ChipTone, string] | null;
  onClick?: () => void;
  href?: string;
}

const KIND_ICON: Record<ManualAssetKind, { icon: typeof Wallet; tone: string }> = {
  account: { icon: Wallet, tone: "bg-chart-1/12 text-chart-1" },
  saving: { icon: PiggyBank, tone: "bg-chart-2/12 text-chart-2" },
  stock: { icon: TrendingUp, tone: "bg-chart-5/12 text-chart-5" },
  loan: { icon: HandCoins, tone: "bg-chart-4/12 text-chart-4" },
};

/** 자산 목록 한 줄(§8): 종류 아이콘 · 이름 · 주인 · 금액. 문제 있을 때만 칩을 붙인다. */
function AssetRow({ kind, row }: { kind: ManualAssetKind; row: AssetRowData }) {
  const { icon: Icon, tone } = KIND_ICON[kind];
  const body = (
    <>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tone}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-body block truncate font-semibold">{row.title}</span>
        <span className="text-caption text-muted-foreground block truncate">{row.subtitle}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className={`text-body tabular-nums ${row.counted ? "font-semibold" : "text-muted-foreground"}`}>
          {row.amount === null ? "미입력" : displayManualKrw(row.amount.toString())}
        </span>
        {row.chip ? <StatusChip tone={row.chip[0]}>{row.chip[1]}</StatusChip> : null}
      </span>
    </>
  );
  const className = "-mx-2 flex min-h-16 w-[calc(100%+1rem)] min-w-0 items-center gap-3 rounded-control px-2 py-2.5 text-left hover:bg-muted/50";
  if (row.href) return <Link href={row.href} className={className}>{body}</Link>;
  if (row.onClick) return <button type="button" onClick={row.onClick} className={className}>{body}</button>;
  return <div className={className}>{body}</div>;
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
        {scope === "household" && user ? <RefreshAllConnections householdId={householdId} userId={user.id} /> : null}

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
              <div className="finance-panel min-w-0 px-5 pb-2">
                {(
                  Object.entries(ASSET_LABELS) as Array<
                    [ManualAssetKind, string]
                  >
                ).map(([groupKind, groupLabel]) => {
                  const rows: AssetRowData[] = [
                    ...items
                      .filter((item) => item.kind === groupKind)
                      .map((item): AssetRowData => {
                        const replaced = replacedManualIds.has(item.id);
                        return {
                          key: item.id,
                          title: item.label,
                          subtitle: [ownerOf(item), opening === item.id ? "여는 중" : null].filter(Boolean).join(" · "),
                          amount: item.amount === null ? null : BigInt(item.amount),
                          counted: !replaced,
                          chip: replaced ? ["neutral", "합계 제외"] : null,
                          onClick: opening === null ? () => void open(item.id) : undefined,
                        };
                      }),
                    ...(groupKind === "loan" ? importedLoans : []).map((item): AssetRowData => ({
                      key: item.id,
                      title: item.label,
                      subtitle: [ownerOf(item), item.loanType === "jeonse" ? "전세 대출" : "중도금 대출"].filter(Boolean).join(" · "),
                      amount: BigInt(item.outstandingPrincipalKrw),
                      counted: item.includedInTotals,
                      chip: item.includedInTotals ? null : ["attention", "합계 제외"],
                      href: item.canEdit ? "/assets/loan-import" : undefined,
                    })),
                    ...visibleHoldings
                      .filter((holding) => holding.kind === groupKind)
                      .map((holding): AssetRowData => ({
                        key: holding.id,
                        title: holding.label,
                        // 달러는 원화로 환산해 보여준다(§8). 환율이 없으면 그렇다고 적는다.
                        subtitle: [holding.ownerName, holdingDetail(holding)].filter(Boolean).join(" · "),
                        amount: holding.totalKrw,
                        counted: true,
                        chip: holding.stale ? ["neutral", "이전 조회"] : null,
                        href: holding.own ? `/more/connections?provider=${holding.provider}` : undefined,
                      })),
                  ];
                  if (!rows.length) return null;
                  const subtotal = rows.reduce<bigint | null>(
                    (sum, row) => (row.counted && row.amount !== null ? (sum ?? 0n) + row.amount : sum),
                    null
                  );
                  return (
                    <section
                      key={groupKind}
                      className="border-border/60 border-b pb-1 last:border-0"
                      aria-label={`${groupLabel} 내역`}
                    >
                      <div className="flex items-baseline justify-between gap-3 pt-4 pb-1">
                        <h3 className="text-caption text-muted-foreground font-semibold">{groupLabel}</h3>
                        <span className="text-caption text-muted-foreground tabular-nums">
                          {subtotal === null ? "" : displayManualKrw(subtotal.toString())}
                        </span>
                      </div>
                      {rows.map((row) => (
                        <AssetRow key={row.key} kind={groupKind} row={row} />
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
