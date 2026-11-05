"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 카테고리 (/categories)
 *
 * 우리 가족만의 커스텀 지출 카테고리를 만들고(이름만), 이름을 바꾸거나 지운다.
 * 시스템 기본 카테고리는 읽기 전용(수정/삭제 불가). 지우면 그 카테고리를 쓰던 거래가
 * 서버에서 '미분류'로 되돌아가므로 ⋯ 메뉴 안에 두고 한 번 더 확인한다(리뉴얼 §3.3).
 * 행을 누르면 그 카테고리의 거래 목록(`/transactions?categoryId=`)으로 간다.
 * 여기서 만든 커스텀 카테고리는 이후 자동 분류 후보에도 자동 포함된다.
 *
 * 가맹점 분류 검토는 '자동 분류 규칙'(/more/category-rules)으로 옮겼다(2026-11-05,
 * 소유자 승인) — 이 화면은 카테고리 자체만 다룬다.
 * ------------------------------------------------------------------------- */
import { Check, Loader2, Plus, RotateCcw, Tags, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { CategorySummary } from "@family/contracts";

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
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  ListLoading,
  ListRow,
  OverflowMenu,
  PageBackHeader,
  SectionHeader,
} from "@/components/widgets";
import {
  useCategoryList,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "@/lib/queries";

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 그 카테고리의 거래 목록. 거래 화면이 첫 렌더에 URL의 `categoryId`를 필터로 읽는다. */
function transactionsHref(categoryId: string): string {
  return `/transactions?categoryId=${encodeURIComponent(categoryId)}`;
}

export default function CategoriesPage() {
  const categoriesQuery = useCategoryList();
  const createMut = useCreateCategory();
  const updateMut = useUpdateCategory();
  const deleteMut = useDeleteCategory();

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  /** 삭제를 확인 중인 카테고리. null이면 확인 시트가 닫혀 있다. */
  const [deleteTarget, setDeleteTarget] = useState<CategorySummary | null>(null);

  const all = categoriesQuery.data ?? [];
  const system = all.filter((c) => c.isSystem);
  const custom = all.filter((c) => !c.isSystem);

  async function onCreate() {
    const name = newName.trim();
    if (!name || createMut.isPending) return;
    try {
      await createMut.mutateAsync(name);
      setNewName("");
      toast.success("카테고리를 만들었어요.");
    } catch (err) {
      toast.error(errMsg(err, "카테고리를 만들지 못했어요."));
    }
  }

  async function onRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    try {
      await updateMut.mutateAsync({ id, name });
      setEditingId(null);
      toast.success("이름을 바꿨어요.");
    } catch (err) {
      toast.error(errMsg(err, "이름을 바꾸지 못했어요."));
    }
  }

  async function onDelete(cat: CategorySummary) {
    try {
      await deleteMut.mutateAsync(cat.id);
      setDeleteTarget(null);
      toast.success(`'${cat.name}' 카테고리를 지웠어요.`);
    } catch (err) {
      toast.error(errMsg(err, "카테고리를 지우지 못했어요."));
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6">
      <PageBackHeader title="카테고리" />

      {/* 새 카테고리 — 이 화면의 주 행동이라 채움 버튼은 여기 하나뿐이다. */}
      <section className="finance-panel min-w-0 px-5 pt-3 pb-5">
        <SectionHeader title="새 카테고리" />
        <div className="flex gap-2">
          <Input
            aria-label="새 카테고리 이름"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onCreate();
              }
            }}
            placeholder="예: 간식, 반려동물, 경조사"
            maxLength={20}
            disabled={createMut.isPending}
          />
          <Button
            className="h-12 shrink-0"
            onClick={() => void onCreate()}
            disabled={createMut.isPending || newName.trim() === ""}
          >
            {createMut.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            추가
          </Button>
        </div>
      </section>

      {/* 커스텀 카테고리 */}
      <section className="finance-panel min-w-0 overflow-hidden pt-3 pb-1">
        <SectionHeader
          className="px-5"
          title="우리 가족 카테고리"
          trailing={
            custom.length > 0 ? (
              <span className="text-caption text-muted-foreground tabular-nums">
                {custom.length}개
              </span>
            ) : undefined
          }
        />
        {categoriesQuery.isLoading ? (
          <ListLoading rows={3} label="카테고리를 불러오는 중이에요." className="px-5 pb-4" />
        ) : categoriesQuery.isError ? (
          // 조회 실패를 "없음"으로 보여주면 사용자가 이미 있는 카테고리를 다시 만들려
          // 하거나(유니크 충돌) 데이터가 사라졌다고 오인한다 — 에러와 빈 상태는 다르다.
          <div role="alert">
            <EmptyState
              title="카테고리를 불러오지 못했어요"
              action={
                <Button
                  variant="weak"
                  className="w-full"
                  onClick={() => void categoriesQuery.refetch()}
                  disabled={categoriesQuery.isFetching}
                >
                  <RotateCcw /> 다시 시도
                </Button>
              }
            />
          </div>
        ) : custom.length === 0 ? (
          <EmptyState
            icon={<Tags />}
            title="아직 만든 카테고리가 없어요"
            description="위에서 이름을 넣고 추가해 보세요."
          />
        ) : (
          <ul className="divide-border/60 divide-y px-4">
            {custom.map((cat) => (
              <li key={cat.id} className="flex min-w-0 items-center gap-1">
                {editingId === cat.id ? (
                  <div className="flex min-h-16 min-w-0 flex-1 items-center gap-1 py-2">
                    <Input
                      aria-label={`${cat.name} 새 이름`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void onRename(cat.id);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      maxLength={20}
                      autoFocus
                      disabled={updateMut.isPending}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="이름 저장"
                      onClick={() => void onRename(cat.id)}
                      disabled={updateMut.isPending || editName.trim() === ""}
                    >
                      <Check />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="이름 바꾸기 그만두기"
                      onClick={() => setEditingId(null)}
                      disabled={updateMut.isPending}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <>
                    <ListRow
                      className="flex-1"
                      href={transactionsHref(cat.id)}
                      ariaLabel={`${cat.name} 거래 보기`}
                      title={cat.name}
                      titleClassName="font-medium"
                      chevron
                    />
                    <OverflowMenu
                      label={`${cat.name} 메뉴`}
                      className="-mr-2 shrink-0"
                      actions={[
                        {
                          label: "이름 바꾸기",
                          onSelect: () => {
                            setEditingId(cat.id);
                            setEditName(cat.name);
                          },
                        },
                        {
                          label: "삭제",
                          destructive: true,
                          disabled: deleteMut.isPending,
                          onSelect: () => setDeleteTarget(cat),
                        },
                      ]}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 시스템 기본 카테고리(읽기 전용).
          조회 실패·로딩 중에는 섹션 자체를 감춘다 — 빈 목록에 "바꿀 수 없어요"만
          남으면 기본 카테고리가 없어진 것처럼 읽힌다(위 오류 안내가 이미 상황을 말한다). */}
      {system.length > 0 ? (
        <section className="finance-panel min-w-0 overflow-hidden pt-3 pb-1">
          <SectionHeader className="px-5" title="기본 카테고리" />
          <p className="text-caption text-muted-foreground px-5">
            기본 카테고리는 이름을 바꾸거나 지울 수 없어요.
          </p>
          <ul className="divide-border/60 divide-y px-4">
            {system.map((cat) => (
              <li key={cat.id}>
                <ListRow
                  href={transactionsHref(cat.id)}
                  ariaLabel={`${cat.name} 거래 보기`}
                  title={cat.name}
                  titleClassName="font-medium"
                  chevron
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 삭제 확인 — ⋯ 메뉴에서 열고 한 번 더 확인한다(되돌릴 수 없는 행동). */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              &lsquo;{deleteTarget?.name}&rsquo; 카테고리를 지울까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              거래는 미분류로 돌아가고 이 카테고리의 자동 분류 규칙과 예산도 함께
              지워지며, 되돌릴 수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={(event) => {
                // 실패하면 시트를 열어 둔 채 오류를 보여 준다(성공 시 onDelete가 닫는다).
                event.preventDefault();
                if (deleteTarget) void onDelete(deleteTarget);
              }}
            >
              {deleteMut.isPending ? "지우는 중…" : "지우기"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
