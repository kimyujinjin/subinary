/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가맹점 정리·분류 검토 보조 API
 *
 * `queries.ts`·`api-client.ts`는 여러 작업이 동시에 만지는 공유 지점이라 여기에 둔다
 * (`recurring-api.ts`와 같은 이유). 공용 `apiFetch`를 그대로 통과시켜 인증·에러 변환·
 * 네이티브 헤더 규약이 갈라지지 않게 한다.
 * ------------------------------------------------------------------------- */
import type {
  MerchantIdentityRejectResponse,
  RecurringRecomputeResponse,
} from "@family/contracts";

import { apiFetch } from "@/lib/api-client";

/**
 * 잘린 이름 제안 거절 — "같은 가게가 아니에요".
 *
 * 브랜드 제안 거절과 **같은 경로**(`identity-feedback`)에 `truncation`으로 남긴다. 같은
 * 질문("이 이름들이 같은 가게인가")의 답이고, 서버가 그 기록으로 다음 목록에서 이 묶음을
 * 뺀다. 상태(별칭·거래)는 바꾸지 않는다.
 */
export function rejectTruncationSuggestion(
  accessToken: string | null,
  input: { householdId: string; names: string[] }
): Promise<MerchantIdentityRejectResponse> {
  return apiFetch<MerchantIdentityRejectResponse>(
    "/v1/merchants/identity-feedback",
    {
      method: "POST",
      accessToken,
      body: { ...input, reason: "truncation" },
    }
  );
}

/**
 * 정기 지출 후보 재계산. 가맹점을 묶거나 풀면 과거 거래의 가맹점 신원이 바뀌므로 그 뒤에
 * 한 번 돌려야 정기 지출 후보가 현재 이름과 맞는다(서버 `recompute` 주석).
 */
export function recomputeRecurringAfterMerchantChange(
  accessToken: string | null,
  householdId: string
): Promise<RecurringRecomputeResponse> {
  return apiFetch<RecurringRecomputeResponse>("/v1/recurring/recompute", {
    method: "POST",
    accessToken,
    body: { householdId },
  });
}
