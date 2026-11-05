/**
 * '확인할 거래' 칩과 기간(2026-11-05 HIG 검수 3·4단계).
 *
 * 확인할 거래는 달과 상관없이 모두 봐야 해서 칩을 켜면 기간을 '전체 기간'으로 바꾼다. 예전에는 칩을 꺼도
 * 기간이 돌아오지 않아, 11월을 보다가 확인할 거래를 잠깐 켜고 끈 사람이 말없이 전체 기간 목록을 봤다.
 * 켤 때의 달을 기억했다가 끌 때(칩·조건 지우기·초기화) 되돌린다. 켜 둔 동안 사용자가 달을 직접 고르면
 * 그 달을 따른다(기억을 버린다).
 *
 * 기억은 화면 상태라 URL에 넣지 않는다 — URL은 지금 보이는 달과 칩만 말한다(`lib/transaction-review-filter.ts`).
 * 그래서 새로고침 뒤에는 링크 규칙만 남는다: 기간 없이 `?review=1`로 들어왔으면 전체 기간은 칩이 정한 것이므로
 * 끌 때 목록의 기본 기간(이번 달)으로 돌아간다.
 */

export type ReviewPeriodState = Readonly<{
  reviewOnly: boolean;
  /** 보고 있는 달(`YYYY-MM`). 빈 문자열은 전체 기간. */
  month: string;
  /** 칩을 끌 때 돌아갈 달. null이면 지금 달을 그대로 둔다. */
  restoreMonth: string | null;
}>;

type Params = Pick<URLSearchParams, "get" | "has">;

/** 링크로 들어왔을 때 돌아갈 달 — 기간 없이 확인할 거래만 열었으면 이번 달, 아니면 없음. */
export function initialRestoreMonth(
  params: Params,
  thisMonth: string
): string | null {
  return params.get("review") === "1" && !params.has("month")
    ? thisMonth
    : null;
}

/** 칩을 켠다(전체 기간으로, 지금 달을 기억) 또는 끈다(기억한 달로). */
export function toggleReviewPeriod(
  state: ReviewPeriodState
): ReviewPeriodState {
  if (state.reviewOnly) return leaveReviewPeriod(state);
  return { reviewOnly: true, month: "", restoreMonth: state.month };
}

/** 칩을 끈다. 이미 꺼져 있으면 그대로다. */
export function leaveReviewPeriod(state: ReviewPeriodState): ReviewPeriodState {
  if (!state.reviewOnly) return state;
  return {
    reviewOnly: false,
    month: state.restoreMonth ?? state.month,
    restoreMonth: null,
  };
}

/** 달을 직접 고른다. 칩이 켜져 있으면 사용자가 고른 기간이 이기므로 기억을 버린다. */
export function pickReviewMonth(
  state: ReviewPeriodState,
  month: string
): ReviewPeriodState {
  return {
    reviewOnly: state.reviewOnly,
    month,
    restoreMonth: state.reviewOnly ? null : state.restoreMonth,
  };
}
