"use client";
/* ---------------------------------------------------------------------------
 * 할 일(Inbox) 건수 훅 — C-8
 *
 * 결제 실패 / 확인 필요 거래 / 판단 필요 문자를 같은 기준으로 센다.
 * 자동 처리·환율 대기는 별도 상태이며 사용자 할일 합계에 더하지 않는다.
 * 새 백엔드는 없다 — 전부 홈이 이미 호출하던 쿼리이고, 같은 queryKey를 공유하므로
 * 화면을 오가도 요청이 늘지 않는다.
 *
 * 세는 규칙 자체는 {@link ./todo-counts}(순수·테스트 있음)에 있다. 여기서는 배선만
 * 한다.
 * ------------------------------------------------------------------------- */
import { useMemo } from "react";

import type {
  CardSmsDeclineGroup,
  CardSmsEventSummary,
  TransactionSummary,
} from "@family/contracts";

import {
  REVIEW_SCAN_LIMIT,
  useCardSmsReviewInbox,
  useDeclineList,
  useTransactions,
  useUnpostedSms,
  type QueryOpts,
} from "@/lib/queries";

import {
  partitionSmsByWindow,
  partitionTodoSms,
  pendingReviewTransactions,
  todoTotal,
  unresolvedDeclines,
} from "./todo-counts";

export interface TodoCounts {
  /** 미해결 결제 실패 묶음. */
  declines: CardSmsDeclineGroup[];
  /** 확인이 필요한 거래(확인필요 + 중복의심, 최신순). */
  reviews: TransactionSummary[];
  /** 읽지 못한 문자 — 전 기간(홈 3일 창을 적용하지 않은 원본). */
  sms: CardSmsEventSummary[];
  /** 그중 홈이 노출하는 최근 창 안쪽. */
  smsRecent: CardSmsEventSummary[];
  /** 홈 창 밖(= 홈에서는 "지난 문자 N건 더 보기"로만 보이는 것). */
  smsOlder: CardSmsEventSummary[];
  /** Original read projection retained for compatibility; never use its length as task count. */
  unposted: CardSmsEventSummary[];
  unpostedLoading: boolean;
  unpostedError: boolean;
  unpostedTruncated: boolean;
  /** Automatic parsing/posting/FX waits: status only, excluded from total. */
  processing: CardSmsEventSummary[];
  processingLoading: boolean;
  processingError: boolean;
  processingTruncated: boolean;
  unpostedNeedsReview: CardSmsEventSummary[];
  /** No authoritative posting status: preserve visibility without promising automatic work. */
  unpostedUnknown: CardSmsEventSummary[];
  /** 배지 합계. */
  total: number;
  /** 소스별 로딩/에러 — 못 읽은 축을 0건으로 표기하지 않기 위해 나눠 준다. */
  declinesLoading: boolean;
  declinesError: boolean;
  reviewsLoading: boolean;
  reviewsError: boolean;
  smsLoading: boolean;
  smsError: boolean;
  /** 스캔 상한에 걸려 실제 건수가 더 많을 수 있는지(축별). */
  reviewsTruncated: boolean;
  smsTruncated: boolean;
}

/**
 * 할 일 3종의 건수·항목.
 *
 * @param opts.refetchInterval 실시간 반영이 필요한 화면(홈)만 준다. 폴링은 SSE 불통
 * 시의 안전망이므로 저빈도로 쓰고, 화면을 떠나면 자동으로 멈춘다.
 */
export function useTodoCounts(opts?: QueryOpts): TodoCounts {
  const declineQuery = useDeclineList();
  const reviewQuery = useTransactions(
    { review: "1", limit: REVIEW_SCAN_LIMIT },
    opts,
  );
  const smsQuery = useCardSmsReviewInbox(opts);
  const unpostedQuery = useUnpostedSms();

  const declines = useMemo(
    () => unresolvedDeclines(declineQuery.data?.items),
    [declineQuery.data],
  );
  const reviews = useMemo(
    () =>
      pendingReviewTransactions(reviewQuery.data?.items),
    [reviewQuery.data],
  );
  // 3일 창 분할은 렌더 시각에 의존한다 — 목록이 갱신될 때만 다시 가른다. 창 경계를
  // 1분 단위로 정확히 밀어 줄 이유는 없다(폴링/포커스 리페치가 곧 다시 계산한다).
  const { sms, unpostedNeedsReview, processing, unpostedUnknown } = useMemo(
    () => partitionTodoSms(smsQuery.data, unpostedQuery.data),
    [smsQuery.data, unpostedQuery.data],
  );
  const { recent: smsRecent, older: smsOlder } = useMemo(
    () => partitionSmsByWindow(sms, Date.now()),
    [sms],
  );

  return {
    declines,
    reviews,
    sms,
    smsRecent,
    smsOlder,
    unposted: unpostedQuery.data ?? [],
    unpostedLoading: unpostedQuery.isLoading,
    unpostedError: unpostedQuery.isError,
    unpostedTruncated: (unpostedQuery.data?.length ?? 0) >= REVIEW_SCAN_LIMIT,
    processing,
    processingLoading: unpostedQuery.isLoading || smsQuery.isLoading,
    processingError: unpostedQuery.isError || smsQuery.isError,
    processingTruncated: (unpostedQuery.data?.length ?? 0) >= REVIEW_SCAN_LIMIT || (smsQuery.data?.length ?? 0) >= REVIEW_SCAN_LIMIT,
    unpostedNeedsReview,
    unpostedUnknown,
    total: todoTotal({
      declines: declines.length,
      reviews: reviews.length,
      sms: sms.length,
      unpostedNeedsReview: unpostedNeedsReview.length,
    }),
    declinesLoading: declineQuery.isLoading,
    declinesError: declineQuery.isError,
    reviewsLoading: reviewQuery.isLoading,
    reviewsError: reviewQuery.isError,
    smsLoading: smsQuery.isLoading,
    smsError: smsQuery.isError,
    reviewsTruncated:
      Boolean(reviewQuery.data?.nextCursor),
    smsTruncated: sms.length >= REVIEW_SCAN_LIMIT,
  };
}
