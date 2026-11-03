import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransactionFxDetails } from "./transaction-fx-details";

describe("transaction FX evidence", () => {
  it("renders the actual snapshot date and daily source, including a cancellation's approval date", () => {
    const html = renderToStaticMarkup(createElement(TransactionFxDetails, { currency: "USD", exchangeRate: 1324.63, fx: { basis: "daily_reference", asOfDate: "2026-10-22", source: "ecb", rate: "1324.631860776439", isReference: true } }));
    expect(html).toContain("2026-10-22");
    expect(html).toContain("유럽중앙은행(ECB)");
    expect(html).toContain("1324.631860776439");
    expect(html).toContain("일일 참고환율");
    expect(html).not.toContain("승인 시점 환산");
  });
  it("does not invent a source or date for a legacy response", () => {
    const html = renderToStaticMarkup(createElement(TransactionFxDetails, { currency: "USD", exchangeRate: 1300 }));
    expect(html).toContain("기록 없음");
    expect(html).toContain("1 USD = 1300원");
    expect(html).not.toContain("ECB");
  });
  it("distinguishes operator-supplied snapshots", () => {
    const html = renderToStaticMarkup(createElement(TransactionFxDetails, { currency: "JPY", exchangeRate: null, fx: { basis: "manual_reference", asOfDate: "2026-10-21", source: "manual", rate: "8.9", isReference: true } }));
    expect(html).toContain("운영자 보충 스냅샷");
    expect(html).not.toContain("ECB");
  });
  it("labels absent evidence honestly", () => {
    const html = renderToStaticMarkup(createElement(TransactionFxDetails, { currency: "EUR", exchangeRate: null, fx: { basis: "unknown", asOfDate: null, source: null, rate: null, isReference: null } }));
    expect(html).toContain("기준 정보 없음");
    expect(html).not.toContain("1 EUR");
  });
  it("does not assert reference-rate semantics without evidence", () => {
    const html = renderToStaticMarkup(createElement(TransactionFxDetails, { currency: "USD", exchangeRate: 1300, fx: { basis: "manual_reference", asOfDate: "2026-10-21", source: "manual", rate: "1300", isReference: null } }));
    expect(html).toContain("저장된 환산 기준");
    expect(html).not.toContain("참고환율");
  });
});
