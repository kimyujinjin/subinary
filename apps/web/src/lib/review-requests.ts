"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족에게 결제 물어보기(확인 요청)
 *
 * `queries.ts`에 합치지 않는다 — 그 파일은 여러 작업이 동시에 만지는 지점이고, 이 기능은
 * 화면 세 곳(홈 줄·할 일 섹션·결제 상세)만 쓴다. 요청 규약은 공용 `apiFetch`를 그대로
 * 통과시켜 401 재시도·토큰 헤더가 두 벌이 되지 않게 한다.
 * ------------------------------------------------------------------------- */
import {
  reviewRequestListResponseSchema,
  reviewRequestResolveResponseSchema,
  reviewRequestSummarySchema,
  type ReviewRequestListResponse,
} from "@family/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";

export const reviewRequestsKey = (
  householdId: string | null,
  transactionId: string | null
) => ["review-requests", householdId, transactionId] as const;

/** 나와 관련된 열린 요청. `transactionId`를 주면 그 결제만(결제 상세). */
export function useReviewRequests(
  transactionId: string | null,
  opts?: { refetchInterval?: number; enabled?: boolean }
): UseQueryResult<ReviewRequestListResponse> {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  return useQuery({
    queryKey: reviewRequestsKey(householdId, transactionId),
    enabled: householdId != null && (opts?.enabled ?? true),
    refetchInterval: opts?.refetchInterval,
    queryFn: () =>
      authedFetch(async (token) => {
        const params = new URLSearchParams({
          householdId: householdId as string,
        });
        if (transactionId) params.set("transactionId", transactionId);
        return reviewRequestListResponseSchema.parse(
          await apiFetch(`/v1/review-requests?${params.toString()}`, {
            accessToken: token,
          })
        );
      }),
  });
}

function useInvalidateReviewRequests() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["review-requests"] });
}

/** 가족 한 사람에게 이 결제를 물어본다. 이미 물어봤으면 같은 요청이 돌아온다(알림은 한 번). */
export function useCreateReviewRequest() {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const invalidate = useInvalidateReviewRequests();
  return useMutation({
    mutationFn: (input: { transactionId: string; assigneeMemberId: string }) =>
      authedFetch(async (token) =>
        reviewRequestSummarySchema.parse(
          await apiFetch("/v1/review-requests", {
            accessToken: token,
            method: "POST",
            body: { householdId, ...input },
          })
        )
      ),
    onSuccess: () => invalidate(),
  });
}

/** 받은 사람은 '확인했어요', 물어본 사람은 취소. */
export function useResolveReviewRequest() {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const invalidate = useInvalidateReviewRequests();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch(async (token) =>
        reviewRequestResolveResponseSchema.parse(
          await apiFetch(
            `/v1/review-requests/${encodeURIComponent(id)}/resolve`,
            {
              accessToken: token,
              method: "POST",
              body: { householdId },
            }
          )
        )
      ),
    onSuccess: () => invalidate(),
  });
}
