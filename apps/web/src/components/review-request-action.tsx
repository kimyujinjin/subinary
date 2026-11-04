"use client";
/* ---------------------------------------------------------------------------
 * 결제 상세의 '가족에게 물어보기'(확인 요청).
 *
 * 결제 상세 대화상자는 크고 여러 작업이 만지는 곳이라, 이 기능은 자기 훅을 쓰는 독립
 * 컴포넌트로 한 줄만 끼운다. 가족 공개 결제에서만 보인다 — 나만 보기·요약 공개 결제를
 * 남에게 물어보면 공개 범위가 무의미해진다(서버도 같은 규칙으로 거절한다).
 * ------------------------------------------------------------------------- */
import type { TransactionSummary } from "@family/contracts";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

  const open = requests.data?.items ?? [];
  const received = open.find((item) => item.direction === "received");
  const sentTo = new Map(
    open
      .filter((item) => item.direction === "sent")
      .map((item) => [item.assigneeMemberId, item] as const)
  );
  const busy =
    disabled || create.isPending || resolve.isPending || requests.isLoading;
  const failure = create.error ?? resolve.error;

  return (
    <div className="flex flex-col gap-2">
      <Label>가족에게 물어보기</Label>
      {received ? (
        <div className="bg-accent flex flex-col gap-2 rounded-lg px-3 py-2.5">
          <p className="text-sm">
            {received.requesterName}님이 이 결제를 물어봤어요.
          </p>
          <Button
            variant="tint"
            className="h-11 w-full"
            disabled={busy}
            onClick={() => resolve.mutate(received.id)}
          >
            확인했어요
          </Button>
        </div>
      ) : null}
      {others.map((member) => {
        const sent = sentTo.get(member.memberId);
        return sent ? (
          <div
            key={member.memberId}
            className="bg-muted flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2"
          >
            <span className="text-sm">{member.name}님에게 물어봤어요</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => resolve.mutate(sent.id)}
              className="text-muted-foreground text-caption font-medium disabled:opacity-50"
            >
              취소
            </button>
          </div>
        ) : (
          <Button
            key={member.memberId}
            variant="tint"
            className="h-11 w-full"
            disabled={busy}
            onClick={() =>
              create.mutate({
                transactionId: txn.id,
                assigneeMemberId: member.memberId,
              })
            }
          >
            {member.name}님에게 물어보기
          </Button>
        );
      })}
      {failure ? (
        <p className="text-destructive text-sm" role="alert">
          {errorText(failure)}
        </p>
      ) : null}
    </div>
  );
}
