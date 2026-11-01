"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ManualFinanceScope,
  ManualFinanceVisibility,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { registerTransactionDetailBack } from "@/lib/transaction-detail-back";
import { createManualEditorHistory } from "./edit-history";

const RecordDialogContext = createContext<{
  registerOverlay: (close: () => void) => () => void;
} | null>(null);

export function FinanceScopeTabs({
  value,
  onChange,
}: {
  value: ManualFinanceScope;
  onChange: (value: ManualFinanceScope) => void;
}) {
  return (
    <div>
      <div
        role="group"
        aria-label="수동 기록 보기 범위"
        className="bg-muted grid grid-cols-2 gap-1 rounded-xl p-1"
      >
        {(
          [
            ["household", "가족 공유"],
            ["private", "나만 보기"],
          ] as const
        ).map(([scope, label]) => (
          <Button
            key={scope}
            type="button"
            variant={value === scope ? "default" : "ghost"}
            className="min-h-11"
            aria-pressed={scope === value}
            onClick={() => onChange(scope)}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        선택한 범위의 수동 기록만 보여요. 기존 카드의 가족공개·요약만·비공개
        정책을 바꾸지 않아요.
      </p>
    </div>
  );
}
export function VisibilityField({
  value,
  onChange,
  disabled,
}: {
  value: ManualFinanceVisibility;
  onChange: (value: ManualFinanceVisibility) => void;
  disabled: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      이 기록의 공개 범위
      <select
        aria-label="이 기록의 공개 범위"
        className="bg-background h-11 min-w-0 rounded-md border px-3 font-normal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ManualFinanceVisibility)}
      >
        <option value="private">비공개 · 나만 보기</option>
        <option value="household">가족 공개 · 내용과 금액 공유</option>
      </select>
      <span className="text-muted-foreground text-xs font-normal leading-relaxed">
        새 기록은 비공개예요. 가족 공개를 선택하면 현재 가족 구성원에게 이
        기록의 상세와 금액이 공개돼요. 카드 공개 정책과는 별개예요.
      </span>
    </label>
  );
}
export function FinanceLoadError({ retry }: { retry: () => void }) {
  return (
    <section role="alert" className="rounded-xl border p-5">
      <h2 className="font-semibold">기록을 불러오지 못했어요</h2>
      <p className="text-muted-foreground mt-2 text-sm">
        확인할 수 없는 값을 0원으로 바꾸지 않아요. 연결·권한을 확인한 뒤 다시
        불러와 주세요.
      </p>
      <Button variant="outline" className="mt-4 min-h-11" onClick={retry}>
        다시 불러오기
      </Button>
    </section>
  );
}
export function FinanceLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      <p className="text-muted-foreground text-sm">
        선택한 범위의 수동 기록을 확인하고 있어요.
      </p>
      <div className="bg-muted h-40 animate-pulse rounded-2xl" />
    </div>
  );
}

export function ConfirmAction({
  label,
  title,
  description,
  onConfirm,
  disabled = false,
  destructive = false,
}: {
  label: string;
  title: string;
  description: string;
  onConfirm: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const host = useContext(RecordDialogContext);
  useEffect(() => {
    if (open && host) return host.registerOverlay(() => setOpen(false));
  }, [open, host]);
  return (
    <>
      <Button
        type="button"
        variant={destructive ? "destructive" : "outline"}
        disabled={disabled}
        className="min-h-11 h-auto w-full whitespace-normal"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">취소</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={onConfirm}>
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function RecordDialog({
  title,
  description,
  children,
  dirty,
  busy,
  pending,
  readRequired,
  onClose,
  invalidate,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  dirty: boolean;
  busy: boolean;
  pending: () => boolean;
  readRequired: boolean;
  onClose: () => void;
  invalidate: () => void;
  footer?: ReactNode;
}) {
  const [discard, setDiscard] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ dirty, busy, pending, discard, onClose, invalidate });
  latest.current = { dirty, busy, pending, discard, onClose, invalidate };
  const historyController = useRef<ReturnType<
    typeof createManualEditorHistory
  > | null>(null);
  const nestedOverlay = useRef<(() => void) | null>(null);
  const context = useMemo(
    () => ({
      registerOverlay(handler: () => void) {
        nestedOverlay.current = handler;
        return () => {
          if (nestedOverlay.current === handler) nestedOverlay.current = null;
        };
      },
    }),
    []
  );
  const close = useRef(() => undefined);
  const finish = () => {
    invalidate();
    historyController.current?.close();
    onClose();
  };
  close.current = () => {
    if (nestedOverlay.current) {
      nestedOverlay.current();
      return;
    }
    if (latest.current.discard) {
      setDiscard(false);
      return;
    }
    if (latest.current.busy || latest.current.pending()) {
      setNotice("저장 중이에요. 결과를 확인할 때까지 잠시 기다려 주세요.");
      return;
    }
    if (latest.current.dirty) {
      setDiscard(true);
      return;
    }
    finish();
  };
  const attachments = useRef(0);
  useEffect(() => {
    const epoch = ++attachments.current;
    historyController.current ??= createManualEditorHistory(
      window,
      crypto.randomUUID(),
      {
        shouldConfirm: () =>
          latest.current.dirty ||
          latest.current.busy ||
          latest.current.pending() ||
          Boolean(nestedOverlay.current),
        onBack: () => close.current(),
        onAbandon: () => {
          latest.current.invalidate();
          latest.current.onClose();
        },
      }
    );
    const controller = historyController.current;
    controller.attach();
    const nativeBack = registerTransactionDetailBack(window, (source) => {
      if (source === "native") close.current();
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        latest.current.dirty ||
        latest.current.busy ||
        latest.current.pending()
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      controller.detach();
      nativeBack();
      window.removeEventListener("beforeunload", beforeUnload);
      latest.current.invalidate();
      queueMicrotask(() => {
        if (attachments.current === epoch) controller.close();
      });
    };
  }, []);
  return (
    <RecordDialogContext.Provider value={context}>
      <Dialog open onOpenChange={(open) => !open && close.current()}>
        <DialogContent
          onClickCapture={(event) => {
            if (event.detail > 1) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 [&>*]:min-w-0 [&>button]:top-1 [&>button]:right-1 [&>button]:inline-flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center sm:max-w-xl sm:p-6"
        >
          <DialogHeader className="pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="break-words">
              {description}
            </DialogDescription>
          </DialogHeader>
          {children}
          {notice ? (
            <p role="status" className="text-muted-foreground text-sm">
              {notice}
            </p>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {footer}
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full"
              disabled={busy}
              onClick={() => close.current()}
            >
              닫기
            </Button>
          </DialogFooter>
          <AlertDialog open={discard} onOpenChange={setDiscard}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>입력을 버리고 닫을까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  {readRequired
                    ? "입력한 내용은 닫으면 사라져요. 이전 저장의 처리 여부는 현재 기록을 다시 확인해 주세요."
                    : "저장하지 않은 입력은 사라져요. 실제 카드 거래와 자금은 바뀌지 않아요."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">
                  계속 입력하기
                </AlertDialogCancel>
                <AlertDialogAction className="min-h-11" onClick={finish}>
                  버리고 닫기
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </RecordDialogContext.Provider>
  );
}
