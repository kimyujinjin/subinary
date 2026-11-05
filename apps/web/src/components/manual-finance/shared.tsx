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
import type { ManualFinanceVisibility } from "@family/contracts";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ListLoading } from "@/components/widgets/list-loading";
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
import { guardRepeatedDialogClick } from "@/lib/dialog-click-guard";
import { createManualEditorHistory } from "./edit-history";

const RecordDialogContext = createContext<{
  registerOverlay: (close: () => void) => () => void;
} | null>(null);

export function LegacyPrivateNotice({ href }: { href: "/assets" | "/plan" }) {
  return (
    <section
      aria-label="기존 비공개 기록"
      className="rounded-xl border bg-muted/30 p-4"
    >
      <h2 className="text-sm font-semibold">기존 비공개 기록</h2>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        예전에 비공개로 등록한 내용이에요. 수정해도 공개 범위는 유지돼요.
      </p>
      <Link
        href={href}
        className="text-primary mt-1 inline-flex min-h-11 items-center text-sm font-medium"
      >
        공유 목록으로 돌아가기 →
      </Link>
    </section>
  );
}

/** Display only: editing an existing private record never widens its visibility. */
export function VisibilityField({
  value,
  creating = false,
}: {
  value: ManualFinanceVisibility;
  creating?: boolean;
}) {
  return (
    <section aria-label="공개 범위" className="rounded-lg bg-muted/50 p-3">
      <p className="text-sm font-medium">
        {value === "household" ? "가족과 공유" : "기존 비공개 기록"}
      </p>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        {value === "household"
          ? creating
            ? "저장하면 현재 선택한 가족의 모든 구성원이 내용과 금액을 볼 수 있어요."
            : "현재 선택한 가족의 모든 구성원이 내용과 금액을 볼 수 있어요."
          : "나만 볼 수 있어요. 수정해도 가족에게 공유되지 않아요."}
      </p>
    </section>
  );
}
export function FinanceLoadError({ retry }: { retry: () => void }) {
  return (
    <section role="alert" className="finance-panel p-5">
      <h2 className="font-semibold">기록을 불러오지 못했어요</h2>
      <p className="text-muted-foreground mt-2 text-sm">
        잠시 후 다시 불러와 주세요.
      </p>
      <Button variant="outline" className="mt-4 min-h-11" onClick={retry}>
        다시 불러오기
      </Button>
    </section>
  );
}
/**
 * 금융 화면의 목록·카드 로딩.
 *
 * 자체 `animate-pulse` 블록 하나를 그리던 것을 공용 `ListLoading`으로 옮겼다 —
 * 같은 앱에 pulse 구현이 둘이었고, 160px 블록 하나는 들어올 목록의 크기를 예고하지
 * 못해 내용이 뜨는 순간 화면이 튀었다. 로딩 표현 기준은 `widgets/list-loading.tsx`.
 */
export function FinanceLoading() {
  return <ListLoading rows={2} />;
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
      setNotice("저장 중이에요. 잠시 기다려 주세요.");
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
            if (
              event.detail === 1 &&
              event.target instanceof Element &&
              event.target.closest("button")
            ) {
              guardRepeatedDialogClick(window, event.nativeEvent);
            }
            if (event.detail > 1) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 [&>*]:min-w-0 [&>button]:top-1 [&>button]:right-1 [&>button]:inline-flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center sm:max-w-xl"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6 sm:pr-12">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="break-words">
              {description}
            </DialogDescription>
          </DialogHeader>
          <div
            data-record-dialog-body
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
          >
            {children}
          </div>
          {notice ? (
            <p
              role="status"
              className="text-muted-foreground shrink-0 border-t px-4 py-2 text-sm sm:px-6"
            >
              {notice}
            </p>
          ) : null}
          <DialogFooter className="bg-background shrink-0 flex-row flex-wrap gap-2 border-t px-4 py-3 sm:flex-row sm:px-6 [&>button]:w-auto [&>button]:min-w-0 [&>button]:flex-[1_1_7rem] [&>p]:w-full">
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
                <AlertDialogTitle>저장하지 않고 닫을까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  {readRequired
                    ? "입력한 내용은 사라져요. 이전 저장이 완료됐는지는 기록을 다시 열어 확인해 주세요."
                    : "저장하지 않은 내용은 사라져요."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">
                  계속 입력하기
                </AlertDialogCancel>
                <AlertDialogAction className="min-h-11" onClick={finish}>
                  저장 안 함
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </RecordDialogContext.Provider>
  );
}
