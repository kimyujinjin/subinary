"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, CreditCard, Plus } from "lucide-react";
import type {
  ManualAsset,
  ManualAssetKind,
  ManualFinanceScope,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { manualFinanceApi, useManualAssets } from "@/lib/manual-finance-client";
import {
  ASSET_LABELS,
  ASSET_VALUE_LABELS,
  createManualSaveSession,
  displayManualKrw,
  hideManualSharedEditor,
  manualFinanceCanCreate,
  manualFinanceEditorContext,
  manualEditorUnavailable,
  visibilityLabel,
} from "@/components/manual-finance/model";
import {
  FinanceLoading,
  FinanceLoadError,
  FinanceScopeTabs,
} from "@/components/manual-finance/shared";
import { ManualAssetsSummary } from "@/components/manual-finance/asset-summary";
import { AssetEditor } from "@/components/manual-finance/asset-editor";

function ScopedAssets({
  householdId,
  scope,
  changeScope,
  canCreate,
}: {
  householdId: string;
  scope: ManualFinanceScope;
  changeScope: (scope: ManualFinanceScope) => void;
  canCreate: boolean;
}) {
  const records = useManualAssets(scope);
  const { authedFetch, user } = useAuth();
  const [kind, setKind] = useState<ManualAssetKind | "all">("all");
  const [editor, setEditor] = useState<ManualAsset | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
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
          setNotice(
            "공개 범위가 바뀌었어요. 현재 범위의 목록을 다시 확인해 주세요."
          );
          void records.refetch();
          return;
        }
        setEditor(read.item);
      },
      () => {
        setOpening(null);
        setNotice(
          "기록을 열 수 없어요. 권한과 연결 상태를 확인한 뒤 다시 열어 주세요."
        );
        void records.refetch();
      }
    );
  };
  const items =
    records.data?.items.filter(
      (item) => kind === "all" || item.kind === kind
    ) ?? [];
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
        "기록의 공개 범위나 상태가 바뀌어 상세를 닫았어요. 현재 목록을 다시 확인해 주세요."
      );
    }
  }, [editorIsUnavailable]);
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">자산</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            직접 기록한 현재값과 기준일을 함께 봐요.
          </p>
        </div>
        {canCreate ? (
          <Button
            className="min-h-11 shrink-0"
            disabled={opening !== null}
            onClick={() => setEditor("new")}
          >
            <Plus className="size-4" />
            기록
          </Button>
        ) : null}
      </div>
      <FinanceScopeTabs value={scope} onChange={changeScope} />
      {!canCreate ? (
        <p role="status" className="text-muted-foreground text-sm">
          조회 전용 구성원은 수동 기록을 조회만 할 수 있어요. 새 기록
          생성·수정·삭제는 할 수 없어요.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-muted-foreground text-sm">
          {notice}
        </p>
      ) : null}
      {records.isPending ? (
        <FinanceLoading />
      ) : records.isError ? (
        <FinanceLoadError
          retry={() => {
            void records.refetch();
          }}
        />
      ) : records.data ? (
        <>
          <ManualAssetsSummary summary={records.data.summary} scope={scope} />
          <div
            role="group"
            aria-label="자산 종류 필터"
            className="flex flex-wrap gap-2"
          >
            {(
              [["all", "전체"], ...Object.entries(ASSET_LABELS)] as Array<
                [ManualAssetKind | "all", string]
              >
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={kind === value ? "default" : "outline"}
                className="min-h-11"
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <section
            className="min-w-0 rounded-xl border"
            aria-label="수동 자산 기록 목록"
          >
            {items.length ? (
              items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  disabled={opening !== null}
                  className="hover:bg-muted/50 flex min-h-20 w-full min-w-0 items-start justify-between gap-3 border-b p-4 text-left last:border-0 disabled:opacity-60"
                  onClick={() => void open(item.id)}
                  aria-label={`${item.label} 상세`}
                >
                  <span className="min-w-0 flex-1">
                    <strong className="block break-words text-sm">
                      {item.label}
                    </strong>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {ASSET_LABELS[item.kind]} ·{" "}
                      {visibilityLabel(item.visibility)}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      기준일 {item.asOfDate ?? "미입력"} ·{" "}
                      {item.source === "manual" ? "직접 입력" : "출처 미입력"}
                    </span>
                  </span>
                  <span className="min-w-0 max-w-[52%] text-right">
                    <strong className="block break-all text-base tabular-nums">
                      {displayManualKrw(item.amount)}
                    </strong>
                    <small className="text-muted-foreground text-xs">
                      {ASSET_VALUE_LABELS[item.kind]}
                      {opening === item.id ? " · 확인 중" : ""}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <EmptyState
                icon={<Building2 />}
                title={
                  kind === "all"
                    ? "이 범위에 표시할 자산 기록이 없어요"
                    : "선택한 종류의 기록이 없어요"
                }
                description={
                  canCreate
                    ? "직접 확인한 잔액·평가액·남은 원금을 기준일과 함께 기록할 수 있어요. 모르는 값은 빈칸으로 남겨요."
                    : "현재 보기 범위에 표시할 기록이 없어요. 조회 전용 구성원은 새 기록을 만들 수 없어요."
                }
                action={
                  canCreate ? (
                    <Button
                      className="min-h-11 w-full"
                      disabled={opening !== null}
                      onClick={() => setEditor("new")}
                    >
                      자산 직접 기록
                    </Button>
                  ) : undefined
                }
              />
            )}
          </section>
          {records.isFetching ? (
            <p role="status" className="text-muted-foreground text-xs">
              현재 기록을 다시 확인하고 있어요.
            </p>
          ) : null}
        </>
      ) : null}
      {opening ? (
        <p role="status" className="text-muted-foreground text-sm">
          현재 기록의 공개 범위와 권한을 확인하고 있어요.
        </p>
      ) : null}
      <Link
        href="/cards"
        className="hover:bg-muted/50 flex min-h-14 items-center gap-3 rounded-xl border p-4 text-sm font-medium"
      >
        <CreditCard className="size-5" />
        결제 카드 관리
        <span className="text-muted-foreground ml-auto">기존 카드 →</span>
      </Link>
      <p className="text-muted-foreground text-xs leading-relaxed">
        입력한 기록의 합계예요. 카드 한도·주택 계약금액·적금 만기 예상액을
        자산으로 더하지 않아요. 계좌 연결·주식 거래·외화 자동 환산은 제공하지
        않아요.
      </p>
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
          onChanged={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
function AssetsScreen() {
  const { householdId, activeMembership } = useHousehold();
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const scope: ManualFinanceScope =
    params.get("scope") === "private" ? "private" : "household";
  if (!householdId || !user)
    return (
      <EmptyState
        title="가족을 선택해 주세요"
        description="현재 가족의 허용된 수동 기록만 확인할 수 있어요."
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
      canCreate={manualFinanceCanCreate(activeMembership?.role)}
      changeScope={(next) =>
        router.replace(`/assets?scope=${next}`, { scroll: false })
      }
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
