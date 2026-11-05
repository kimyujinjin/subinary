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
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/widgets/bottom-sheet";
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
      className="rounded-card bg-muted/50 p-4"
    >
      <h2 className="text-body font-semibold">기존 비공개 기록</h2>
      <p className="text-caption text-muted-foreground mt-1">
        예전에 나만 보기로 등록한 기록이에요. 고쳐도 가족에게 공개되지 않아요.
      </p>
      <Link
        href={href}
        className="text-body text-primary mt-1 inline-flex min-h-11 items-center gap-1 font-medium active:opacity-60"
      >
        가족 기록으로 돌아가기
        <ChevronRight className="size-5" aria-hidden="true" />
      </Link>
    </section>
  );
}

/*
 * 공개 범위 상자(VisibilityField)는 2026-11-05 HIG 검수 4단계에서 지웠다 — 모든 기록이 가족 공개라(§8)
 * 폼마다 같은 말을 되풀이했다. 예전에 나만 보기로 만든 기록은 목록 머리의 LegacyPrivateNotice가 알린다.
 */

/** 입력 칸 아래 한 줄 오류. 칸의 `aria-describedby`로 이어 읽힌다(제출 때 생기므로 바로 읽어 주는 alert). */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-caption text-destructive font-normal break-words">
      {children}
    </p>
  );
}

/** 폼 안 기본 선택 칸(종류·항목·넣는 날) — Input과 같은 회색 채움·높이·모서리. */
export const NATIVE_SELECT =
  "bg-muted text-body h-12 w-full min-w-0 rounded-control border border-transparent px-4 font-normal outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50";

export function FinanceLoadError({ retry }: { retry: () => void }) {
  return (
    <section role="alert" className="finance-panel p-5">
      <h2 className="text-heading">기록을 불러오지 못했어요</h2>
      <p className="text-body text-muted-foreground mt-2">
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

/**
 * 누르면 액션 시트로 한 번 더 묻는 버튼.
 *
 * 확인 버튼 글자는 '확인'이 아니라 실제로 일어날 동작(기본은 `label` — '삭제하기' 등)이다.
 * 지우기·제거처럼 되돌리기 어려운 동작(`destructive`)은 확인 버튼도 위험 색으로 그린다 —
 * 예전에는 무엇을 하든 채움 '확인'이라 삭제와 다시 불러오기가 같은 무게로 보였다.
 * 닫는 버튼은 '취소'가 아니라 '닫기'다 — 이 앱에서 '취소'는 결제 취소를 뜻한다.
 *
 * `appearance="text"`는 폼 맨 아래의 위험 텍스트 버튼이다(HIG: 파괴 동작은 저장 버튼과 떨어뜨린다).
 * 예전에는 접힌 '자산 삭제'를 펼친 뒤 빨간 채움 버튼을 눌러야 해서 한 화면에 채움 버튼이 둘이었다.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  title,
  description,
  onConfirm,
  disabled = false,
  destructive = false,
  appearance = "button",
}: {
  label: string;
  /** 확인 버튼 글자. 없으면 `label`을 그대로 쓴다. */
  confirmLabel?: string;
  title: string;
  description: string;
  onConfirm: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** button: 약한 버튼(위험이면 위험 색), text: 글자만 있는 버튼(위험이면 빨간 글자). */
  appearance?: "button" | "text";
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
        variant={
          appearance === "text" ? "ghost" : destructive ? "destructive" : "weak"
        }
        disabled={disabled}
        className={
          appearance === "text"
            ? `min-h-11 h-auto w-full whitespace-normal ${destructive ? "text-destructive" : "text-primary"}`
            : "min-h-11 h-auto w-full whitespace-normal"
        }
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
            <AlertDialogCancel className="min-h-11">닫기</AlertDialogCancel>
            <AlertDialogAction
              variant={destructive ? "destructive" : "default"}
              className="min-h-11 h-auto whitespace-normal"
              onClick={onConfirm}
            >
              {confirmLabel ?? label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * 고칠 수 없는 기록(가족이 등록한 자산·주택 계획)의 읽기 전용 상세 — 창 모양 표의 '시트'(BottomSheet).
 * 예전에는 칸이 모두 꺼진 입력 폼으로 열려 무엇을 할 수 있는지 읽기 어려웠다(2026-11-05 HIG 검수).
 * 닫기만 있다. 폰의 뒤로 버튼도 시트를 닫는다.
 */
export function RecordSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(
    () =>
      registerTransactionDetailBack(window, (source) => {
        if (source === "native") closeRef.current();
      }),
    []
  );
  return (
    <BottomSheet
      open
      onOpenChange={(open) => {
        if (!open) closeRef.current();
      }}
      title={title}
    >
      <div className="flex min-w-0 flex-col gap-4 pb-1">{children}</div>
    </BottomSheet>
  );
}

/**
 * 입력 폼(창 모양 표의 기본 Dialog). 닫기는 오른쪽 위 X 하나다 — 다른 입력 폼처럼 X + 주 버튼으로 맞췄다
 * (예전에는 X와 아래 '닫기'가 둘 다 있었다). 저장하지 않은 입력이 있으면 액션 시트로 '버리기'를 묻는다.
 */
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
              className="text-body text-muted-foreground shrink-0 border-t px-4 py-2 sm:px-6"
            >
              {notice}
            </p>
          ) : null}
          {footer ? (
            <DialogFooter className="bg-elevated shrink-0 flex-row flex-wrap gap-2 border-t px-4 py-3 sm:flex-row sm:px-6 [&>button]:w-auto [&>button]:min-w-0 [&>button]:flex-[1_1_7rem] [&>div]:w-full [&>p]:w-full">
              {footer}
            </DialogFooter>
          ) : null}
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
                <AlertDialogAction
                  variant="destructive"
                  className="min-h-11"
                  onClick={finish}
                >
                  버리기
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </RecordDialogContext.Provider>
  );
}
