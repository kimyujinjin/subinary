import { describe, expect, it } from "vitest";

import { smsReviewAmountInput, smsReviewAmountMinorUnits } from "./sms-review-amount";

describe("문자 검토 금액 입력", () => {
  it("원화는 원 단위로 입력하고 천 단위 쉼표를 허용한다", () => {
    expect(smsReviewAmountInput(12500, "KRW")).toBe("12500");
    expect(smsReviewAmountMinorUnits("12,500", "KRW")).toBe(12500);
  });

  it("해외 결제는 표시 금액과 저장 금액을 혼동하지 않는다", () => {
    expect(smsReviewAmountInput(1299, "USD")).toBe("12.99");
    expect(smsReviewAmountMinorUnits("12.99", "USD")).toBe(1299);
    expect(smsReviewAmountMinorUnits("12", "USD")).toBe(1200);
    expect(smsReviewAmountMinorUnits("0.29", "USD")).toBe(29);
    expect(smsReviewAmountMinorUnits("1200", "JPY")).toBe(1200);
  });

  it("통화가 허용하지 않는 소수 자릿수를 조용히 버리지 않는다", () => {
    expect(smsReviewAmountMinorUnits("12.5", "KRW")).toBeNull();
    expect(smsReviewAmountMinorUnits("12.999", "USD")).toBeNull();
  });

  it.each(["", " ", "0", "-1", "1e3", "12,34", "1..2", "금액100", "9007199254740992"])(
    "잘못된 금액 %s는 제출 가능한 값으로 만들지 않는다",
    (input) => expect(smsReviewAmountMinorUnits(input, "KRW")).toBeNull(),
  );

  it("미확인 금액을 0원으로 채우지 않는다", () => {
    expect(smsReviewAmountInput(null, "KRW")).toBe("");
    expect(smsReviewAmountInput(Number.NaN, "USD")).toBe("");
  });
});
