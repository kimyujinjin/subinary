"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, Check, ChevronRight, CircleAlert, CreditCard, House, Plus } from "lucide-react";
import type {
  ManualAsset,
  ManualAssetKind,
  ManualFinanceScope,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Fab, InlineNotice, ListRow, type NoticeTone } from "@/components/widgets";
import { FilterChip } from "@/components/widgets/filter-chip";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { useHouseholdMembers } from "@/lib/queries";
import { manualFinanceApi, useManualAssets } from "@/lib/manual-finance-client";
import { useFinancialOverview } from "@/lib/loan-import-client";
import { ConnectionScreen, type ConnectionSnapshot } from "@/components/finance-connections/connection-screen";
import { useUsdKrwReference } from "@/lib/fx-client";
import { toHoldings, type ConnectedHolding } from "@/lib/net-worth";
import { connectedAccountsKey, useConnectedAccounts } from "@/lib/connected-accounts-client";
import { ConnectedSharingPrompt } from "@/components/connected-sharing";
import { RefreshAllConnections } from "@/components/refresh-all-connections";
import { useQueryClient } from "@tanstack/react-query";
import {
  ASSET_LABELS,
  createManualSaveSession,
  displayManualKrw,
  hideManualSharedEditor,
  manualFinanceCanCreate,
  manualFinanceEditorContext,
  manualEditorUnavailable,
  savingsPlanLine,
} from "@/components/manual-finance/model";
import {
  FinanceLoading,
  LegacyPrivateNotice,
} from "@/components/manual-finance/shared";
import { ManualAssetsSummary } from "@/components/manual-finance/asset-summary";
import { AssetEditor } from "@/components/manual-finance/asset-editor";
import { AssetAddSheet } from "@/components/manual-finance/asset-add-choices";
import {
  holdingChip,
  importedLoanChip,
  importedLoanHref,
  LOAN_RECORDS_HREF,
  REPLACED_MANUAL_CHIP,
  unresolvedImportedLoans,
} from "./asset-rows";
import { AssetRow, type AssetRowData } from "./asset-row";

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

const MANAGE_ROW =
  "text-body hover:bg-muted/50 flex min-h-14 items-center gap-3 px-5 font-medium active:bg-muted";

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
  const [notice, setNotice] = useState<[NoticeTone, string] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();
  const connected = useConnectedAccounts();
  // 아직 값이 없는 토스 연결도 '다시 조회'할 내 연결이다(값이 있으면 holdings에도 잡힌다).
  const [ownToss, setOwnToss] = useState(false);
  // 내 토스 연결은 이 화면을 열 때 새로 조회한다(ConnectionScreen headless). 새 값이 오면 가족 합산을 다시 읽는다.
  const onConnections = useCallback(
    (snapshot: ConnectionSnapshot) => {
      if (!snapshot.data) return;
      setOwnToss(
        snapshot.data.items.some(
          (item) => item.status !== "disconnected" && item.selectedAccountId !== null
        )
      );
      void queryClient.invalidateQueries({ queryKey: connectedAccountsKey(householdId, user?.id ?? null) });
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
          setNotice(["info", "공개 범위가 바뀌었어요. 목록을 다시 확인해 주세요."]);
          void records.refetch();
          return;
        }
        setEditor(read.item);
      },
      () => {
        setOpening(null);
        setNotice(["error", "자산 정보를 열지 못했어요. 목록에서 다시 선택해 주세요."]);
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
      setNotice([
        "info",
        "자산의 공개 범위나 상태가 바뀌었어요. 목록을 다시 확인해 주세요.",
      ]);
    }
  }, [editorIsUnavailable]);
  const openAdd = () => {
    if (opening !== null) return;
    setAddOpen(true);
  };
  const unresolvedLoans = unresolvedImportedLoans(overview.data?.loanItems ?? []);
  // 가져온 대출 기록 화면은 내가 저장한 기록만 보여 주고 고칠 수 있다 — 가족이 가져온 것만 남았으면 보낼 곳이 없다.
  const unresolvedEditable = unresolvedLoans.some((item) => item.canEdit);
  return (
    // 섹션 사이 간격은 홈과 같은 16px(gap-4). 모바일에서는 그 아래 10px 회색 띠가 섹션을 나눈다.
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-4 pb-8">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h1 className="text-title">
          {scope === "household" ? "자산" : "비공개 자산"}
        </h1>
        {scope === "household" && user ? (
          <RefreshAllConnections
            householdId={householdId}
            userId={user.id}
            hasOwnConnection={ownToss || holdings.some((holding) => holding.own)}
          />
        ) : null}
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
      {notice ? <InlineNotice tone={notice[0]}>{notice[1]}</InlineNotice> : null}
      {overview.isPending ? (
        <FinanceLoading />
      ) : overview.isError ? (
        <div className="finance-panel px-5">
          <ErrorState
            message="자산 목록을 불러오지 못했어요."
            onRetry={() => {
              void overview.refetch();
            }}
            retrying={overview.isFetching}
          />
        </div>
      ) : overview.data ? (
        <>
          {hasRecords ? (
            <ManualAssetsSummary
              summary={overview.data.summary}
              scope={scope}
              holdings={holdings}
              hasImportedBalance={overview.data.loanItems.some((item) => item.includedInTotals)}
              hasUncountedRecords={overview.data.loanItems.length > 0}
              unresolvedLoans={overview.data.unresolvedLoans}
            />
          ) : null}
          {scope === "household" ? <ConnectedSharingPrompt /> : null}
          {overview.data.unresolvedLoans > 0 ? (
            // 무엇을 왜 뺐는지·어디서 고치는지 알 수 있게 가져온 대출 기록 화면으로 보낸다(원인 + 할 일).
            <div className="finance-panel min-w-0 px-5">
              <ListRow
                icon={<CircleAlert aria-hidden="true" />}
                iconClassName="bg-warning/10 text-warning-strong"
                title={`확인이 필요한 대출 ${overview.data.unresolvedLoans}건`}
                subtitle={
                  unresolvedEditable
                    ? "합계에서 뺐어요 · 가져온 대출 기록에서 고칠 수 있어요"
                    : "합계에서 뺐어요 · 가져온 가족이 고칠 수 있어요"
                }
                href={unresolvedEditable ? LOAN_RECORDS_HREF : undefined}
                chevron={unresolvedEditable}
                className="-mx-2 w-[calc(100%+1rem)] px-2"
              />
            </div>
          ) : null}
          {/* 종류 칩은 자기 목록과 같은 섹션 안에 둔다 — 밖에 두면 회색 띠가 칩과 목록을 갈랐다. */}
          <section className="finance-panel min-w-0 px-5 pb-2" aria-label="자산 목록">
            {hasRecords ? (
              <div
                role="group"
                aria-label="자산 종류"
                className="-mx-5 flex gap-2 overflow-x-auto px-5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {(
                  [["all", "전체"], ...Object.entries(ASSET_LABELS)] as Array<
                    [ManualAssetKind | "all", string]
                  >
                ).map(([value, label]) => (
                  // 고른 칩은 색과 체크가 함께 말한다 — 색만 바뀌면 색을 구분하기 어려운 사람에게 안 보인다(가계부·가맹점 칩과 같다).
                  <FilterChip
                    key={value}
                    active={kind === value}
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                  >
                    {kind === value ? (
                      <Check aria-hidden="true" className="-ml-0.5 mr-0.5 inline size-3.5 align-[-2px]" />
                    ) : null}
                    {label}
                  </FilterChip>
                ))}
              </div>
            ) : null}
            {items.length || importedLoans.length || visibleHoldings.length ? (
              <>
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
                          subtitle: [ownerOf(item), savingsPlanLine(item.savingsPlan), opening === item.id ? "여는 중" : null].filter(Boolean).join(" · "),
                          amount: item.amount === null ? null : BigInt(item.amount),
                          counted: !replaced,
                          chip: replaced ? REPLACED_MANUAL_CHIP : null,
                          // 여는 중에도 다른 줄의 ›를 지우지 않는다 — 겹친 요청은 open()이 막는다.
                          onClick: () => void open(item.id),
                        };
                      }),
                    ...(groupKind === "loan" ? importedLoans : []).map((item): AssetRowData => ({
                      key: item.id,
                      title: item.label,
                      subtitle: [ownerOf(item), item.loanType === "jeonse" ? "전세 대출" : "중도금 대출"].filter(Boolean).join(" · "),
                      amount: BigInt(item.outstandingPrincipalKrw),
                      counted: item.includedInTotals,
                      chip: importedLoanChip(item),
                      href: importedLoanHref(item),
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
                        emptyText: "확인 중",
                        chip: holdingChip(holding),
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
              </>
            ) : (
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
                  // 채움 버튼은 화면에 하나 — 오른쪽 아래 + 버튼(FAB)이 주 행동이라 여기는 약한 버튼이다.
                  canCreate && !hasRecords ? (
                    <Button
                      variant="weak"
                      className="w-full"
                      disabled={opening !== null}
                      onClick={openAdd}
                    >
                      자산 추가하기
                    </Button>
                  ) : undefined
                }
              />
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
      <nav className="finance-panel overflow-hidden" aria-label="자산 관리">
        <Link href="/plan" className={MANAGE_ROW}>
          <House className="size-[22px] shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">주택 납부 일정</span>
          <ChevronRight
            className="text-muted-foreground/70 size-5 shrink-0"
            aria-hidden="true"
          />
        </Link>
        <Link href="/cards" className={MANAGE_ROW}>
          <CreditCard className="size-[22px] shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">결제 카드</span>
          <ChevronRight
            className="text-muted-foreground/70 size-5 shrink-0"
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
