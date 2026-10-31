"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 거래 추가 다이얼로그
 *
 * 두 모드로 유실 거래를 등록한다:
 *  - 문자 붙여넣기: 복사한 카드 알림/문자를 붙여넣으면 서버가 파싱(미리보기) → 등록
 *    시 일반 수집 파이프라인으로 태워 자동 승격(카드연결/카테고리/중복/예산/알림).
 *  - 직접 입력: 금액·가맹점·날짜·카테고리·카드를 폼으로 입력해 즉시 등록(동기).
 *
 * 파싱 로직/스키마는 서버(@family/card-parsers, ManualEntryService)가 정본이며,
 * 여기선 입력 수집·미리보기 표시·상태 안내만 담당한다.
 * ------------------------------------------------------------------------- */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cardIdentityLabel } from "@/lib/card-identity-label";
import {
  useCardList,
  useCategoryList,
  useManualFieldsEntry,
  useHouseholdMembers,
  useManualTextEntry,
  useParsePreview,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { postingConfirmed, postingMessage } from "@/lib/sms-posting";
import { registerTransactionDetailBack } from "@/lib/transaction-detail-back";

/** Select에서 "선택 안 함"을 표현하는 sentinel(Radix는 빈 문자열 value 금지). */
const NONE = "__none__";

type Mode = "text" | "fields";

/** datetime-local 기본값(현재 시각, 로컬). `YYYY-MM-DDTHH:mm`. */
function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "요청을 처리하지 못했어요";
}

export function AddTransactionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inFlight = useRef(false);
  const session = useRef(0);
  const closeHandler = useRef<() => void>(() => undefined);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("text");

  // 문자 붙여넣기 상태
  const [content, setContent] = useState("");

  // 직접 입력 상태
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalInput);
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [cardId, setCardId] = useState<string>(NONE);

  const preview = useParsePreview();
  const textEntry = useManualTextEntry();
  const fieldsEntry = useManualFieldsEntry();
  const categories = useCategoryList();
  const cards = useCardList();
  const members = useHouseholdMembers();
  const memberNames = new Map((members.data ?? []).map((member) => [member.memberId, member.name]));

  // 다이얼로그 열릴 때마다 초기화.
  useEffect(() => {
    session.current += 1;
    if (!open) return;
    setDiscardOpen(false);
    setMode("text");
    setContent("");
    setAmount("");
    setMerchant("");
    setOccurredAt(nowLocalInput());
    setCategoryId(NONE);
    setCardId(NONE);
    preview.reset();
    textEntry.reset();
    fieldsEntry.reset();
    return () => { session.current += 1; };
    // 초기화는 open 토글에만 반응(뮤테이션 identity는 안정적).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return registerTransactionDetailBack(window, (source) => {
      if (source === "browser") {
        session.current += 1;
        onOpenChange(false);
      } else closeHandler.current();
    });
  }, [open, onOpenChange]);

  // 문자 입력 디바운스 → 파싱 미리보기.
  useEffect(() => {
    const text = content.trim();
    if (mode !== "text" || text.length < 4) {
      preview.reset();
      return;
    }
    const timer = setTimeout(() => preview.mutate({ content: text }), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, mode]);

  const previewData = mode === "text" && preview.variables?.content === content.trim() ? preview.data : undefined;
  const canRegisterText = Boolean(previewData?.parseable);

  const submitting = textEntry.isPending || fieldsEntry.isPending;
  const requestClose = () => {
    if (inFlight.current) {
      toast.message("등록 결과를 확인하고 있어요. 잠시 기다려 주세요.");
      return;
    }
    if (discardOpen) { setDiscardOpen(false); return; }
    if (content.trim() || amount.trim() || merchant.trim()) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };
  closeHandler.current = requestClose;

  /** 미리보기 결과를 직접 입력 폼에 채우고 폼 모드로 전환. */
  function switchToFieldsPrefilled() {
    if (previewData) {
      // 직접 입력 폼은 원화 전용이다. 외화의 저장 금액을 원화로 채우면 오계상된다.
      if (previewData.amount != null && (previewData.currency ?? "KRW") === "KRW") {
        setAmount(String(previewData.amount));
      } else {
        setAmount("");
      }
      if (previewData.merchantRaw) setMerchant(previewData.merchantRaw);
      if (previewData.occurredAt) {
        const d = new Date(previewData.occurredAt);
        if (!Number.isNaN(d.getTime())) {
          const pad = (n: number) => String(n).padStart(2, "0");
          setOccurredAt(
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
              d.getDate(),
            )}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
          );
        }
      }
    }
    setMode("fields");
  }

  async function handleTextRegister() {
    if (inFlight.current || !canRegisterText) return;
    inFlight.current = true;
    const activeSession = session.current;
    try {
      const res = await textEntry.mutateAsync({ content: content.trim() });
      if (session.current !== activeSession) return;
      const message = postingMessage(res.detail);
      const reviewed = res.detail?.posting?.transactionStatus;
      if (postingConfirmed(res.detail) && reviewed !== "pending_review" && reviewed !== "duplicate_suspected") {
        toast.success(message);
      } else {
        toast.message(message, { duration: 8000 });
      }
      onOpenChange(false);
    } catch (error) {
      if (session.current === activeSession) toast.error(errorMessage(error));
    } finally {
      inFlight.current = false;
    }
  }

  async function handleFieldsRegister() {
    if (inFlight.current) return;
    const amountInt = Number(amount.replace(/[,\s]/g, ""));
    if (!Number.isSafeInteger(amountInt) || amountInt <= 0) {
      toast.error("금액을 올바르게 입력해 주세요");
      return;
    }
    if (merchant.trim().length === 0) {
      toast.error("가맹점을 입력해 주세요");
      return;
    }
    const occurred = new Date(occurredAt);
    if (Number.isNaN(occurred.getTime())) {
      toast.error("날짜/시각을 올바르게 입력해 주세요");
      return;
    }
    inFlight.current = true;
    const activeSession = session.current;
    try {
      await fieldsEntry.mutateAsync({
        amount: amountInt,
        currency: "KRW",
        merchantRaw: merchant.trim(),
        occurredAt: occurred.toISOString(),
        transactionType: "approval",
        cardId: cardId === NONE ? undefined : cardId,
        categoryId: categoryId === NONE ? undefined : categoryId,
      });
      if (session.current !== activeSession) return;
      toast.success("거래가 등록됐어요");
      onOpenChange(false);
    } catch (error) {
      if (session.current === activeSession) toast.error(errorMessage(error));
    } finally {
      inFlight.current = false;
    }
  }

  const categoryOptions = categories.data ?? [];
  const cardOptions = useMemo(
    () => (cards.data ?? []).filter((c) => c.status === "active"),
    [cards.data],
  );

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent
        className="max-h-[90dvh] max-w-md overflow-y-auto overscroll-contain"
        onEscapeKeyDown={(event) => { if (inFlight.current) event.preventDefault(); }}
        onInteractOutside={(event) => { if (inFlight.current) event.preventDefault(); }}
      >
        <fieldset disabled={submitting} className="contents">
        <DialogHeader>
          <DialogTitle>거래 추가</DialogTitle>
          <DialogDescription>
            놓친 카드 결제를 문자 붙여넣기나 직접 입력으로 등록하세요.
          </DialogDescription>
        </DialogHeader>

        {submitting ? <p role="status" className="text-muted-foreground text-sm">등록 결과를 확인하고 있어요. 중복 등록을 막기 위해 잠시 기다려 주세요.</p> : null}
        {/* 모드 탭 */}
        <div className="bg-muted flex gap-1 rounded-xl p-1">
          {(
            [
              ["text", "문자 붙여넣기"],
              ["fields", "직접 입력"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                mode === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "text" ? (
          <div className="flex flex-col gap-3">
            <Label htmlFor="paste-content">카드 알림/문자 원문</Label>
            <textarea
              id="paste-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder={
                "예) 13,380원 결제\n공룡통장 카드 | 쿠팡(쿠페이)\n잔액 126,713원"
              }
              className="border-input bg-background focus-visible:ring-ring w-full resize-none rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none"
            />

            {/* 파싱 미리보기 */}
            {preview.isPending ? (
              <p className="text-muted-foreground text-sm">인식 중…</p>
            ) : previewData ? (
              <div className="bg-muted/50 flex flex-col gap-2 rounded-xl p-3 text-sm">
                {previewData.parseable ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">금액</span>
                      <span className="font-semibold">
                        {formatMoney(previewData.amount ?? 0, previewData.currency ?? "KRW")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">가맹점</span>
                      <span>{previewData.merchantRaw ?? "—"}</span>
                    </div>
                    {previewData.issuer && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">카드사</span>
                        <span>{previewData.issuer}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground">
                      금액을 인식하지 못했어요
                      {previewData.merchantRaw
                        ? ` (가맹점: ${previewData.merchantRaw})`
                        : ""}
                      .
                    </p>
                    <Button
                      type="button"
                      variant="tint"
                      size="sm"
                      onClick={switchToFieldsPrefilled}
                    >
                      직접 입력으로 전환
                    </Button>
                  </div>
                )}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={requestClose}
              >
                취소
              </Button>
              <Button
                type="button"
                onClick={handleTextRegister}
                disabled={!canRegisterText || submitting}
              >
                {textEntry.isPending ? "등록 중…" : "등록"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-amount">금액 (원)</Label>
              <Input
                id="f-amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="13380"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-merchant">가맹점</Label>
              <Input
                id="f-merchant"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="쿠팡(쿠페이)"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-occurred">날짜/시각</Label>
              <Input
                id="f-occurred"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-category">카테고리 (선택)</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="f-category">
                  <SelectValue placeholder="선택 안 함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>선택 안 함</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-card">카드 (선택)</Label>
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger id="f-card">
                  <SelectValue placeholder="선택 안 함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>선택 안 함</SelectItem>
                  {cardOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {cardIdentityLabel(c, memberNames)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={requestClose}
              >
                취소
              </Button>
              <Button
                type="button"
                onClick={handleFieldsRegister}
                disabled={submitting}
              >
                {fieldsEntry.isPending ? "등록 중…" : "등록"}
              </Button>
            </DialogFooter>
          </div>
        )}
        </fieldset>
      </DialogContent>
    </Dialog>
    <AlertDialog open={open && discardOpen} onOpenChange={setDiscardOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>입력을 그만둘까요?</AlertDialogTitle><AlertDialogDescription>아직 등록하지 않은 입력은 사라져요.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>계속 입력</AlertDialogCancel>
          <AlertDialogAction onClick={() => { setDiscardOpen(false); onOpenChange(false); }}>입력 버리기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
