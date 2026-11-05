import type { CardSmsEventDetail } from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 문자 확인 창 정적 렌더 — 2026-11-05 HIG 검수 3단계에서 바꾼 것을 고정한다:
 * 내부 용어('원문'·'확정 대기'·'진단')와 서버 판정 코드(영문)를 화면에 내지 않고, 할 일이 달라지는 코드만
 * 우리말 한 줄로 보인다. 금액 칸은 AmountInput(통화만 넘겨 소수 자리는 통화가 정한다), 버튼은 동사형,
 * 불러오기 실패는 ErrorState. 데이터는 모두 합성값이다.
 *
 * node 환경이라 Radix 포털이 그려지지 않는다 — dialog 모듈만 내용을 그대로 펼치는 대역으로 바꾼다.
 */

type DetailQuery = {
  data?: CardSmsEventDetail[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
};

const state: { query: DetailQuery } = { query: loaded([]) };

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  // 상세 조회만 바꾼다 — useMutation·useQueryClient는 진짜를 쓴다.
  useQuery: () => state.query,
}));
vi.mock("@/components/ui/dialog", async () => {
  const { createElement: h } = await import("react");
  type Props = { children?: ReactNode };
  const block = ({ children }: Props) => h("div", null, children);
  return {
    Dialog: ({ open, children }: Props & { open: boolean }) =>
      open ? h("div", { "data-dialog": "" }, children) : null,
    DialogContent: block,
    DialogHeader: block,
    DialogTitle: ({ children }: Props) => h("h2", null, children),
    DialogDescription: ({ children }: Props) => h("p", null, children),
  };
});
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    authedFetch: vi.fn(),
    user: { id: "00000000-0000-4000-8000-0000000000a1" },
  }),
}));
vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useCardList: () => ({
    data: [
      {
        id: "00000000-0000-4000-8000-0000000000c1",
        alias: "합성 카드",
        maskedNumber: null,
        issuer: "합성카드사",
        status: "active",
        isShared: true,
        ownerMemberId: null,
      },
    ],
    isError: false,
  }),
  useHouseholdMembers: () => ({
    data: [
      {
        memberId: "00000000-0000-4000-8000-0000000000b1",
        userId: "00000000-0000-4000-8000-0000000000a1",
      },
    ],
    isError: false,
  }),
}));

import { ReviewInboxDialog } from "./review-inbox-dialog";

function loaded(data: CardSmsEventDetail[]): DetailQuery {
  return {
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
}

function detail(over: Partial<CardSmsEventDetail> = {}): CardSmsEventDetail {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    eventId: "e-1",
    sender: "15447000",
    receivedAt: "2026-11-03T05:31:00.000Z",
    parseStatus: "quarantined",
    issuer: null,
    transactionType: "approval",
    amount: 1250,
    currency: "USD",
    merchantRaw: "합성가맹점",
    occurredAt: "2026-11-03T05:30:00.000Z",
    installmentMonths: null,
    confidence: null,
    parseError: "suspicious_content: synthetic flag; llm_extracted",
    createdAt: "2026-11-03T05:31:00.000Z",
    rawContent: "[합성] 해외승인 합성가맹점",
    maskedCardNumber: null,
    ...over,
  } as CardSmsEventDetail;
}

function render(): string {
  const client = new QueryClient();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ReviewInboxDialog, {
        open: true,
        events: [{ id: "00000000-0000-4000-8000-000000000101" }],
        onClose: () => {},
      })
    )
  );
}

/** 화면에 보이는 글자만(태그·속성 제외). */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function inputs(html: string): string[] {
  return html.match(/<input\b[^>]*>/g) ?? [];
}

beforeEach(() => {
  state.query = loaded([detail()]);
});

describe("문자 확인 창 — 내부 용어와 판정 코드", () => {
  it("'원문'·'확정'·'진단'과 영문 판정 코드를 화면에 내지 않는다", () => {
    const html = render();
    const text = visibleText(html);
    for (const word of ["원문", "확정", "진단", "자동 인식"]) {
      expect(text).not.toContain(word);
    }
    expect(html).not.toContain("suspicious_content");
    expect(html).not.toContain("llm_extracted");
    expect(text).toContain("확인할 문자");
  });

  it("할 일이 달라지는 판정(의심 문구)만 우리말 한 줄로 보인다", () => {
    const text = visibleText(render());
    expect(text).toContain(
      "평소 결제 문자와 다른 내용이 있어 바로 넣지 않았어요."
    );
  });

  it("표에 없는 판정 코드는 아무 줄도 보이지 않는다", () => {
    state.query = loaded([detail({ parseError: "synthetic_unknown_code" })]);
    const html = render();
    expect(html).not.toContain("synthetic_unknown_code");
    expect(visibleText(html)).not.toContain("바로 넣지 않았어요");
  });

  it("보낸 곳은 대표 번호 표로 카드사 이름을 보인다", () => {
    expect(visibleText(render())).toContain("신한카드");
  });

  it("반영 대상이 아닌 상태는 내부 용어 없이 사용자 말로 안내한다", () => {
    state.query = loaded([detail({ parseStatus: "parsed" })]);
    const text = visibleText(render());
    expect(text).toContain("지금은 확인할 게 없는 문자예요");
    expect(text).not.toContain("확정");
  });
});

describe("문자 확인 창 — 금액 칸", () => {
  it("외화는 통화만 넘겨 소수 칸(decimal)이 되고 단위는 통화 코드다", () => {
    const html = render();
    const amount = inputs(html).filter((tag) =>
      tag.includes('inputMode="decimal"')
    );
    expect(amount).toHaveLength(1);
    // 1250(최소 단위) → 12.50 USD — 통화가 소수 자리를 정한다(금액 계약).
    expect(amount[0]).toContain('value="12.50"');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>USD<\/span>/);
    // 라벨 '금액'이 이 칸을 가리킨다 — 거래 추가·수정 창과 같은 이름이다.
    const id = amount[0].match(/\bid="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
    expect(html).toMatch(new RegExp(`for="${id}"[^>]*>금액<`));
  });

  it("원화는 정수 칸(numeric)이고 단위는 '원'이다", () => {
    state.query = loaded([detail({ currency: "KRW", amount: 13380 })]);
    const html = render();
    const amount = inputs(html).filter((tag) => tag.includes('value="13,380"'));
    expect(amount).toHaveLength(1);
    expect(amount[0]).toContain('inputMode="numeric"');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>원<\/span>/);
  });

  it("금액을 읽지 못한 문자는 칸을 비워 둔다(0으로 채우지 않는다)", () => {
    state.query = loaded([
      detail({ parseStatus: "parse_failed", amount: null, parseError: null }),
    ]);
    const amount = inputs(render()).filter((tag) =>
      tag.includes('inputMode="decimal"')
    );
    expect(amount).toHaveLength(1);
    expect(amount[0]).toContain('value=""');
  });
});

describe("문자 확인 창 — 칸 이름", () => {
  it("결제 일시 칸은 거래 추가·수정 창과 같은 '날짜·시간'이고 그 칸을 가리킨다", () => {
    const html = render();
    const date = inputs(html).filter((tag) =>
      tag.includes('type="datetime-local"')
    );
    expect(date).toHaveLength(1);
    const id = date[0].match(/\bid="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`for="${id}"[^>]*>날짜·시간<`));
    const text = visibleText(html);
    expect(text).not.toContain("결제 일시");
    expect(text).not.toContain("결제 금액");
  });

  it("결제 문자에서 시각을 못 읽으면 '결제한 날짜·시간'을 받은 시각과 구분해 안내한다", () => {
    state.query = loaded([detail({ occurredAt: null })]);
    const text = visibleText(render());
    expect(text).toContain("결제한 날짜·시간을 문자에서 읽지 못했어요.");
    expect(text).toContain("문자를 받은 시각(");
  });

  it("결제 취소 문자는 같은 칸 이름을 쓰고 안내만 '취소한'으로 말한다", () => {
    state.query = loaded([
      detail({ transactionType: "cancellation", occurredAt: null }),
    ]);
    const html = render();
    const text = visibleText(html);
    expect(html).toMatch(/for="[^"]*-amount"[^>]*>금액</);
    expect(html).toMatch(/for="[^"]*-date"[^>]*>날짜·시간</);
    expect(text).toContain("취소한 날짜·시간을 문자에서 읽지 못했어요.");
    expect(text).not.toContain("결제한 날짜·시간");
    expect(text).not.toContain("결제 금액");
  });
});

describe("문자 확인 창 — 버튼과 체크 줄", () => {
  it("결제는 '거래로 등록하기'", () => {
    const text = visibleText(render());
    expect(text).toContain("거래로 등록하기");
    expect(text).not.toContain("결제 실패로 정리하기");
  });

  it("결제 실패 문자는 금액 칸 없이 '결제 실패로 정리하기'", () => {
    state.query = loaded([detail({ transactionType: "declined" })]);
    const html = render();
    const text = visibleText(html);
    expect(text).toContain("결제 실패로 정리하기");
    expect(text).not.toContain("거래로 등록하기");
    // '금액'은 다른 문구에도 들어 있어 글자 대신 금액 칸(id·label)이 없는지 본다.
    expect(html).not.toMatch(/\bid="[^"]*-amount"/);
    expect(html).not.toMatch(/\bfor="[^"]*-amount"/);
    expect(text).not.toContain("거절");
  });

  it("자동 정리 체크는 공용 Checkbox이고 줄 전체(44px)가 누르는 영역이다", () => {
    const html = render();
    const row = html.match(
      /<label\b[^>]*>(?:(?!<\/label>).)*data-slot="checkbox"/s
    )?.[0];
    expect(row).toBeTruthy();
    expect(row).toContain("min-h-11");
  });
});

describe("문자 확인 창 — 불러오기", () => {
  it("실패하면 원인과 '다시 불러오기'를 보인다", () => {
    state.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    };
    const html = render();
    const text = visibleText(html);
    expect(text).toContain("받은 문자를 불러오지 못했어요");
    expect(text).toContain("다시 불러오기");
    expect(html).toContain('role="alert"');
    expect(text).not.toContain("원문");
  });

  it("불러오는 동안은 글자 대신 스켈레톤이다", () => {
    state.query = {
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    };
    const html = render();
    expect(visibleText(html)).not.toContain("거래로 등록하기");
    expect(html).toContain('role="status"');
    // 읽기 프로그램용 글자(sr-only)만 — 화면에는 스켈레톤이 상태를 말한다.
    expect(html).toMatch(/<span class="sr-only">받은 문자를 불러오는 중이에요.<\/span>/);
  });
});
