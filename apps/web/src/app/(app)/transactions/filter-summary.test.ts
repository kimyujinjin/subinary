import { describe, expect, it } from "vitest";

import {
  CANCELLATION_FILTER_OPTIONS,
  cancellationFilterChange,
  cancellationFilterLabel,
  cancellationFilterValue,
  filterValueLabel,
  hasTransactionConditions,
  type TransactionFilterChoices,
  type TransactionFilterValues,
} from "./filter-summary";

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
  categoryId: [],
  cardId: [{ value: "card-1", label: "생활비 카드" }],
  memberId: [],
  type: [
    { value: "cancellation", label: "취소" },
    { value: "approval", label: "승인" },
  ],
  status: [
    { value: "pending_review", label: "확인 필요" },
    { value: "approved", label: "승인" },
  ],
};

describe("가계부 필터 칩", () => {
  it("기간과 검색어는 조건이 아니다 — '초기화'가 지우지 않는다", () => {
    expect(
      hasTransactionConditions({
        ...empty,
        month: "2025-01",
        q: "가게",
      } as TransactionFilterValues)
    ).toBe(false);
    expect(hasTransactionConditions({ ...empty, cardId: "card-1" })).toBe(true);
    expect(hasTransactionConditions({ ...empty, excludedOnly: true })).toBe(
      true
    );
  });

  it("목록에 없는 값은 id를 드러내지 않고 '선택됨'으로, 목록이 오면 이름으로 보인다", () => {
    const values = { ...empty, cardId: "card-1", memberId: "member-inactive" };
    expect(filterValueLabel("memberId", values, choices)).toBe("선택됨");
    expect(filterValueLabel("cardId", values, { ...choices, cardId: [] })).toBe(
      "선택됨"
    );
    expect(filterValueLabel("cardId", values, choices)).toBe("생활비 카드");
    expect(filterValueLabel("categoryId", values, choices)).toBeNull();
  });

  it("'취소·환불' 칩은 유형·상태를 하나로 고르고, 고르면 다른 쪽을 지운다", () => {
    expect(cancellationFilterChange("status:cancelled")).toEqual({
      type: "",
      status: "cancelled",
    });
    expect(cancellationFilterChange("type:cancellation")).toEqual({
      type: "cancellation",
      status: "",
    });
    expect(cancellationFilterChange("")).toEqual({ type: "", status: "" });
    expect(cancellationFilterValue({ type: "cancellation", status: "" })).toBe(
      "type:cancellation"
    );
    expect(
      cancellationFilterLabel(
        { ...empty, status: "partially_cancelled" },
        choices
      )
    ).toBe("부분 취소된 결제");
    expect(
      cancellationFilterLabel({ ...empty, type: "cancellation" }, choices)
    ).toBe("환불 기록");
    expect(cancellationFilterLabel(empty, choices)).toBeNull();
  });

  it("선택지 이름은 앱 전체 규칙을 따른다 — 원래 결제는 취소, 취소로 생긴 기록은 환불", () => {
    expect(CANCELLATION_FILTER_OPTIONS.map((option) => option.label)).toEqual([
      "취소된 결제",
      "부분 취소된 결제",
      "환불 기록",
    ]);
  });

  it("칩 목록에 없는 URL 값(승인·확인 필요)도 원래 이름으로 보여 지울 수 있다", () => {
    expect(
      cancellationFilterLabel({ ...empty, status: "approved" }, choices)
    ).toBe("상태: 승인");
    expect(
      cancellationFilterLabel({ ...empty, type: "approval" }, choices)
    ).toBe("유형: 승인");
    expect(
      cancellationFilterLabel({ ...empty, status: "pending_review" }, choices)
    ).toBe("상태: 확인 필요");
  });
});
