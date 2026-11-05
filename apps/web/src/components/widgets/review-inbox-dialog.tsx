"use client";
/* ---------------------------------------------------------------------------
 * 검토 대기 카드 문자 다이얼로그 (ADR-0023 S3)
 *
 * 두 종류를 한 목록으로 보여준다:
 *  - `parse_failed` — 규칙 파서가 못 읽은 문자(값이 비어 있다).
 *  - `quarantined`  — LLM이 원문에서 추출했지만 **사람 확인 전이라 거래로 승격되지
 *                     않은** 건. 값이 미리 채워져 있어 확인만 하면 된다.
 *
 * 요약 목록엔 원문이 없어 열릴 때 상세(GET /v1/card-sms-events/:id)를 받아 원문을
 * 보여주고, 그 자리에서 교정·확정할 수 있게 한다. 확정하면 거래가 만들어지고
 * 동시에 학습 라벨(`human_confirmed`)이 기록된다.
 *
 * 홈에 있던 것을 C-8에서 여기로 옮겼다 — 지금은 `/todo`가 쓰고, 홈은 건수만 세어 그 화면으로
 * 보낸다. 어느 진입점에서 처리하든 결과가 같도록 확정 UI는 이것 하나다.
 *
 * 화면 글자에는 내부 용어(원문·확정 대기·파싱)를 쓰지 않는다 — '받은 문자', '등록하기'로 말한다
 * (2026-11-05 HIG 검수). 서버 판정 코드는 할 일이 달라지는 것만 우리말 한 줄로 옮긴다.
 * ------------------------------------------------------------------------- */
import { useId, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  CardSmsEventDetail,
  CardSmsEventSummary,
} from "@family/contracts";

import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { api, apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useCardList, useHouseholdMembers } from "@/lib/queries";
import { formatMonthDayTime, formatSender } from "@/lib/format";
import { smsReviewAmountInput, smsReviewAmountMinorUnits } from "@/lib/sms-review-amount";
import { smsReviewReasonText, smsSourceName } from "@/lib/sms-review-copy";

import { ErrorState } from "./error-state";
import { ListLoading } from "./list-loading";

export function ReviewInboxDialog({
  open,
  events,
  onClose,
  onReviewed,
}: {
  open: boolean;
  /**
   * 이 목록의 **모든** 건에 대해 상세를 한 번에 받는다(원문이 요약에 없다). 그래서
   * 길게 넘기지 않는다 — `/todo`는 사용자가 고른 한 건만 넘긴다.
   */
  events: Pick<CardSmsEventSummary, "id">[];
  onClose: () => void;
  /** 한 건을 확정한 뒤 호출(단건으로 열었을 때 다이얼로그를 닫는 용도). */
  onReviewed?: () => void;
}) {
  const { authedFetch } = useAuth();
  const ids = events.map((e) => e.id);
  const detailsQuery = useQuery({
    queryKey: ["card-sms-events-detail", ids],
    enabled: open && ids.length > 0,
    queryFn: () =>
      authedFetch((token) =>
        Promise.all(
          ids.map((id) =>
            apiFetch<CardSmsEventDetail>(`/v1/card-sms-events/${id}`, {
              accessToken: token,
            }),
          ),
        ),
      ),
  });
  const details = detailsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>확인할 문자</DialogTitle>
          <DialogDescription>
            받은 문자를 보고 금액·가맹점·날짜·시간이 맞는지 확인해 주세요.
            맞으면 거래로 등록해요.
          </DialogDescription>
        </DialogHeader>
        {detailsQuery.isLoading ? (
          <ListLoading rows={1} label="받은 문자를 불러오는 중이에요." />
        ) : detailsQuery.isError ? (
          <ErrorState
            message="받은 문자를 불러오지 못했어요. 바뀐 내용은 없어요."
            retrying={detailsQuery.isFetching}
            onRetry={() => void detailsQuery.refetch()}
          />
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {details.map((d) => d.parseStatus === "ignored" ? (
              <div key={d.id} className="bg-muted rounded-control space-y-2 p-3">
                <p className="text-body font-semibold">결제 내역이 아닌 안내 문자예요</p>
                <p className="text-muted-foreground text-caption">거래 금액에 반영하지 않았어요. 문자는 보관돼 있어요.</p>
                <p className="text-body break-words whitespace-pre-wrap">{d.rawContent}</p>
              </div>
            ) : d.parseStatus === "parse_failed" || d.parseStatus === "quarantined" ? (
              <ReviewEventCard key={d.id} detail={d} onReviewed={onReviewed} />
            ) : (
              <div key={d.id} className="bg-muted rounded-control space-y-2 p-3">
                <p className="text-body font-semibold">지금은 확인할 게 없는 문자예요</p>
                <p className="text-muted-foreground text-caption">이미 거래에 반영됐거나 반영하는 중일 수 있어요. 가계부에서 확인해 주세요.</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** `datetime-local` 입력용 로컬 시각 문자열(YYYY-MM-DDTHH:mm). */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(
    at.getHours(),
  )}:${pad(at.getMinutes())}`;
}

/**
 * 문자 한 건의 원문 + 교정 폼. 값은 파싱 결과로 미리 채워지며(quarantined는 LLM이
 * 뽑은 값), 사용자가 고친 뒤 등록하면 거래가 생성된다.
 */
function ReviewEventCard({
  detail,
  onReviewed,
}: {
  detail: CardSmsEventDetail;
  onReviewed?: () => void;
}) {
  const { authedFetch, user } = useAuth();
  const cardQuery = useCardList();
  const membersQuery = useHouseholdMembers();
  const actorMemberId = membersQuery.data?.find((member) => member.userId === user?.id)?.memberId;
  const cards = (cardQuery.data ?? []).filter((card) => card.status === "active" && (card.isShared || card.ownerMemberId === actorMemberId));
  const [cardId, setCardId] = useState<string>("");
  const [reuseForSimilar, setReuseForSimilar] = useState(false);
  const queryClient = useQueryClient();
  const inputId = useId();
  const currency = detail.currency ?? "KRW";
  // 서버 판정 코드(영문)는 그대로 보여 주지 않는다 — 할 일이 달라지는 것만 우리말 한 줄로.
  const reason = smsReviewReasonText(detail.parseError);
  const [transactionType, setTransactionType] = useState<
    "approval" | "cancellation" | "declined"
  >(
    detail.transactionType === "cancellation" ||
      detail.transactionType === "declined"
      ? detail.transactionType
      : "approval",
  );
  const [amount, setAmount] = useState(
    smsReviewAmountInput(detail.amount, currency),
  );
  const [merchant, setMerchant] = useState(detail.merchantRaw ?? "");
  const [installment, setInstallment] = useState(detail.installmentMonths && detail.installmentMonths > 1 ? detail.installmentMonths.toString() : "");
  const [occurredAt, setOccurredAt] = useState(
    toLocalInputValue(detail.occurredAt),
  );

  const declined = transactionType === "declined";
  const canReuse = transactionType === "approval" && currency === "KRW" && cards.some((card) => card.id === cardId);
  const requestedReuse = reuseForSimilar && canReuse;
  const parsedAmount = smsReviewAmountMinorUnits(amount, currency);
  const amountInvalid = amount.trim() !== "" && parsedAmount === null;
  const installmentMonths = installment.trim() === "" ? 1 : Number(installment);
  const validInstallment = Number.isInteger(installmentMonths) && installmentMonths >= 1 && installmentMonths <= 60;
  const validOccurredAt = occurredAt !== "" && !Number.isNaN(new Date(occurredAt).getTime());
  const canSubmit =
    declined ||
    (parsedAmount !== null &&
      merchant.trim().length > 0 &&
      validInstallment &&
      validOccurredAt);

  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!declined && (parsedAmount === null || !validOccurredAt || merchant.trim() === "" || !validInstallment)) {
        throw new Error("금액·가맹점·날짜·시간·할부 개월을 확인해 주세요.");
      }
      if (declined) {
        return authedFetch((token) => api.cardSms.review(token, detail.id, { transactionType, currency }));
      }
      if (parsedAmount === null) throw new Error("금액을 확인해 주세요.");
      return authedFetch((token) => api.cardSms.review(token, detail.id, {
        transactionType,
        currency,
        amount: parsedAmount,
        merchantRaw: merchant.trim(),
        occurredAt: new Date(occurredAt).toISOString(),
        installmentMonths,
        ...(cardId ? { cardId, issuer: cards.find((card) => card.id === cardId)?.issuer } : {}),
        reuseForSimilar: requestedReuse,
      }));
    },
    onSuccess: () => {
      // 창이 닫혀 새 거래가 이 화면에 보이지 않으므로 한 일을 토스트로 말한다.
      toast.success(declined ? "결제 실패 문자로 정리했어요" : requestedReuse ? "거래를 등록하고 같은 모양 문자 자동 정리를 켰어요" : "거래 한 건을 등록했어요");
      // 검토 목록·거래·집계가 함께 바뀐다.
      void queryClient.invalidateQueries({ queryKey: ["card-sms-events"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["budgets"] });
      onReviewed?.();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "등록하지 못했어요. 다시 시도해 주세요.",
      );
    },
  });

  return (
    <div>
      {/* 받은 문자만 회색 상자에 둔다 — 입력 칸(회색 채움)이 같은 회색 위에 놓이면 칸 경계가 보이지 않는다. */}
      <div className="bg-muted rounded-control p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-caption min-w-0 truncate font-semibold">
            {smsSourceName(detail.sender, detail.issuer) ?? formatSender(detail.sender)}
          </span>
          <span className="text-muted-foreground text-caption shrink-0">
            {formatMonthDayTime(detail.receivedAt)}
          </span>
        </div>
        <p className="text-foreground/90 text-body break-words whitespace-pre-wrap">
          {detail.rawContent}
        </p>
      </div>
      {reason ? (
        <p className="text-muted-foreground text-caption mt-2">{reason}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        <Label htmlFor={`${inputId}-type`}>문자 종류</Label>
        <Select
          value={transactionType}
          onValueChange={(v) =>
            setTransactionType(v as "approval" | "cancellation" | "declined")
          }
        >
          <SelectTrigger id={`${inputId}-type`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approval">결제</SelectItem>
            <SelectItem value="cancellation">결제 취소</SelectItem>
            <SelectItem value="declined">결제 실패(거래 아님)</SelectItem>
          </SelectContent>
        </Select>

        {declined ? (
          <p className="text-muted-foreground text-caption">
            결제되지 않은 문자예요. 거래로 넣지 않고 정리만 해요.
          </p>
        ) : (
          <>
            {/* 칸 이름은 문자 종류(결제·결제 취소)와 상관없이 거래 추가·수정 창과 같은 '금액'·'날짜·시간'으로 둔다. */}
            <Label htmlFor={`${inputId}-amount`}>금액</Label>
            <AmountInput
              id={`${inputId}-amount`}
              currency={currency}
              placeholder="0"
              value={amount}
              aria-invalid={amountInvalid}
              aria-describedby={amountInvalid ? `${inputId}-amount-error` : undefined}
              onValueChange={setAmount}
            />
            {amountInvalid ? (
              <p id={`${inputId}-amount-error`} className="text-destructive text-caption" role="alert">받은 문자에 적힌 금액을 확인해 주세요.</p>
            ) : null}
            <Label htmlFor={`${inputId}-merchant`}>가맹점</Label>
            <Input
              id={`${inputId}-merchant`}
              placeholder="가맹점"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
            <Label htmlFor={`${inputId}-date`}>날짜·시간</Label>
            <Input
              id={`${inputId}-date`}
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
            {detail.occurredAt === null ? (
              <p className="text-muted-foreground text-caption">
                {transactionType === "cancellation" ? "취소한" : "결제한"} 날짜·시간을 문자에서 읽지 못했어요. 문자를 받은 시각({formatMonthDayTime(detail.receivedAt)})과 다를 수 있으니 받은 문자를 보고 입력해 주세요.
              </p>
            ) : null}
            <Label htmlFor={`${inputId}-installment`}>할부 개월 (일시불은 비워 두세요)</Label>
            <Input
              id={`${inputId}-installment`}
              inputMode="numeric"
              value={installment}
              placeholder="일시불"
              aria-invalid={!validInstallment}
              aria-describedby={validInstallment ? undefined : `${inputId}-installment-error`}
              onChange={(event) => setInstallment(event.target.value)}
            />
            {!validInstallment ? <p id={`${inputId}-installment-error`} className="text-destructive text-caption" role="alert">할부는 1~60개월로 입력해 주세요.</p> : null}
          </>
        )}

        {!declined ? (
          <>
            <Label htmlFor={`${inputId}-card`}>사용한 카드</Label>
            <Select value={cardId || "none"} onValueChange={(value) => { setCardId(value === "none" ? "" : value); setReuseForSimilar(false); }}>
              <SelectTrigger id={`${inputId}-card`} className="w-full"><SelectValue placeholder="카드 고르기" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">고르지 않음</SelectItem>
                {cards.map((card) => <SelectItem key={card.id} value={card.id}>{card.alias} {card.maskedNumber ?? ""}{card.isShared ? " · 공용" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {cardQuery.isError || membersQuery.isError ? <p className="text-destructive text-caption">카드 정보를 불러오지 못해 자동 정리는 고를 수 없어요.</p> : null}
            {/* 줄 전체가 label이라 상자(16px)가 아니라 44px 줄을 누르면 된다. */}
            <label className="text-body flex min-h-11 items-center gap-3" htmlFor={`${inputId}-reuse`}>
              <Checkbox id={`${inputId}-reuse`} checked={requestedReuse} disabled={!canReuse || cardQuery.isError || membersQuery.isError} onChange={(event) => setReuseForSimilar(event.target.checked)} />
              <span>확인을 기다리는 같은 모양의 문자와 앞으로 올 문자도 자동으로 정리하기</span>
            </label>
            <p className="text-muted-foreground text-caption">
              내게 온 문자와 고른 카드의 원화 결제에만 적용해요. 문자마다 금액·시각을 따로 확인하고, 애매한 문자는 계속 여기서 확인을 기다려요. 고르지 않으면 이 문자만 등록하고 기존 자동 정리 설정은 그대로예요.
            </p>
          </>
        ) : null}

        <Button
          className="mt-1"
          disabled={!canSubmit || reviewMutation.isPending}
          onClick={() => reviewMutation.mutate()}
        >
          {reviewMutation.isPending
            ? declined ? "정리하는 중…" : "등록하는 중…"
            : declined ? "결제 실패로 정리하기" : requestedReuse ? "등록하고 자동 정리 켜기" : "거래로 등록하기"}
        </Button>
      </div>
    </div>
  );
}
