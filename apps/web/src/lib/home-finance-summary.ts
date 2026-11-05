import type { CardSmsEventSummary } from "@family/contracts";

import {
  todoSectionHref,
  type TodoSectionId,
} from "@/components/widgets/todo-counts";

/** 건수 한 축. 못 읽은 값을 0으로 바꾸지 않으려고 로딩·오류를 함께 넘긴다. */
export interface HomeCountSource {
  count: number;
  loading: boolean;
  error: boolean;
  /** 조회 상한에 걸려 실제로는 더 있을 수 있다(`+`로 표시). */
  truncated?: boolean;
}

export function visibleReviewCount({
  count,
  loading,
  error,
}: HomeCountSource): number | null {
  return !loading && !error && Number.isSafeInteger(count) && count > 0
    ? count
    : null;
}

/** 홈 할 일 줄의 종류 = 할 일 화면의 섹션. */
export type HomeTodoKey = Extract<
  TodoSectionId,
  "declines" | "requests" | "sms" | "reviews"
>;

export type HomeTodoSources = Partial<Record<HomeTodoKey, HomeCountSource>>;

/**
 * 홈 할 일 줄의 순서 = 할 일 화면 섹션 순서. 순서는 여기서만 정한다 — 주석이나 다른
 * 곳에 다시 나열하면 한쪽만 바뀌었을 때 설명이 조용히 틀린다.
 */
export const HOME_TODO_ORDER: readonly HomeTodoKey[] = [
  "declines",
  "requests",
  "reviews",
  "sms",
];

const HOME_TODO_LABEL: Record<HomeTodoKey, string> = {
  declines: "결제 실패",
  requests: "가족이 물어본 결제",
  sms: "확인할 문자",
  reviews: "확인할 거래",
};

export interface HomeTodoRow {
  key: HomeTodoKey;
  count: number;
  /** 예: `확인할 거래 2+건` */
  text: string;
  href: string;
}

/** 건수를 아는 축 중 1건 이상인 것만, 할 일 화면 순서대로 줄로 만든다. */
export function homeTodoRows(sources: HomeTodoSources): HomeTodoRow[] {
  return HOME_TODO_ORDER.flatMap((key): HomeTodoRow[] => {
    const source = sources[key];
    const count = source ? visibleReviewCount(source) : null;
    if (source == null || count == null) return [];
    return [
      {
        key,
        count,
        text: `${HOME_TODO_LABEL[key]} ${count.toLocaleString("ko-KR")}${
          source.truncated ? "+" : ""
        }건`,
        href: todoSectionHref(key),
      },
    ];
  });
}

/**
 * `useTodoCounts()` 결과 중 홈이 읽는 부분. 훅 파일(React Query)을 끌어오지 않으려고
 * 구조만 받는다 — `TodoCounts`가 그대로 들어맞는다.
 */
export interface HomeTodoCountsInput {
  declines: readonly unknown[];
  declinesLoading: boolean;
  declinesError: boolean;
  reviews: readonly unknown[];
  reviewsLoading: boolean;
  reviewsError: boolean;
  reviewsTruncated: boolean;
  sms: readonly unknown[];
  smsLoading: boolean;
  smsError: boolean;
  smsTruncated: boolean;
  unpostedNeedsReview: readonly unknown[];
  unpostedLoading: boolean;
  unpostedError: boolean;
  unpostedTruncated: boolean;
  /** 자동 반영 대기 문자. 환율 대기를 가르려고 반영 상태(`posting`)만 읽는다. */
  processing: readonly Pick<CardSmsEventSummary, "posting">[];
  processingLoading: boolean;
  processingError: boolean;
  processingTruncated: boolean;
}

/**
 * 할 일 합계(`todoTotal`)와 같은 기준으로 홈 줄의 축을 만든다. 가족이 물어본 결제는
 * 다른 쿼리라 따로 받는다(할 일 합계에도 들어 있지 않다).
 */
export function homeTodoSources(
  todo: HomeTodoCountsInput,
  requests?: HomeCountSource
): HomeTodoSources {
  return {
    declines: {
      count: todo.declines.length,
      loading: todo.declinesLoading,
      error: todo.declinesError,
    },
    requests,
    // 합계의 sms + unpostedNeedsReview를 한 줄로 센다. 둘 중 하나라도 못 읽으면
    // 일부만 센 숫자가 되므로 모르는 값으로 둔다.
    sms: {
      count: todo.sms.length + todo.unpostedNeedsReview.length,
      loading: todo.smsLoading || todo.unpostedLoading,
      error: todo.smsError || todo.unpostedError,
      truncated: todo.smsTruncated || todo.unpostedTruncated,
    },
    reviews: {
      count: todo.reviews.length,
      loading: todo.reviewsLoading,
      error: todo.reviewsError,
      truncated: todo.reviewsTruncated,
    },
  };
}

/**
 * 처리 대기 문자를 두 수로 가른다. 둘 다 사용자가 할 일이 아니라 할 일 합계에서 빠지지만
 * 말할 수 있는 사실이 다르다 — 파싱·반영 중인 문자는 자동으로 이어서 반영되고, 환율 대기는
 * 그날 환율이 생길 때까지 멈춰 있다.
 *
 * 로딩·오류·조회 상한은 같은 쿼리에서 오므로 두 수가 함께 쓴다.
 */
export interface HomeProcessingSource extends HomeCountSource {
  /**
   * 그날 환율이 없어 멈춘 문자 수. `count`와 겹치지 않는다 — `count`는 반영하는 중인
   * 문자만 센다. 없으면 0으로 본다.
   */
  fxMissing?: number;
}

/**
 * 환율 대기 = 반영 대기(`pending`) 중 사유가 `fx_snapshot_missing`인 문자. 할 일 화면의
 * 문구(`postingMessage`)가 '그날 환율이 아직 없어 …'로 가르는 기준과 같다.
 */
function isFxSnapshotWait(event: Pick<CardSmsEventSummary, "posting">): boolean {
  return (
    event.posting?.status === "pending" &&
    event.posting.reason === "fx_snapshot_missing"
  );
}

export function homeProcessingSource(
  todo: HomeTodoCountsInput
): HomeProcessingSource {
  const fxMissing = todo.processing.filter(isFxSnapshotWait).length;
  return {
    count: todo.processing.length - fxMissing,
    fxMissing,
    loading: todo.processingLoading,
    error: todo.processingError,
    truncated: todo.processingTruncated,
  };
}

/**
 * 파싱·반영 중인 문자(환율 대기 제외)는 사용자가 할 일이 없어 할 일 합계에서 빠진다.
 * 그래서 링크가 아닌 상태 문구로만 알린다 — ›를 달면 누를 일이 있다고 읽힌다.
 * 반영 상태를 모르는 문자(unpostedUnknown)는 자동으로 반영된다고 말할 근거가 없어 넣지 않는다.
 */
export function homeProcessingText(
  source: HomeCountSource | undefined
): string | null {
  const count = source ? visibleReviewCount(source) : null;
  if (source == null || count == null) return null;
  return `문자 ${count.toLocaleString("ko-KR")}${
    source.truncated ? "+" : ""
  }건을 거래에 반영하는 중이에요`;
}

export interface HomeStatusRow {
  /** 예: `문자 2건은 그날 환율이 없어 아직 반영하지 못했어요` */
  text: string;
  href: string;
}

/**
 * 환율 대기는 '반영하는 중'이 아니라 멈춘 상태라 따로 말한다. 언제 풀릴지 모르니 어떤
 * 문자인지 볼 수 있게 할 일 화면의 '반영을 기다리는 문자' 섹션으로 보낸다. 사용자가 고칠 것은 없어
 * 할 일 합계에는 넣지 않는다(할 일 화면도 '다시 등록하지 않아도 돼요'라고 안내한다).
 */
export function homeFxWaitRow(
  source: HomeProcessingSource | undefined
): HomeStatusRow | null {
  if (source == null) return null;
  const count = visibleReviewCount({ ...source, count: source.fxMissing ?? 0 });
  if (count == null) return null;
  return {
    text: `문자 ${count.toLocaleString("ko-KR")}${
      source.truncated ? "+" : ""
    }건은 그날 환율이 없어 아직 반영하지 못했어요`,
    href: todoSectionHref("processing"),
  };
}

/** Manual KRW values are decimal strings. Never round them through Number. */
export function manualKrwText(value: string | null | undefined): string {
  if (value == null || !/^-?(0|[1-9]\d*)$/.test(value)) return "— 원";
  return `${new Intl.NumberFormat("ko-KR").format(BigInt(value))}원`;
}
