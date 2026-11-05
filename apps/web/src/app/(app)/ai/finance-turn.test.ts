import type { FinanceQueryResponse } from "@family/contracts";
import { describe, expect, it } from "vitest";

import { financeTurn, groundingRows } from "./finance-turn";

const answered = (
  data: FinanceQueryResponse["data"],
): FinanceQueryResponse => ({
  answer: "답",
  data,
  method: "fallback",
  refused: false,
  suggestions: [],
});

describe("답 아래 근거 행", () => {
  it("가맹점별 답이면 상위 행을 최대 5줄까지 붙인다", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      label: `가맹점${i}`,
      net: 1_000 * (7 - i),
      count: 1,
    }));
    const rows = groundingRows(
      answered({
        month: "2026-11",
        aggregate: "byMerchant",
        categorySlug: null,
        categoryName: null,
        totalNet: 28_000,
        transactionCount: 7,
        items,
      }),
    );
    expect(rows).toEqual(items.slice(0, 5));
  });

  it("대상 하나에 대한 답이면 답을 되풀이하는 같은 이름의 행은 뺀다", () => {
    expect(
      groundingRows(
        answered({
          month: "2026-11",
          aggregate: "byCategory",
          categorySlug: "food",
          categoryName: "식비",
          totalNet: 300_000,
          transactionCount: 20,
          items: [{ label: "식비", net: 300_000, count: 20 }],
        }),
      ),
    ).toBeUndefined();
  });

  it("브랜드 답이면 매장 행이 남는다", () => {
    expect(
      groundingRows(
        answered({
          month: "2026-11",
          aggregate: "byMerchant",
          categorySlug: null,
          categoryName: null,
          merchantName: "스타벅스",
          totalNet: 12_300,
          transactionCount: 3,
          items: [
            { label: "스타벅스강남R점", net: 9_000, count: 2 },
            { label: "STARBUCKS 여의도", net: 3_300, count: 1 },
          ],
        }),
      ),
    ).toHaveLength(2);
  });

  it("총지출 답·거부에는 근거 행이 없다", () => {
    expect(
      groundingRows(
        answered({
          month: "2026-11",
          aggregate: "total",
          categorySlug: null,
          categoryName: null,
          totalNet: 1_000,
          transactionCount: 1,
        }),
      ),
    ).toBeUndefined();
    expect(
      financeTurn({
        answer: "이 질문은 아직 답하기 어려워요.",
        method: "fallback",
        refused: true,
        suggestions: ["이번 달 총 지출 얼마야?"],
      }),
    ).toEqual({
      answer: "이 질문은 아직 답하기 어려워요.",
      refused: true,
      suggestions: ["이번 달 총 지출 얼마야?"],
      rows: undefined,
    });
  });
});
