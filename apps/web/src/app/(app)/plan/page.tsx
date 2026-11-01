"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { House, Plus } from "lucide-react";
import type {
  ManualFinanceScope,
  ManualHousingPlanResponse,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import {
  manualFinanceApi,
  useManualHousingPlans,
} from "@/lib/manual-finance-client";
import {
  createManualSaveSession,
  displayManualKrw,
  hideManualSharedEditor,
  manualFinanceCanCreate,
  manualFinanceEditorContext,
  manualEditorUnavailable,
  PAYMENT_LABELS,
  visibilityLabel,
} from "@/components/manual-finance/model";
import {
  FinanceLoading,
  FinanceLoadError,
  FinanceScopeTabs,
} from "@/components/manual-finance/shared";
import { PlanEditor } from "@/components/manual-finance/plan-editor";

function ScopedPlans({
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
  const records = useManualHousingPlans(scope);
  const { authedFetch, user } = useAuth();
  const [editor, setEditor] = useState<
    ManualHousingPlanResponse | "new" | null
  >(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const readSession = useRef(createManualSaveSession());
  const abort = useRef<AbortController | null>(null);
  const sharedCacheCleared = hideManualSharedEditor({
    item: editor && editor !== "new" ? editor.item : null,
    actorUserId: user?.id ?? null,
    pending: records.isPending,
    hasData: records.data !== undefined,
  });
  const editorIsUnavailable = Boolean(
    editor &&
      manualEditorUnavailable({
        error: records.error,
        id: editor === "new" ? null : editor.item.id,
        succeeded: records.isSuccess,
        refreshing: records.isFetching,
        visibleIds: records.data?.items.map((item) => item.id) ?? [],
        cacheCleared: sharedCacheCleared,
      })
  );
  useEffect(
    () => () => {
      abort.current?.abort();
      readSession.current.invalidate();
    },
    []
  );
  useEffect(() => {
    if (editorIsUnavailable) {
      setEditor(null);
      setOpenError(
        "계획의 공개 범위나 상태가 바뀌어 상세를 닫았어요. 현재 목록을 다시 확인해 주세요."
      );
    }
  }, [editorIsUnavailable]);
  const open = async (id: string) => {
    if (readSession.current.pending) return;
    const controller = new AbortController();
    abort.current = controller;
    setOpening(id);
    setOpenError(null);
    await readSession.current.run(
      () =>
        authedFetch((token) =>
          manualFinanceApi.plan(token, householdId, id, controller.signal)
        ),
      (read) => {
        setOpening(null);
        if (read.item.visibility !== scope) {
          setOpenError(
            "공개 범위가 바뀌었어요. 현재 범위의 목록을 다시 확인해 주세요."
          );
          void records.refetch();
          return;
        }
        setEditor(read);
      },
      () => {
        setOpening(null);
        setOpenError(
          "계획을 불러오지 못했어요. 권한과 연결을 확인한 뒤 다시 열어 주세요."
        );
        void records.refetch();
      }
    );
  };
  const next = records.data?.summary.nextPayment;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">계획</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            주택에 필요한 돈과 지급 일정을 정리해요.
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
          조회 전용 구성원은 수동 계획을 조회만 할 수 있어요. 새 계획
          생성·수정·삭제는 할 수 없어요.
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
          <section className="min-w-0 rounded-2xl border bg-amber-50/40 p-5 dark:bg-amber-950/10">
            <p className="text-muted-foreground text-xs">
              직접 입력한 일정 기준
            </p>
            <h2 className="mt-2 font-semibold">다음 주택 지급에 필요한 돈</h2>
            <p className="mt-3 break-all text-3xl font-bold tabular-nums">
              {displayManualKrw(next?.remainingAmountKrw ?? null)}
            </p>
            {next ? (
              <>
                <p className="mt-2 break-words text-sm">
                  {next.label} · {PAYMENT_LABELS[next.kind]}
                  {next.installment ? ` ${next.installment}회차` : ""}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  지급 예정일 {next.dueDate} · 기록한 납부액을 뺀 금액
                </p>
              </>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">
                다음 지급을 확정할 수 없어요. 금액·일정·납부 여부를 확인한
                기록이 필요해요.
              </p>
            )}
            {records.data.summary.hasIncompletePayments ? (
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                미입력 항목이 있어 전체 필요자금·준비 완료 여부를 뜻하지 않아요.
              </p>
            ) : null}
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              통장 잔액과 재원을 자동 배정하거나 실제 지급을 실행하지 않아요.
            </p>
          </section>
          <section
            className="min-w-0 rounded-xl border"
            aria-label="수동 주택 계획 목록"
          >
            {records.data.items.length ? (
              records.data.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={opening !== null}
                  onClick={() => void open(item.id)}
                  className="hover:bg-muted/50 flex min-h-20 w-full min-w-0 items-center gap-3 border-b p-4 text-left last:border-0 disabled:opacity-60"
                  aria-label={`${item.label} 상세`}
                >
                  <House className="text-muted-foreground size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <strong className="block break-words text-sm">
                      {item.label}
                    </strong>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      입주연도 {item.occupancyYear ?? "미확인"} ·{" "}
                      {item.contractStage || "계약 단계 미입력"}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {visibilityLabel(item.visibility)} · 직접 입력
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-sm">
                    {opening === item.id ? "확인 중…" : "보기 →"}
                  </span>
                </button>
              ))
            ) : (
              <EmptyState
                icon={<House />}
                title="이 범위에 표시할 주택 계획이 없어요"
                description={
                  canCreate
                    ? "계약금·중도금·잔금·옵션을 직접 정리할 수 있어요. 입주연도·금액·일정은 확인한 경우에만 입력해요."
                    : "현재 보기 범위에 표시할 계획이 없어요. 조회 전용 구성원은 새 계획을 만들 수 없어요."
                }
                action={
                  canCreate ? (
                    <Button
                      className="min-h-11 w-full"
                      onClick={() => setEditor("new")}
                    >
                      주택 계획 직접 기록
                    </Button>
                  ) : undefined
                }
              />
            )}
          </section>
        </>
      ) : null}
      {opening ? (
        <p role="status" className="text-muted-foreground text-sm">
          현재 계획과 지급 기록을 불러오고 있어요.
        </p>
      ) : null}
      {openError ? (
        <p role="alert" className="text-destructive text-sm">
          {openError}
        </p>
      ) : null}
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold">재원과 현금 전망</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          이번에는 재원 용도 메모만 정리해요. 같은 통장의 중복 배정, 공동 지분,
          대출 실행·만기 조건을 확인하는 계산 계약은 아직 없어요. 준비액·전망을
          임의로 만들지 않아요.
        </p>
        <Link
          href={`/assets?scope=${scope}`}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-medium"
        >
          입력한 자산 보기 →
        </Link>
      </section>
      <p className="text-muted-foreground text-xs leading-relaxed">
        주택 계약금액·납입 누계를 현재 부동산 시가나 금융자산으로 더하지 않아요.
        수동 기록의 납부 완료 표시는 실제 계약·납부를 검증한 결과가 아니에요.
      </p>
      {editor && !editorIsUnavailable && (editor !== "new" || canCreate) ? (
        <PlanEditor
          householdId={householdId}
          initial={editor === "new" ? undefined : editor}
          observedVersion={
            editor !== "new"
              ? records.data?.items.find((item) => item.id === editor.item.id)
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
function PlansScreen() {
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
        description="현재 가족의 허용된 수동 계획만 확인할 수 있어요."
      />
    );
  return (
    <ScopedPlans
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
        router.replace(`/plan?scope=${next}`, { scroll: false })
      }
    />
  );
}
export default function PlanPage() {
  return (
    <Suspense fallback={<FinanceLoading />}>
      <PlansScreen />
    </Suspense>
  );
}
