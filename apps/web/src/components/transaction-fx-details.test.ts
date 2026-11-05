import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  TransactionFxDetails,
  foreignAmountLabel,
  fxRateLine,
} from "./transaction-fx-details";

/** 화면에 내부 용어를 쓰지 않는다(2026-11-05 HIG 검수 — 출처·환산 기준 표를 한 줄로 줄였다). */
const INTERNAL = /스냅샷|운영자|ECB|유럽중앙은행|참고환율|환산 기준/;

describe("transaction FX evidence", () => {
  it("저장된 환율과 실제 기준일을 한 줄로 보여 준다", () => {
    const html = renderToStaticMarkup(createElement(TransactionFxDetails, { currency: "USD", exchangeRate: 1324.63, fx: { basis: "daily_reference", asOfDate: "2026-10-22", source: "ecb", rate: "1324.631860776439", isReference: true } }));
    expect(html).toContain("1달러 = 1,324.63원");
    expect(html).toContain("10월 22일 기준");
    expect(html).toContain("카드 청구액과 다를 수 있어요");
    // 날짜는 lib/format 표기를 따른다 — '2026-10-22'를 그대로 보이지 않는다.
    expect(html).not.toContain("2026-10-22");
    expect(html).not.toMatch(INTERNAL);
  });
  it("예전 응답은 기준일을 지어내지 않는다", () => {
    const line = fxRateLine({ currency: "USD", exchangeRate: 1300 });
    expect(line).toBe("1달러 = 1,300원");
    expect(line).not.toMatch(/\d+월 \d+일/);
  });
  it("보충한 기록도 내부 용어 없이 같은 모양으로 말한다", () => {
    const line = fxRateLine({ currency: "JPY", exchangeRate: null, fx: { basis: "manual_reference", asOfDate: "2026-10-21", source: "manual", rate: "8.9", isReference: true } });
    expect(line).toContain("1엔 = 8.9원");
    expect(line).toContain("10월 21일 기준");
    expect(line).not.toMatch(INTERNAL);
  });
  it("기록이 없으면 없다고 말한다", () => {
    const line = fxRateLine({ currency: "EUR", exchangeRate: null, fx: { basis: "unknown", asOfDate: null, source: null, rate: null, isReference: null } });
    expect(line).toBe("환율 기록이 없어요");
    expect(line).not.toContain("1유로");
  });
  it("기준이 확인되지 않은 기록의 날짜는 쓰지 않는다", () => {
    const line = fxRateLine({ currency: "USD", exchangeRate: 1300, fx: { basis: "unknown", asOfDate: "2026-10-21", source: null, rate: "1300", isReference: null } });
    expect(line).toBe("1달러 = 1,300원");
  });
  it("1원보다 작은 환율은 소수 둘째 자리에서 자르지 않는다 — VND·IDR이 0.05·0.09로 틀어지지 않게", () => {
    const vnd = fxRateLine({ currency: "VND", exchangeRate: null, fx: { basis: "daily_reference", asOfDate: "2026-10-22", source: "ecb", rate: "0.054321000000", isReference: true } });
    expect(vnd).toContain("1 VND = 0.05432원");
    expect(vnd).not.toContain("= 0.05원");
    const idr = fxRateLine({ currency: "IDR", exchangeRate: 0.0874 });
    expect(idr).toBe("1 IDR = 0.0874원");
    expect(idr).not.toContain("0.09원");
    // 아주 작은 환율도 0원이 되지 않는다.
    expect(fxRateLine({ currency: "VND", exchangeRate: 0.000912345 })).toBe("1 VND = 0.0009123원");
  });
  it("모르는 통화는 코드로 쓴다", () => {
    expect(fxRateLine({ currency: "GBP", exchangeRate: 1750.5 })).toBe("1 GBP = 1,750.5원");
  });
  it("외화 원금은 통화 코드와 자리 수를 지켜 쓴다", () => {
    expect(foreignAmountLabel(1234, "USD")).toBe("USD 12.34");
    expect(foreignAmountLabel(1200, "usd")).toBe("USD 12.00");
    expect(foreignAmountLabel(1300, "JPY")).toBe("JPY 1,300");
  });
});
