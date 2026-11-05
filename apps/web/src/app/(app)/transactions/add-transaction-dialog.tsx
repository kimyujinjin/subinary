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
 *
 * 2026-11-05 HIG 검수 3·4단계: 금액은 자릿수 콤마와 '원'이 붙는 AmountInput, 문자 칸은 Input과 같은
 * 모양의 Textarea, 읽은 결과는 상세 줄(FieldRow)로 보여 준다. 버튼은 '추가하기'·'닫기'이고, 입력을
 * 버리는 확인은 액션 시트의 빨간 '버리기'다. 직접 입력 검증·미리보기 옮기기는 `add-transaction-form.ts`.
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
import { AmountInput } from "@/components/ui/amount-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldList, FieldRow } from "@/components/widgets/field-row";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { ApiError } from "@/lib/api-client";
import { formatMoney, formatMonthDayTime } from "@/lib/format";
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

import {
  manualFieldErrors,
  previewPrefill,
  toLocalInputValue,
  type ManualFieldErrors,
} from "./add-transaction-form";
import { DEVICE_TIME_ZONE_NOTE, deviceMatchesSeoulTime } from "./device-time";

/** Select에서 "선택 안 함"을 표현하는 sentinel(Radix는 빈 문자열 value 금지). */
const NONE = "__none__";

type Mode = "text" | "fields";

/** datetime-local 기본값(현재 시각, 로컬). `YYYY-MM-DDTHH:mm`. */
function nowLocalInput(): string {
  return toLocalInputValue(new Date());
}

/**
 * 서버의 문자 파서가 카드사를 알아보지 못하면 카드사 자리에 그냥 '카드'를 넣는다
 * (`packages/card-parsers` generic 파서). '카드사: 카드'는 알려 주는 게 없어 줄을 숨긴다.
 */
const UNKNOWN_ISSUER = "카드";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "처리하지 못했어요. 잠시 뒤 다시 해 주세요.";
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
  const [fieldErrors, setFieldErrors] = useState<ManualFieldErrors>({});
  const [submitErrors, setSubmitErrors] = useState<Partial<Record<Mode, string>>>({});
  // 날짜·시간 칸은 기기 시간대로 읽고 쓰고, 문자 미리보기·목록은 한국 시간이다 — 둘이 다를 때(해외)만 칸 아래에 기준을 알린다.
  const deviceZoneDiffers = !deviceMatchesSeoulTime(new Date(occurredAt));
  const amountInput = useRef<HTMLInputElement>(null);
  const merchantInput = useRef<HTMLInputElement>(null);
  const occurredAtInput = useRef<HTMLInputElement>(null);

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
    setFieldErrors({});
    setSubmitErrors({});
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
  const previewError = mode === "text" && preview.isError && preview.variables?.content === content.trim() ? preview.error : null;
  const canRegisterText = Boolean(previewData?.parseable);

  const submitting = textEntry.isPending || fieldsEntry.isPending;
  const requestClose = () => {
    if (inFlight.current) {
      toast.message("거래를 추가하고 있어요. 끝나면 닫을 수 있어요.");
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
  const clearSubmitError = (entryMode: Mode) => setSubmitErrors((errors) => ({ ...errors, [entryMode]: undefined }));

  /** 미리보기 결과를 직접 입력 폼에 채우고 폼 모드로 전환. */
  function switchToFieldsPrefilled() {
    if (previewData) {
      // 직접 입력 폼은 원화 전용이다. 외화의 저장 금액을 원화로 채우면 오계상된다(previewPrefill이 비운다).
      const prefill = previewPrefill(previewData);
      setAmount(prefill.amount);
      if (prefill.merchant !== undefined) setMerchant(prefill.merchant);
      if (prefill.occurredAt !== undefined) setOccurredAt(prefill.occurredAt);
    }
    setFieldErrors({});
    clearSubmitError("fields");
    setMode("fields");
  }

  async function handleTextRegister() {
    if (inFlight.current || !canRegisterText) return;
    clearSubmitError("text");
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
      if (session.current === activeSession) setSubmitErrors((errors) => ({ ...errors, text: errorMessage(error) }));
    } finally {
      inFlight.current = false;
    }
  }

  async function handleFieldsRegister() {
    if (inFlight.current) return;
    clearSubmitError("fields");
    const amountInt = Number(amount.replace(/[,\s]/g, ""));
    const occurred = new Date(occurredAt);
    const errors = manualFieldErrors({ amount, merchant, occurredAt });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      (errors.amount ? amountInput : errors.merchant ? merchantInput : occurredAtInput).current?.focus();
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
      toast.success("거래를 추가했어요");
      onOpenChange(false);
    } catch (error) {
      if (session.current === activeSession) setSubmitErrors((errors) => ({ ...errors, fields: errorMessage(error) }));
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
            빠진 카드 결제를 문자로 붙여넣거나 직접 적어서 추가해요.
          </DialogDescription>
        </DialogHeader>

        {/*
          진행은 버튼 글자('추가하는 중…')로 보이고, 화면 읽기 프로그램에는 이 줄로 알린다.
          알림 영역은 미리 있어야 바뀐 글자를 읽어 주므로 줄은 늘 두고 글자만 바꾼다.
        */}
        <p role="status" className="sr-only">{submitting ? "거래를 추가하고 있어요. 두 번 들어가지 않게 잠시 기다려 주세요." : ""}</p>
        {/* 모드 탭 — 바깥 16px(rounded-card) 안쪽 4px 여백 + 안 12px(rounded-control)로 모서리 중심을 맞춘다. */}
        <div className="bg-muted rounded-card flex gap-1 p-1">
          {(
            [
              ["text", "문자 붙여넣기"],
              ["fields", "직접 입력"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setMode(value); clearSubmitError(value); }}
              aria-pressed={mode === value}
              className={cn(
                "text-body rounded-control min-h-11 flex-1 px-3 py-2 font-medium transition",
                mode === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground active:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "text" ? (
          <div className="flex flex-col gap-3">
            <Label htmlFor="paste-content">카드 결제 문자</Label>
            <Textarea
              id="paste-content"
              value={content}
              onChange={(e) => { setContent(e.target.value); clearSubmitError("text"); }}
              rows={5}
              aria-invalid={Boolean(previewError)}
              aria-describedby={previewError ? "paste-preview-error" : undefined}
              placeholder={"받은 결제 문자를 그대로 붙여넣어 주세요.\n예) 신한카드 13,380원 승인 쿠팡"}
              className="whitespace-pre-wrap"
            />

            {/* 읽은 결과 — 추가하기 전에 금액·가맹점이 맞는지 보는 자리. 한 번에 한 가지만 보인다. */}
            {preview.isPending ? (
              <p role="status" className="text-caption text-muted-foreground">문자를 읽고 있어요…</p>
            ) : previewError ? (
              <div className="flex flex-col gap-2">
                <InlineNotice tone="error" id="paste-preview-error">
                  문자를 읽지 못했어요. {errorMessage(previewError)}
                </InlineNotice>
                <Button type="button" variant="tint" className="min-h-11" onClick={switchToFieldsPrefilled}>직접 입력하기</Button>
              </div>
            ) : previewData ? (
              previewData.parseable ? (
                <div className="flex flex-col gap-1">
                  <p className="text-caption text-muted-foreground">문자에서 이렇게 읽었어요</p>
                  <FieldList>
                    <FieldRow
                      label="금액"
                      value={formatMoney(previewData.amount ?? 0, previewData.currency ?? "KRW")}
                    />
                    <FieldRow
                      label="가맹점"
                      value={previewData.merchantRaw ?? "—"}
                      muted={!previewData.merchantRaw}
                    />
                    {previewData.occurredAt ? (
                      <FieldRow label="날짜·시간" value={formatMonthDayTime(previewData.occurredAt)} />
                    ) : null}
                    {previewData.issuer && previewData.issuer !== UNKNOWN_ISSUER ? (
                      <FieldRow label="카드사" value={previewData.issuer} />
                    ) : null}
                  </FieldList>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <InlineNotice>
                    {previewData.merchantRaw
                      ? `금액을 찾지 못했어요. 직접 입력하면 가맹점(${previewData.merchantRaw})은 채워 둘게요.`
                      : "금액을 찾지 못했어요. 직접 입력으로 적어 주세요."}
                  </InlineNotice>
                  <Button
                    type="button"
                    variant="tint"
                    className="min-h-11"
                    onClick={switchToFieldsPrefilled}
                  >
                    직접 입력하기
                  </Button>
                </div>
              )
            ) : null}

            {submitErrors.text ? <InlineNotice tone="error">{submitErrors.text}</InlineNotice> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={requestClose}
              >
                닫기
              </Button>
              <Button
                type="button"
                onClick={handleTextRegister}
                disabled={!canRegisterText || submitting}
              >
                {textEntry.isPending ? "추가하는 중…" : "추가하기"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-amount">금액</Label>
              {/* 원화 전용 칸이라 currency를 주지 않는다(단위 '원', 소수 없음). */}
              <AmountInput
                id="f-amount"
                ref={amountInput}
                aria-invalid={Boolean(fieldErrors.amount)}
                aria-describedby={fieldErrors.amount ? "f-amount-error" : undefined}
                value={amount}
                onValueChange={(raw) => { setAmount(raw); setFieldErrors((errors) => ({ ...errors, amount: undefined })); clearSubmitError("fields"); }}
                placeholder="0"
              />
              {fieldErrors.amount ? <p id="f-amount-error" role="alert" className="text-caption text-destructive">{fieldErrors.amount}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-merchant">가맹점</Label>
              <Input
                id="f-merchant"
                ref={merchantInput}
                className="min-h-11"
                aria-invalid={Boolean(fieldErrors.merchant)}
                aria-describedby={fieldErrors.merchant ? "f-merchant-error" : undefined}
                value={merchant}
                onChange={(e) => { setMerchant(e.target.value); setFieldErrors((errors) => ({ ...errors, merchant: undefined })); clearSubmitError("fields"); }}
                placeholder="쿠팡(쿠페이)"
              />
              {fieldErrors.merchant ? <p id="f-merchant-error" role="alert" className="text-caption text-destructive">{fieldErrors.merchant}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-occurred">날짜·시간</Label>
              <Input
                id="f-occurred"
                ref={occurredAtInput}
                type="datetime-local"
                className="min-h-11 min-w-0 w-full"
                aria-invalid={Boolean(fieldErrors.occurredAt)}
                aria-describedby={[fieldErrors.occurredAt ? "f-occurred-error" : null, deviceZoneDiffers ? "f-occurred-zone" : null].filter(Boolean).join(" ") || undefined}
                value={occurredAt}
                onChange={(e) => { setOccurredAt(e.target.value); setFieldErrors((errors) => ({ ...errors, occurredAt: undefined })); clearSubmitError("fields"); }}
              />
              {fieldErrors.occurredAt ? <p id="f-occurred-error" role="alert" className="text-caption text-destructive">{fieldErrors.occurredAt}</p> : null}
              {deviceZoneDiffers ? <p id="f-occurred-zone" className="text-caption text-muted-foreground">{DEVICE_TIME_ZONE_NOTE}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-category">카테고리 (선택)</Label>
              <Select value={categoryId} onValueChange={(value) => { setCategoryId(value); clearSubmitError("fields"); }}>
                <SelectTrigger id="f-category" className="min-h-11 w-full min-w-0">
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
              <Select value={cardId} onValueChange={(value) => { setCardId(value); clearSubmitError("fields"); }}>
                <SelectTrigger id="f-card" className="min-h-11 w-full min-w-0">
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

            {submitErrors.fields ? <InlineNotice tone="error">{submitErrors.fields}</InlineNotice> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={requestClose}
              >
                닫기
              </Button>
              <Button
                type="button"
                onClick={handleFieldsRegister}
                disabled={submitting}
              >
                {fieldsEntry.isPending ? "추가하는 중…" : "추가하기"}
              </Button>
            </DialogFooter>
          </div>
        )}
        </fieldset>
      </DialogContent>
    </Dialog>
    <AlertDialog open={open && discardOpen} onOpenChange={setDiscardOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>입력한 내용을 버릴까요?</AlertDialogTitle><AlertDialogDescription>아직 추가하지 않은 거래는 사라져요.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>계속 입력하기</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { setDiscardOpen(false); onOpenChange(false); }}>버리기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
