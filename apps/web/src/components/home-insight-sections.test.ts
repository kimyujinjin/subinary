import type {
  CategoryBreakdown,
  MemberBreakdown,
  MonthlyAnalytics,
} from "@family/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  HomeConsumptionCard,
  type HomeConsumptionCardProps,
} from "./home-consumption-card";
import {
  HomeMemberSplit,
  HomeUpcoming,
  HomeWeeklyRecap,
} from "./home-insight-sections";
import type { UpcomingRow, WeekWindow } from "@/lib/home-insights";

const meta: MonthlyAnalytics["meta"] = {
  period: {
    from: "2026-10-26T15:00:00Z",
    to: "2026-11-02T15:00:00Z",
    timezone: "Asia/Seoul",
  },
  cancellationApplied: true,
  includedMemberIds: [],
  excludedByPermission: 0,
  excludedManual: { count: 0, net: 0 },
  excludedTransfer: { count: 0, net: 0 },
};

const member = (
  memberId: string | null,
  name: string,
  net: number
): MemberBreakdown["items"][number] => ({
  memberId,
  name,
  net,
  ratio: 0,
  count: 1,
});

const split = (
  items: MemberBreakdown["items"],
  props: { loading?: boolean; error?: boolean } = {}
) =>
  renderToStaticMarkup(
    createElement(HomeMemberSplit, {
      breakdown: { meta, items },
      loading: false,
      error: false,
      colorOf: () => null,
      ...props,
    })
  );

describe("가족별 사용", () => {
  it("두 사람 이상이 썼을 때만 비중과 금액을 보여준다", () => {
    const html = split([
      member("m1", "이수빈", 60000),
      member("m2", "배우자", 40000),
    ]);
    expect(html).toContain("누가 썼나");
    expect(html).toContain("이수빈");
    expect(html).toContain("60%");
    expect(html).toContain("60,000원");
    expect(html).toContain("40%");
    expect(html).toContain('aria-label="이수빈 60%, 배우자 40%"');
  });

  it("공용 버킷은 사람 색이 아닌 중립색으로 둔다", () => {
    const html = split([
      member("m1", "이수빈", 30000),
      member(null, "공용", 10000),
    ]);
    expect(html).toContain("공용");
    expect(html).toContain("bg-muted-foreground/40");
  });

  it("한 사람만 썼거나 쓴 돈이 없는 구성원뿐이면 그리지 않는다", () => {
    expect(
      split([member("m1", "이수빈", 50000), member("m2", "배우자", 0)])
    ).toBe("");
    expect(
      split([member("m1", "이수빈", 50000), member("m2", "배우자", -3000)])
    ).toBe("");
    expect(split([])).toBe("");
  });

  it("로딩·실패 중에는 이전 값을 보여주지 않는다", () => {
    const items = [
      member("m1", "이수빈", 60000),
      member("m2", "배우자", 40000),
    ];
    expect(split(items, { loading: true })).toBe("");
    expect(split(items, { error: true })).toBe("");
  });
});

const row = (over: Partial<UpcomingRow> = {}): UpcomingRow => ({
  key: "recurring:1",
  date: "2026-11-05",
  when: "내일",
  title: "넷플릭스",
  subtitle: null,
  amountText: "17,000원",
  href: "/more/recurring",
  overdue: false,
  ...over,
});

describe("다가오는 지출", () => {
  it("행이 없으면 그리지 않는다", () => {
    expect(
      renderToStaticMarkup(createElement(HomeUpcoming, { rows: [] }))
    ).toBe("");
  });

  it("날짜·이름·금액을 한 줄에 두고 상세 화면으로 연결한다", () => {
    const html = renderToStaticMarkup(
      createElement(HomeUpcoming, {
        rows: [
          row(),
          row({
            key: "card:c1",
            when: "11월 10일",
            title: "생활비 카드 결제일",
            subtitle: "지난달 사용 512,300원",
            amountText: null,
            href: "/cards",
          }),
        ],
      })
    );
    expect(html).toContain("다가오는 지출");
    expect(html).toContain('href="/more/recurring"');
    expect(html).toContain("17,000원");
    expect(html).toContain("생활비 카드 결제일");
    expect(html).toContain("지난달 사용 512,300원");
    expect(html).toContain('href="/cards"');
    // 금액을 모르는 행은 0원으로 채우지 않는다.
    expect(html).not.toContain(">0원<");
  });

  it("예정일이 지난 행은 경고색으로 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(HomeUpcoming, {
        rows: [row({ when: "예정일 지남", overdue: true })],
      })
    );
    expect(html).toContain("text-destructive");
    expect(html).toContain("예정일 지남");
  });

  it("날짜 칸은 고정폭이 아니라 '예정일 지남'도 한 줄로 늘어난다", () => {
    const html = renderToStaticMarkup(
      createElement(HomeUpcoming, {
        rows: [row({ when: "예정일 지남", overdue: true })],
      })
    );
    expect(html).not.toMatch(/(?<![\w-])w-16(?![\w-])/);
    expect(html).toContain("min-w-16");
    expect(html).toContain("whitespace-nowrap");
  });
});

const week: WeekWindow = {
  from: "2026-10-25T15:00:00.000Z",
  to: "2026-11-01T15:00:00.000Z",
  label: "10월 26일 – 11월 1일",
};

const weekly = (over: Partial<MonthlyAnalytics> = {}): MonthlyAnalytics => ({
  meta,
  totalNet: 210000,
  totalApproved: 210000,
  totalCancelled: 0,
  transactionCount: 12,
  previousNet: 180000,
  deltaNet: 30000,
  deltaRate: 0.17,
  ...over,
});

const categories = (items: CategoryBreakdown["items"]): CategoryBreakdown => ({
  meta,
  items,
});
const category = (
  categoryName: string,
  net: number
): CategoryBreakdown["items"][number] => ({
  categoryId: categoryName,
  categorySlug: null,
  categoryName,
  net,
  ratio: 0,
  count: 1,
});

const recap = (props: Partial<Parameters<typeof HomeWeeklyRecap>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(HomeWeeklyRecap, {
      week,
      monthly: weekly(),
      categories: categories([
        category("식비", 80000),
        category("교통", 20000),
      ]),
      loading: false,
      error: false,
      ...props,
    })
  );

describe("지난주 회고", () => {
  it("지난주 합계와 그 전주 대비, 가장 많이 쓴 카테고리를 보여준다", () => {
    const html = recap();
    expect(html).toContain("지난주");
    expect(html).toContain("10월 26일 – 11월 1일");
    expect(html).toContain("210,000원");
    expect(html).toContain("그 전주보다");
    expect(html).toContain("가장 많이 쓴 카테고리");
    expect(html).not.toContain("가장 많이 쓴 곳");
    expect(html).toContain("식비");
    expect(html).toContain("80,000원");
  });

  it("카테고리가 없으면 가장 많이 쓴 카테고리 줄을 빼고, 그 전주가 0이면 비교하지 않는다", () => {
    const html = recap({
      monthly: weekly({ previousNet: 0, deltaNet: 210000 }),
      categories: categories([]),
    });
    expect(html).toContain("210,000원");
    expect(html).not.toContain("가장 많이 쓴 카테고리");
    expect(html).not.toContain("그 전주");
  });

  it("거래가 없거나 로딩·실패면 그리지 않는다", () => {
    expect(
      recap({ monthly: weekly({ transactionCount: 0, totalNet: 0 }) })
    ).toBe("");
    expect(recap({ loading: true })).toBe("");
    expect(recap({ error: true })).toBe("");
    expect(recap({ monthly: undefined })).toBe("");
  });
});

const noExceptions = {
  count: 0,
  loading: false,
  error: false,
  truncated: false,
};
const consumption = (props: Partial<HomeConsumptionCardProps> = {}) =>
  renderToStaticMarkup(
    createElement(HomeConsumptionCard, {
      month: "2026-11",
      isCurrentMonth: true,
      loading: false,
      error: false,
      todo: {},
      processing: noExceptions,
      monthly: weekly({ totalNet: 526339, previousNet: 812414 }),
      ...props,
    })
  );

describe("홈 소비 카드(개편)", () => {
  it("탭 첫 화면과 겹치는 분석·카드 내역 바로가기를 두지 않는다", () => {
    const html = consumption();
    expect(html).not.toContain("/ledger/analysis");
    expect(html).not.toContain("카드 내역");
    expect(html).not.toContain('href="/cards"');
  });

  it("지난달 이맘때 페이스가 있으면 전월 비교 대신 그 줄을 쓴다", () => {
    const html = consumption({ pace: "지난달 이맘때보다 12,000원 덜 썼어요" });
    expect(html).toContain("지난달 이맘때보다 12,000원 덜 썼어요");
    expect(html).not.toContain("지난달 812,414원");
    expect(consumption()).toContain("지난달 812,414원");
  });

  it("가족이 물어본 결제는 건수를 알 때만 할 일 화면으로 연결한다", () => {
    const requests = { count: 2, loading: false, error: false };
    const html = consumption({ todo: { requests } });
    expect(html).toContain("가족이 물어본 결제 2건");
    expect(html).toContain('href="/todo?section=requests"');
    for (const hidden of [
      { ...requests, count: 0 },
      { ...requests, loading: true },
      { ...requests, error: true },
    ]) {
      expect(consumption({ todo: { requests: hidden } })).not.toContain(
        "가족이 물어본 결제"
      );
    }
  });
});
