"use client";
/* ---------------------------------------------------------------------------
 * 결제 상세의 '가족에게 물어보기'(확인 요청).
 *
 * 결제 상세 대화상자는 크고 여러 작업이 만지는 곳이라, 이 기능은 자기 훅을 쓰는 독립
 * 컴포넌트로 한 줄만 끼운다. 가족 공개 결제에서만 보인다 — 나만 보기·요약 공개 결제를
 * 남에게 물어보면 공개 범위가 무의미해진다(서버도 같은 규칙으로 거절한다).
 *
 * 상세 정보 목록(FieldList)의 한 줄이다(2026-11-05 HIG 검수 3·4단계). 예전에는 폼 라벨 아래 구성원마다
 * 전체 폭 버튼이 붙어, 모든 가족 공개 결제에서 '이 가맹점 최근 결제'를 아래로 밀었다. 줄을 누르면 물어볼
 * 사람을 고르는 메뉴가 그 자리에서 펼쳐진다(값 고르기와 같은 PickerMenu — 시트 위에 창을 겹치지 않는다).
 * 물어본 사람·받은 요청과 오류는 그 줄 아래에 붙는다.
 * ------------------------------------------------------------------------- */
import type { TransactionSummary } from "@family/contracts";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldRow } from "@/components/widgets/field-row";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHouseholdMembers } from "@/lib/queries";
import {
  useCreateReviewRequest,
  useResolveReviewRequest,
  useReviewRequests,
} from "@/lib/review-requests";

function errorText(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export function ReviewRequestAction({
  txn,
  disabled,
}: {
  txn: Pick<TransactionSummary, "id" | "visibility" | "masked">;
  disabled?: boolean;
}) {
  const { user } = useAuth();
  const members = useHouseholdMembers();
  const shareable = txn.visibility === "household" && !txn.masked;
  const requests = useReviewRequests(txn.id, { enabled: shareable });
  const create = useCreateReviewRequest();
  const resolve = useResolveReviewRequest();

  if (!shareable || !user || !members.data) return null;
  const others = members.data.filter(
    (member) => member.status === "active" && member.userId !== user.id
  );
  if (others.length === 0) return null;
  // 이미 물어봤는지 모르는 채로 메뉴를 열면 같은 사람을 다시 고르게 된다 — 요청 목록을 받은 뒤에 그린다.
  if (requests.isLoading) return null;

  const open = requests.data?.items ?? [];
  const received = open.find((item) => item.direction === "received");
  const sentTo = new Map(
    open
      .filter((item) => item.direction === "sent")
      .map((item) => [item.assigneeMemberId, item] as const)
  );
  const asked = others.filter((member) => sentTo.has(member.memberId));
  const askable = others.filter((member) => !sentTo.has(member.memberId));
  const pending = create.isPending || resolve.isPending;
  const locked = disabled || pending;
  const failure = create.error ?? resolve.error;

  const summary =
    asked.length > 0
      ? `${asked.map((member) => member.name).join("·")}님 답을 기다려요`
      : "";
  const notes =
    received || asked.length > 0 || failure ? (
      <div className="flex min-w-0 flex-col gap-1">
        {received ? (
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="text-body text-foreground min-w-0 break-words">
              {received.requesterName}님이 이 결제를 물어봤어요
            </span>
            <Button
              type="button"
              variant="weak"
              size="sm"
              disabled={locked}
              onClick={() => resolve.mutate(received.id)}
            >
              확인했어요
            </Button>
          </div>
        ) : null}
        {asked.map((member) => {
          const sent = sentTo.get(member.memberId);
          return sent ? (
            <button
              key={member.memberId}
              type="button"
              disabled={locked}
              onClick={() => resolve.mutate(sent.id)}
              className="text-caption text-primary focus-visible:outline-ring inline-flex min-h-11 items-center self-start font-medium focus-visible:outline-2 active:opacity-60 disabled:opacity-50"
            >
              {member.name}님에게 그만 물어보기
            </button>
          ) : null;
        })}
        {failure ? (
          <InlineNotice tone="error">{errorText(failure)}</InlineNotice>
        ) : null}
      </div>
    ) : undefined;

  return (
    <FieldRow
      label="가족에게 물어보기"
      value={
        pending ? (
          <span className="inline-flex items-center justify-end gap-1.5">
            <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
            <span className="sr-only">보내는 중</span>
            {summary}
          </span>
        ) : (
          summary
        )
      }
      disabled={disabled}
      menu={
        askable.length > 0
          ? {
              label: "물어볼 사람",
              options: askable.map((member) => ({
                value: member.memberId,
                label: `${member.name}님에게 물어보기`,
              })),
              value: null,
              // 잠긴(흐린) 줄도 폰에서는 메뉴가 열린다(Radix 트리거가 자식 버튼의 disabled를 보지 않는다) — 그동안 고른 사람은 버린다.
              onSelect: (memberId) => {
                if (disabled) return;
                create.mutate({
                  transactionId: txn.id,
                  assigneeMemberId: memberId,
                });
              },
            }
          : undefined
      }
    >
      {notes}
    </FieldRow>
  );
}
