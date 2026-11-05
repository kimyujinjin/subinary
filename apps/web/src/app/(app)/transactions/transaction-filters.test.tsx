/**
 * 가계부 기간·조건 칩(2026-11-05 PO 재설계). 드롭다운을 쌓은 '필터' 패널 대신
 * `2026년 11월 ▾ ‹ ›` + 칩 한 줄이고, 고른 값이 칩에 바로 보인다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  TransactionFilterChoices,
  TransactionFilterValues,
} from "./filter-summary";
import { TransactionFilters } from "./transaction-filters";

const empty: TransactionFilterValues = {
  categoryId: "",
  cardId: "",
  memberId: "",
  type: "",
  status: "",
  reviewOnly: false,
  excludedOnly: false,
  sharedOnly: false,
};
const choices: TransactionFilterChoices = {
  categoryId: [{ value: "cafe", label: "카페" }],
  cardId: [{ value: "card-1", label: "생활비 카드" }],
  memberId: [{ value: "m1", label: "수빈" }],
  type: [{ value: "cancellation", label: "취소" }],
  status: [{ value: "cancelled", label: "취소" }],
};
const monthOptions = [
  { value: "2026-11", label: "2026년 11월" },
  { value: "2026-10", label: "2026년 10월" },
];

function render(values: TransactionFilterValues, month = "2026-11") {
  return renderToStaticMarkup(
    <TransactionFilters
      month={month}
      monthOptions={monthOptions}
      values={values}
      choices={choices}
      onMonthChange={() => undefined}
      onChange={() => undefined}
      onClear={() => undefined}
      onClearAll={() => undefined}
      onToggleReview={() => undefined}
    >
      <input aria-label="거래 검색" />
    </TransactionFilters>
  );
}

describe("가계부 기간·조건", () => {
  it("달은 이름을 눌러 고르고 ‹ ›로 한 달씩 넘긴다 — 마지막 달에서는 다음이 막힌다", () => {
    const html = render(empty);
    expect(html).toContain('aria-label="기간: 2026년 11월"');
    expect(html).toMatch(/aria-label="이전 달"(?![^>]*disabled)/);
    expect(html).toMatch(
      /disabled=""[^>]*aria-label="다음 달"|aria-label="다음 달"[^>]*disabled=""/
    );
  });

  it("전체 기간이면 이름만 보이고 화살표는 없다", () => {
    const html = render(empty, "");
    expect(html).toContain('aria-label="기간: 전체 기간"');
    expect(html).not.toContain("이전 달");
  });

  it("조건은 칩 한 줄이고, 고른 값이 칩에 보이며, 조건이 있을 때만 '초기화'가 나온다", () => {
    const idle = render(empty);
    for (const chip of [
      "확인할 거래",
      "카테고리 고르기",
      "구성원 고르기",
      "카드 고르기",
      "취소·환불 고르기",
    ]) {
      expect(idle).toContain(chip);
    }
    expect(idle).not.toContain("초기화");
    expect(idle).not.toContain("<select");
    expect(idle).not.toContain("필터 닫기");

    const filtered = render({
      ...empty,
      categoryId: "cafe",
      status: "cancelled",
    });
    expect(filtered).toContain('aria-label="카테고리: 카페"');
    expect(filtered).toContain('aria-label="취소·환불: 취소된 결제"');
    expect(filtered).toContain("초기화");
  });

  it("링크로만 켜지는 조건은 ×로 끄는 칩으로 보인다", () => {
    const html = render({ ...empty, excludedOnly: true });
    expect(html).toContain('aria-label="합계에서 뺀 거래 조건 해제"');
  });
});
