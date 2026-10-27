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
  events: CardSmsEventSummary[];
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
            아직 거래에 반영하지 않은 문자예요. 결제 문자라면 금액·가맹점·일시를
            확인한 뒤 등록해 주세요.
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
                <p className="text-muted-foreground text-sm">거래 금액에 반영하지 않았어요. 원문은 보관돼 있어요.</p>
                <p className="text-sm break-words whitespace-pre-wrap">{d.rawContent}</p>
              </div>
            ) : (
              <ReviewEventCard key={d.id} detail={d} onReviewed={onReviewed} />
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
  const { authedFetch } = useAuth();
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
  const [occurredAt, setOccurredAt] = useState(
    toLocalInputValue(detail.occurredAt),
  );

  const declined = transactionType === "declined";
  const parsedAmount = smsReviewAmountMinorUnits(amount, currency);
  const validOccurredAt = occurredAt !== "" && !Number.isNaN(new Date(occurredAt).getTime());
  const canSubmit =
    declined ||
    (parsedAmount !== null &&
      merchant.trim().length > 0 &&
      validOccurredAt);

  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!declined && (parsedAmount === null || !validOccurredAt || merchant.trim() === "")) {
        throw new Error("결제 금액·가맹점·일시를 확인해 주세요.");
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
      }));
    },
    onSuccess: () => {
      toast.success(declined ? "거절 건으로 정리했어요" : "거래로 등록했어요");
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
          </>
        )}

        <Button
          size="sm"
          className="min-h-11"
          disabled={!canSubmit || reviewMutation.isPending}
          onClick={() => reviewMutation.mutate()}
        >
          {reviewMutation.isPending ? "확정하는 중…" : "확정하기"}
        </Button>
      </div>
    </div>
  );
}
