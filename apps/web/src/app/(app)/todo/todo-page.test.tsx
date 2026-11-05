import type {
  CardSmsEventSummary,
  CardSmsReviewGroupsResponse,
  TransactionSummary,
} from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TodoCounts } from "@/components/widgets/use-todo-counts";

/*
 * 할 일 화면 정적 렌더 — 2026-11-05 HIG 검수 3·4단계에서 바꾼 것을 고정한다:
 * 문자 두 섹션을 '확인할 문자' 하나로, 줄 제목은 카드사 이름, 확인할 거래 줄의 '확인 필요' 칩 제거,
 * 처리 대기 줄은 무엇을 기다리는지, 자동 정리 '중지하기'(44px, 확인은 액션 시트), 공용 로딩·빈·오류 부품.
 * 데이터는 모두 합성값이다.
 */

const state: {
  todo: TodoCounts;
  groups: {
    data?: CardSmsReviewGroupsResponse;
    isLoading: boolean;
    isError: boolean;
  };
} = { todo: emptyTodo(), groups: { isLoading: false, isError: false } };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/todo",
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn(), user: null }),
}));
vi.mock("@/lib/review-requests", () => ({
  useReviewRequests: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/components/widgets/use-todo-counts", () => ({
  useTodoCounts: () => state.todo,
}));
vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useCardList: () => ({
    data: [
      { id: "00000000-0000-4000-8000-0000000000c1", alias: "생활비 카드" },
    ],
    isError: false,
  }),
  useCardSmsReviewGroups: () => state.groups,
  useDisableSmsReviewPolicy: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));

import TodoPage from "./page";

function emptyTodo(): TodoCounts {
  return {
    declines: [],
    reviews: [],
    sms: [],
    smsRecent: [],
    smsOlder: [],
    unposted: [],
    unpostedLoading: false,
    unpostedError: false,
    unpostedTruncated: false,
    processing: [],
    processingLoading: false,
    processingError: false,
    processingTruncated: false,
    unpostedNeedsReview: [],
    unpostedUnknown: [],
    total: 0,
    declinesLoading: false,
    declinesError: false,
    reviewsLoading: false,
    reviewsError: false,
    smsLoading: false,
    smsError: false,
    reviewsTruncated: false,
    smsTruncated: false,
  };
}

function smsEvent(over: Partial<CardSmsEventSummary>): CardSmsEventSummary {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    eventId: "e-1",
    sender: "15990000",
    receivedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    parseStatus: "pending_review",
    issuer: null,
    transactionType: "approval",
    amount: 1000,
    currency: "KRW",
    merchantRaw: "합성가맹점",
    occurredAt: null,
    installmentMonths: null,
    confidence: null,
    parseError: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function txn(over: Partial<TransactionSummary>): TransactionSummary {
  return {
    id: "t-1",
    status: "pending_review",
    masked: false,
    merchantNormalized: "합성상점",
    merchantRaw: "합성상점",
    approvedAt: "2026-11-03T05:31:00.000Z",
    createdAt: "2026-11-03T05:31:00.000Z",
    netAmount: 1000,
    currency: "KRW",
    excludedAt: null,
    ...over,
  } as unknown as TransactionSummary;
}

function render(): string {
  const client = new QueryClient();
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(TodoPage))
  );
}

beforeEach(() => {
  state.todo = emptyTodo();
  state.groups = { isLoading: false, isError: false };
});

describe("할 일 화면", () => {
  it("문자 두 갈래를 '확인할 문자' 한 섹션(id=sms)으로 합치고 줄 제목에 카드사 이름을 쓴다", () => {
    state.groups = {
      isLoading: false,
      isError: false,
      data: {
        scope: "own_member",
        scannedCount: 2,
        truncated: false,
        policies: [],
        items: [
          {
            groupId: "g-1",
            sender: "16617654",
            count: 2,
            parseFailed: 2,
            quarantined: 0,
            latestReceivedAt: new Date(Date.now() - 60_000).toISOString(),
            representativeEventId: "00000000-0000-4000-8000-000000000201",
            reviewPath: "/todo?reviewSms=00000000-0000-4000-8000-000000000201",
          },
        ],
      },
    };
    state.todo.unpostedNeedsReview = [
      smsEvent({
        issuer: "신한카드",
        posting: {
          status: "needs_review",
          transactionId: null,
          transactionStatus: null,
          reason: "quarantined",
        },
      }),
    ];

    const html = render();
    expect(html.match(/id="sms"/g)).toHaveLength(1);
    expect(html).toContain("확인할 문자");
    expect(html).not.toContain("거래 반영 전 문자");
    expect(html).not.toContain("확인이 필요한 문자");
    expect(html).toContain("토스뱅크 문자 2건");
    expect(html).toContain("신한카드 문자");
    expect(html).not.toContain("에서 온 문자");
    expect(html).toContain("받은 문자를 보고 금액·가맹점을 입력해 주세요");
    expect(html).toContain("금액·가맹점이 맞는지 확인해 주세요");
    expect(html).not.toContain("할 일에서 확인");
    // 건수 = 묶음 문자 2 + 그 밖의 문자 1
    expect(html).toContain("3건");
  });

  it("확인할 거래 줄은 '확인 필요' 칩을 되풀이하지 않고 다른 상태(중복 의심)만 칩으로 단다", () => {
    state.todo.reviews = [
      txn({ id: "t-1", status: "pending_review" }),
      txn({ id: "t-2", status: "duplicate_suspected" }),
    ];
    const html = render();
    expect(html).toContain("확인할 거래");
    expect(html).not.toContain("확인 필요");
    expect(html.match(/중복 의심/g)).toHaveLength(1);
    // 날짜는 '11월 3일 오후 2:31'처럼(서울 기준) 쓴다.
    expect(html).toContain("11월 3일 오후 2:31");
  });

  it("반영을 기다리는 줄은 무엇을 기다리는지 먼저 말하고 시각은 부제로 보낸다", () => {
    state.todo.processing = [
      smsEvent({
        id: "00000000-0000-4000-8000-000000000301",
        currency: "USD",
        parseStatus: "parsed",
        posting: {
          status: "pending",
          transactionId: null,
          transactionStatus: null,
          reason: "fx_snapshot_missing",
        },
      }),
    ];
    const html = render();
    expect(html).toContain('id="processing"');
    expect(html).toContain("환율을 기다리는 중 · USD 결제");
    expect(html).toContain("3시간 전");
    expect(html).not.toContain("USD · 3시간 전");
    expect(html).not.toContain("대기 중");
  });

  it("자동 정리 '중지하기'는 44px 버튼이고 확인 창은 누르기 전에는 열리지 않는다", () => {
    state.groups = {
      isLoading: false,
      isError: false,
      data: {
        scope: "own_member",
        scannedCount: 0,
        truncated: false,
        items: [],
        policies: [
          {
            id: "00000000-0000-4000-8000-000000000401",
            approvedCardId: "00000000-0000-4000-8000-0000000000c1",
            enabled: true,
            createdAt: "2026-11-01T00:00:00.000Z",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
        ],
      },
    };
    const html = render();
    const button = html.match(/<button[^>]*>중지하기<\/button>/)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain("h-11");
    expect(button).not.toContain("h-9");
    expect(html).toContain("생활비 카드");
    expect(html).toContain("11월 1일부터");
    expect(html).not.toContain("중지할까요");
  });

  it("못 읽은 섹션은 원인과 '다시 불러오기'를 함께 보여 준다", () => {
    state.todo.declinesError = true;
    const html = render();
    expect(html).toContain("실패한 결제를 불러오지 못했어요");
    expect(html).toContain("다시 불러오기");
    expect(html).not.toContain("지금은 할 일이 없어요");
  });

  it("다 읽었는데 할 일이 없으면 공용 빈 상태를 보여 준다", () => {
    const html = render();
    expect(html).toContain("지금은 할 일이 없어요");
    expect(html).not.toContain("rounded-2xl");
  });

  it("읽는 중에는 공용 스켈레톤만 보이고 빈 상태를 내지 않는다", () => {
    state.todo.declinesLoading = true;
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("rounded-2xl");
    expect(html).not.toContain("지금은 할 일이 없어요");
  });
});
