"use client";
/**
 * 카드 뒤 4자리 정정 창 — 결제 카드 행의 ⋯ 메뉴에서만 연다(수정 창 위에 겹쳐 열지 않는다).
 * 지금 카드 정보는 설정 앱 스타일 읽기 전용 줄(FieldList)로 보이고, 새 뒤 4자리 칸 하나만 입력한다.
 * 입력한 채로 닫으면 액션 시트로 버릴지 묻는다.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CardLast4CorrectionRequest, CardSummary } from "@family/contracts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldList, FieldRow } from "@/components/widgets/field-row";
import { acceptsLast4Insertion, cardLast4, correctionError, correctionRequest, createCardCorrectionReadGate, hasUnknownCardLast4 } from "@/lib/card-last4-correction";
import { registerTransactionDetailBack, type TransactionDetailBackSource } from "@/lib/transaction-detail-back";
import { createTransactionEditSession } from "@/lib/transaction-edit";

/** 버리기 확인 설명. 결과를 모르는 정정이 있으면 '저장되지 않아요'라고 단정하지 않고, 확인할 버튼 이름을 그대로 알려 준다. */
export function cardLast4DiscardDescription(readRequired: boolean, localReadRequired: boolean): string {
  return readRequired || localReadRequired
    ? "입력한 내용은 닫으면 사라져요. 정정이 반영됐는지는 다시 열어 '카드 정보 다시 불러오기'로 확인해 주세요."
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
        ? "입력한 뒤 4자리가 이미 반영돼 있어요. 위 카드 정보를 확인한 뒤 닫아 주세요."
        : "최신 카드 정보를 가져왔어요. 소유자와 지금 뒤 4자리를 확인한 뒤 다시 정정해 주세요.");
      input.current?.focus();
    }, fail);
  };
  const rejectInput = () => setError({ message: "전체 카드번호나 기호는 입력하지 마세요. 뒤 4자리 숫자만 입력해 주세요.", refresh: false });

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      {/* 닫기 X는 DialogContent 기본(44px)을 그대로 쓴다 — 예전의 [&>button] 덮어쓰기는 X가 16px이던 때의 땜질이었다. */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>카드 뒤 4자리 정정</DialogTitle>
          <DialogDescription className="break-words">아래 카드가 맞는지 확인해 주세요. 별칭과 소유자는 바뀌지 않아요.</DialogDescription>
        </DialogHeader>
        <FieldList>
          <FieldRow label="소유자" value={ownerLabelOf(current)} />
          <FieldRow label="별칭" value={current.alias} />
          <FieldRow label="카드사" value={current.issuer} />
          <FieldRow label="지금 뒤 4자리" value={expected ? `•••• ${expected}` : unknownCurrent ? "읽을 수 없음" : "미등록"} muted={!expected} />
        </FieldList>
        <p className="text-muted-foreground text-caption">지난 거래는 그대로 두고, 앞으로 오는 문자부터 새 뒤 4자리로 연결해요.</p>
        {unknownCurrent ? <p role="alert" className="text-destructive text-caption">지금 뒤 4자리를 읽을 수 없어 정정할 수 없어요. 가족 관리자에게 확인해 주세요.</p> : null}
        <form onSubmit={(event) => void submit(event)} noValidate className="flex min-w-0 flex-col gap-3" aria-busy={pending}>
          <Label htmlFor={inputId}>새 뒤 4자리</Label>
          <Input ref={input} id={inputId} type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" autoCorrect="off" spellCheck={false}
            className="min-w-0" placeholder="숫자 4자리" value={draft} disabled={pending || unknownCurrent || !canManage(current)}
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
          {readRequired && !error ? <p role="status" className="text-muted-foreground text-caption">지난 정정 결과를 아직 확인하지 못했어요. 카드 정보를 먼저 다시 불러와 주세요.</p> : null}
          {error?.refresh || readRequired || readGate.current.required ? <Button type="button" variant="weak" className="w-full" disabled={pending} onClick={() => void refresh()}>카드 정보 다시 불러오기</Button> : null}
          {notice ? <p role="status" className="text-muted-foreground text-caption">{notice}</p> : null}
          {pending ? <p role="status" className="text-muted-foreground text-caption">{phase === "saving" || attemptPending ? "정정 중이에요. 완료될 때까지 잠시 기다려 주세요." : "카드 정보를 다시 불러오고 있어요."}</p> : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button type="submit" className="w-full" disabled={pending || readRequired || readGate.current.required || unknownCurrent || !canManage(current) || draft === expected}>{phase === "saving" ? "정정 중…" : "뒤 4자리 정정하기"}</Button>
            <Button type="button" variant="ghost" className="w-full" disabled={pending} onClick={requestClose}>닫기</Button>
          </DialogFooter>
        </form>
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent onCloseAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}>
            <AlertDialogHeader><AlertDialogTitle>입력을 버리고 닫을까요?</AlertDialogTitle><AlertDialogDescription>{cardLast4DiscardDescription(readRequired, readGate.current.required)}</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>계속 입력하기</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { session.current.invalidate(); onClose(); }}>버리기</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
