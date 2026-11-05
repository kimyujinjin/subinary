"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CardLast4CorrectionRequest, CardSummary } from "@family/contracts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptsLast4Insertion, cardLast4, correctionError, correctionRequest, createCardCorrectionReadGate, hasUnknownCardLast4 } from "@/lib/card-last4-correction";
import { registerTransactionDetailBack, type TransactionDetailBackSource } from "@/lib/transaction-detail-back";
import { createTransactionEditSession } from "@/lib/transaction-edit";

export function cardLast4DiscardDescription(readRequired: boolean, localReadRequired: boolean): string {
  return readRequired || localReadRequired
    ? "입력한 내용은 닫으면 사라져요. 정정 요청 처리 여부는 현재 카드 정보를 다시 확인해 주세요."
    : "입력한 뒤 4자리는 저장되지 않아요.";
}

export function CardLast4CorrectionDialog({ card, ownerLabelOf, canManage, readRequired, attemptPending, onCorrect, onRefresh, onClose }: {
  card: CardSummary;
  ownerLabelOf: (card: CardSummary) => string;
  canManage: (card: CardSummary) => boolean;
  readRequired: boolean;
  attemptPending: boolean;
  onCorrect: (body: CardLast4CorrectionRequest) => Promise<CardSummary>;
  onRefresh: (signal?: AbortSignal) => Promise<CardSummary>;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(card);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<ReturnType<typeof correctionError> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving" | "refreshing">("idle");
  const [discardOpen, setDiscardOpen] = useState(false);
  const session = useRef(createTransactionEditSession());
  const readGate = useRef(createCardCorrectionReadGate());
  const currentRead = useRef<AbortController | null>(null);
  const back = useRef<(source: TransactionDetailBackSource) => void>(() => undefined);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const pending = phase !== "idle" || attemptPending;
  const expected = cardLast4(current.maskedNumber);
  const unknownCurrent = hasUnknownCardLast4(current.maskedNumber);

  useEffect(() => {
    const cleanup = registerTransactionDetailBack(window, (source) => back.current(source));
    return () => { cleanup(); currentRead.current?.abort(); session.current.invalidate(); };
  }, []);
  useEffect(() => {
    if (phase === "idle" && (error || notice)) input.current?.focus();
  }, [phase, error, notice]);

  const requestClose = () => {
    if (discardOpen) { setDiscardOpen(false); return; }
    if (session.current.pending || attemptPending) { setNotice("처리 중이에요. 완료될 때까지 잠시 기다려 주세요."); return; }
    if (draft && draft !== expected) { setDiscardOpen(true); return; }
    onClose();
  };
  back.current = (source) => {
    if (source === "browser") {
      currentRead.current?.abort();
      session.current.invalidate();
      onClose();
    } else requestClose();
  };

  const fail = (failure: unknown) => {
    setPhase("idle");
    setNotice(null);
    setError(readGate.current.failed(failure));
    input.current?.focus();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.current.pending || attemptPending) return;
    if (readRequired || readGate.current.required) return;
    if (!canManage(current)) { fail({ status: 403 }); return; }
    if (unknownCurrent) return;
    const validation = correctionRequest(draft, expected, current.ownerMemberId);
    if (!validation.ok) {
      setError({ message: validation.message, refresh: false });
      input.current?.focus();
      return;
    }
    setError(null);
    setNotice(null);
    setPhase("saving");
    await session.current.save(() => onCorrect(validation.body), () => {
      setPhase("idle");
      toast.success("카드 뒤 4자리를 정정했어요.");
      onClose();
    }, fail);
  };
  const refresh = async () => {
    if (session.current.pending || attemptPending) return;
    setPhase("refreshing");
    setNotice(null);
    const abort = new AbortController();
    currentRead.current = abort;
    await session.current.save(() => onRefresh(abort.signal), (updated) => {
      readGate.current.confirmed();
      setCurrent(updated);
      setPhase("idle");
      setError(canManage(updated) ? null : correctionError({ status: 403 }));
      setNotice(cardLast4(updated.maskedNumber) === draft
        ? "입력한 뒤 4자리가 이미 반영돼 있어요. 현재 카드 정보를 확인한 뒤 닫아 주세요."
        : "최신 카드 정보를 가져왔어요. 소유자와 현재 뒤 4자리를 확인한 뒤 다시 정정해 주세요.");
      input.current?.focus();
    }, fail);
  };
  const rejectInput = () => setError({ message: "전체 카드번호나 기호는 입력하지 마세요. 뒤 4자리 숫자만 입력해 주세요.", refresh: false });

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 [&>*]:min-w-0 [&>button]:top-1 [&>button]:right-1 [&>button]:inline-flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center sm:p-6">
        <DialogHeader className="pr-7">
          <DialogTitle>카드 뒤 4자리 정정</DialogTitle>
          <DialogDescription className="break-words">아래 카드가 맞는지 확인해 주세요. 별칭이나 소유자는 함께 변경하지 않아요.</DialogDescription>
        </DialogHeader>
        <dl className="bg-muted grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-control p-3 text-body">
          <dt className="text-muted-foreground">소유자</dt><dd className="min-w-0 break-words">{ownerLabelOf(current)}</dd>
          <dt className="text-muted-foreground">별칭</dt><dd className="min-w-0 break-words">{current.alias}</dd>
          <dt className="text-muted-foreground">카드사</dt><dd className="min-w-0 break-words">{current.issuer}</dd>
          <dt className="text-muted-foreground">현재 뒤 4자리</dt><dd>{expected ? `•••• ${expected}` : unknownCurrent ? "형식 확인 필요" : "미등록"}</dd>
        </dl>
        <p className="text-muted-foreground text-caption">지난 거래는 그대로 두고, 앞으로 오는 문자부터 새 뒤 4자리로 연결해요.</p>
        {unknownCurrent ? <p role="alert" className="text-destructive text-caption">지금 카드 정보를 읽을 수 없어 정정할 수 없어요. 가족 관리자에게 확인해 주세요.</p> : null}
        <form onSubmit={(event) => void submit(event)} noValidate className="flex min-w-0 flex-col gap-3" aria-busy={pending}>
          <Label htmlFor={inputId}>새 뒤 4자리</Label>
          <Input ref={input} id={inputId} type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" autoCorrect="off" spellCheck={false}
            className="h-11 min-w-0" placeholder="숫자 4자리" value={draft} disabled={pending || unknownCurrent || !canManage(current)}
            aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              const start = event.currentTarget.selectionStart ?? draft.length;
              const end = event.currentTarget.selectionEnd ?? draft.length;
              if (!acceptsLast4Insertion(draft, text, start, end)) { event.preventDefault(); rejectInput(); }
            }}
            onDrop={(event) => { event.preventDefault(); rejectInput(); }}
            onBeforeInput={(event) => {
              const data = (event.nativeEvent as InputEvent).data;
              const start = event.currentTarget.selectionStart ?? draft.length;
              const end = event.currentTarget.selectionEnd ?? draft.length;
              if (data && !acceptsLast4Insertion(draft, data, start, end)) { event.preventDefault(); rejectInput(); }
            }}
            onChange={(event) => {
              if (!/^[0-9]{0,4}$/.test(event.target.value)) { rejectInput(); return; }
              setDraft(event.target.value); if (!readRequired && !readGate.current.required) setError(null); setNotice(null);
            }} />
          <p id={`${inputId}-hint`} className="text-muted-foreground text-caption">전체 카드번호 말고 뒤 4자리만, 앞자리 0도 그대로 입력해 주세요.</p>
          {error ? <p id={`${inputId}-error`} role="alert" className="text-destructive text-caption break-words">{error.message}</p> : null}
          {readRequired && !error ? <p role="status" className="text-muted-foreground text-caption">이전 정정 결과를 아직 확인하지 못했어요. 현재 카드 정보를 먼저 확인해 주세요.</p> : null}
          {error?.refresh || readRequired || readGate.current.required ? <Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={pending} onClick={() => void refresh()}>현재 카드 정보 다시 확인</Button> : null}
          {notice ? <p role="status" className="text-muted-foreground text-caption">{notice}</p> : null}
          {pending ? <p role="status" className="text-muted-foreground text-caption">{phase === "saving" || attemptPending ? "정정 중이에요. 완료될 때까지 잠시 기다려 주세요." : "현재 카드 정보를 확인하고 있어요."}</p> : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button type="submit" className="min-h-11 w-full" disabled={pending || readRequired || readGate.current.required || unknownCurrent || !canManage(current) || draft === expected}>{phase === "saving" ? "정정 중…" : "뒤 4자리 정정하기"}</Button>
            <Button type="button" variant="ghost" className="min-h-11 w-full" disabled={pending} onClick={requestClose}>닫기</Button>
          </DialogFooter>
        </form>
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent onCloseAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}>
            <AlertDialogHeader><AlertDialogTitle>입력을 버리고 닫을까요?</AlertDialogTitle><AlertDialogDescription>{cardLast4DiscardDescription(readRequired, readGate.current.required)}</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>계속 입력하기</AlertDialogCancel><AlertDialogAction onClick={() => { session.current.invalidate(); onClose(); }}>버리고 닫기</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
