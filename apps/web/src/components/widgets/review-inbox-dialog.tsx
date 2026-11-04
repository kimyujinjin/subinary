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
 * 홈에 있던 것을 C-8에서 여기로 옮겼다 — `/todo`(전 기간 백로그)와 홈(최근 3일)이
 * **같은 확정 UI**를 써야 어느 쪽에서 처리하든 결과가 같기 때문이다.
 * ------------------------------------------------------------------------- */
import { useId, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  CardSmsEventDetail,
  CardSmsEventSummary,
} from "@family/contracts";

import { Button } from "@/components/ui/button";
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
import { formatDate } from "@/lib/format";
import { smsReviewAmountInput, smsReviewAmountMinorUnits } from "@/lib/sms-review-amount";

export function ReviewInboxDialog({
  open,
  events,
  onClose,
  onReviewed,
}: {
  open: boolean;
  /**
   * 이 목록의 **모든** 건에 대해 상세를 한 번에 받는다(원문이 요약에 없다). 그래서
   * 길게 넘기지 않는다 — 홈은 최근 3일, `/todo`는 사용자가 고른 한 건만 넘긴다.
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
          <DialogTitle>확인이 필요한 문자</DialogTitle>
          <DialogDescription>
            문자 상태를 먼저 확인해 주세요. 등록이 필요한 결제 문자라면
            금액·가맹점·일시를 확인한 뒤 등록할 수 있어요.
          </DialogDescription>
        </DialogHeader>
        {detailsQuery.isLoading ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            불러오는 중…
          </p>
        ) : detailsQuery.isError ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-muted-foreground text-sm" role="alert">
              문자 원문을 불러오지 못했어요. 아직 수정된 내용은 없어요.
            </p>
            <Button type="button" variant="outline" onClick={() => void detailsQuery.refetch()}>
              다시 불러오기
            </Button>
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {details.map((d) => d.parseStatus === "ignored" ? (
              <div key={d.id} className="bg-muted space-y-2 rounded-lg p-3">
                <p className="text-sm font-medium">결제 내역이 아닌 안내 문자예요</p>
                <p className="text-muted-foreground text-sm">거래 금액에 반영하지 않았어요. 문자는 보관돼 있어요.</p>
                <p className="text-sm break-words whitespace-pre-wrap">{d.rawContent}</p>
              </div>
            ) : d.parseStatus === "parse_failed" || d.parseStatus === "quarantined" ? (
              <ReviewEventCard key={d.id} detail={d} onReviewed={onReviewed} />
            ) : (
              <div key={d.id} className="bg-muted space-y-2 rounded-lg p-3">
                <p className="text-sm font-medium">이 문자는 현재 확정 대기 상태가 아니에요</p>
                <p className="text-muted-foreground text-sm">이미 처리됐거나 처리 중일 수 있어요. 거래 목록에서 결과를 확인해 주세요.</p>
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
 * 뽑은 값), 사용자가 고친 뒤 확정하면 거래가 생성된다.
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
        throw new Error("결제 금액·가맹점·일시·할부 개월을 확인해 주세요.");
      }
      if (declined) {
        return authedFetch((token) => api.cardSms.review(token, detail.id, { transactionType, currency }));
      }
      if (parsedAmount === null) throw new Error("결제 금액을 확인해 주세요.");
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
      toast.success(declined ? "거절 건으로 정리했어요" : requestedReuse ? "대표 거래와 같은 양식의 자동 정리 설정을 저장했어요" : "현재 거래 한 건을 등록했어요");
      // 검토 목록·거래·집계가 함께 바뀐다.
      void queryClient.invalidateQueries({ queryKey: ["card-sms-events"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["budgets"] });
      onReviewed?.();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "확정하지 못했어요",
      );
    },
  });

  return (
    <div className="bg-muted rounded-lg p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{detail.sender}</span>
        <span className="text-muted-foreground text-xs">
          {formatDate(detail.receivedAt)}
        </span>
      </div>
      <p className="text-foreground/90 text-[13px] break-words whitespace-pre-wrap">
        {detail.rawContent}
      </p>
      {detail.parseError ? (
        <details className="text-muted-foreground mt-2 text-xs">
          <summary className="cursor-pointer py-1">자동 인식 진단 보기</summary>
          <p className="mt-1 break-words">{detail.parseError}</p>
        </details>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        <Label htmlFor={`${inputId}-type`}>문자 유형</Label>
        <Select
          value={transactionType}
          onValueChange={(v) =>
            setTransactionType(v as "approval" | "cancellation" | "declined")
          }
        >
          <SelectTrigger id={`${inputId}-type`} className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approval">결제(승인)</SelectItem>
            <SelectItem value="cancellation">취소</SelectItem>
            <SelectItem value="declined">거절 — 거래 아님</SelectItem>
          </SelectContent>
        </Select>

        {declined ? (
          <p className="text-muted-foreground text-xs">
            승인되지 않은 문자예요. 확정하면 거래를 만들지 않고 정리만 해요.
          </p>
        ) : (
          <>
            <Label htmlFor={`${inputId}-amount`}>결제 금액 ({currency === "KRW" ? "원" : currency})</Label>
            <Input
              id={`${inputId}-amount`}
              className="h-11"
              inputMode={currency === "KRW" || currency === "JPY" ? "numeric" : "decimal"}
              placeholder="금액"
              value={amount}
              aria-invalid={amount.trim() !== "" && parsedAmount === null}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amount.trim() !== "" && parsedAmount === null ? (
              <p className="text-destructive text-xs" role="alert">문자에 표시된 결제 금액을 확인해 주세요.</p>
            ) : null}
            <Label htmlFor={`${inputId}-merchant`}>가맹점</Label>
            <Input
              id={`${inputId}-merchant`}
              className="h-11"
              placeholder="가맹점"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
            <Label htmlFor={`${inputId}-date`}>결제 일시</Label>
            <Input
              id={`${inputId}-date`}
              className="h-11"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
            {detail.occurredAt === null ? (
              <p className="text-muted-foreground text-xs">
                결제 일시를 읽지 못했어요. 문자 수신 시각({formatDate(detail.receivedAt)})과 다를 수 있으니 원문을 확인해 주세요.
              </p>
            ) : null}
            <Label htmlFor={`${inputId}-installment`}>할부 개월 (일시불은 비워 두세요)</Label>
            <Input
              id={`${inputId}-installment`}
              className="h-11"
              inputMode="numeric"
              value={installment}
              placeholder="일시불"
              aria-invalid={!validInstallment}
              onChange={(event) => setInstallment(event.target.value)}
            />
            {!validInstallment ? <p className="text-destructive text-xs" role="alert">할부는 1~60개월로 입력해 주세요.</p> : null}
          </>
        )}

        {!declined ? (
          <>
            <Label htmlFor={`${inputId}-card`}>사용한 카드</Label>
            <Select value={cardId || "none"} onValueChange={(value) => { setCardId(value === "none" ? "" : value); setReuseForSimilar(false); }}>
              <SelectTrigger id={`${inputId}-card`} className="h-11"><SelectValue placeholder="카드 선택" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">지정하지 않음 · 현재 한 건만</SelectItem>
                {cards.map((card) => <SelectItem key={card.id} value={card.id}>{card.alias} {card.maskedNumber ?? ""}{card.isShared ? " · 공용" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {cardQuery.isError || membersQuery.isError ? <p className="text-destructive text-xs">카드 소유 정보를 확인하지 못했어요. 자동 정리는 선택할 수 없어요.</p> : null}
            <label className="flex items-start gap-2 text-sm" htmlFor={`${inputId}-reuse`}>
              <input id={`${inputId}-reuse`} type="checkbox" className="mt-1" checked={requestedReuse} disabled={!canReuse || cardQuery.isError || membersQuery.isError} onChange={(event) => setReuseForSimilar(event.target.checked)} />
              <span>같은 양식의 대기 문자와 앞으로 수신할 문자를 자동 정리</span>
            </label>
            <p className="text-muted-foreground text-xs">
              본인에게 온 문자와 선택한 카드의 원화 승인에만 적용해요. 각 문자의 금액·시각을 따로 검증하며, 애매한 문자는 계속 확인을 기다려요. 선택하지 않으면 현재 한 건만 처리하고 기존 자동 정리 설정은 유지해요.
            </p>
          </>
        ) : null}

        <Button
          size="sm"
          className="min-h-11"
          disabled={!canSubmit || reviewMutation.isPending}
          onClick={() => reviewMutation.mutate()}
        >
          {reviewMutation.isPending ? "확정하는 중…" : requestedReuse ? "현재 한 건 확정하고 자동 정리 설정" : "현재 한 건만 확정"}
        </Button>
      </div>
    </div>
  );
}
