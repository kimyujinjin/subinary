import { describe, expect, it } from "vitest";

import {
  holdingChip,
  importedLoanChip,
  importedLoanHref,
  LOAN_RECORDS_HREF,
  REPLACED_MANUAL_CHIP,
  unresolvedImportedLoans,
} from "./asset-rows";

describe("자산 목록의 합계 제외 칩", () => {
  it("합계에 들어간 가져온 대출에는 칩을 달지 않는다", () => {
    expect(
      importedLoanChip({ includedInTotals: true, exclusionReason: null })
    ).toBeNull();
  });
  it("뺀 이유를 '합계 제외 · 이유'로 짧게 적는다", () => {
    expect(
      importedLoanChip({
        includedInTotals: false,
        exclusionReason: "duplicate_visible_loan",
      })
    ).toEqual(["attention", "합계 제외 · 중복 확인 필요"]);
    expect(
      importedLoanChip({
        includedInTotals: false,
        exclusionReason: "replacement_changed",
      })
    ).toEqual(["attention", "합계 제외 · 연결 확인 필요"]);
    expect(
      importedLoanChip({
        includedInTotals: false,
        exclusionReason: "sharing_expired",
      })
    ).toEqual(["attention", "합계 제외 · 공유 확인 필요"]);
    expect(
      importedLoanChip({ includedInTotals: false, exclusionReason: null })
    ).toEqual(["attention", "합계 제외 · 설정 확인 필요"]);
  });
  it("사용자가 고른 '기록만 보관'은 문제가 아니라 회색이다", () => {
    expect(
      importedLoanChip({
        includedInTotals: false,
        exclusionReason: "reference",
      })
    ).toEqual(["neutral", "합계 제외 · 기록만 보관"]);
  });
  it("가져온 대출이 대신 계산하는 직접 입력 대출도 이유를 적는다", () => {
    expect(REPLACED_MANUAL_CHIP[1].startsWith("합계 제외 · ")).toBe(true);
  });
});

describe("가져온 대출 줄이 가는 곳", () => {
  it("내가 고칠 수 있는 대출은 '확인이 필요한 대출' 줄과 같은 기록 화면으로 간다", () => {
    expect(LOAN_RECORDS_HREF).toBe("/assets/loan-records");
    expect(importedLoanHref({ canEdit: true })).toBe(LOAN_RECORDS_HREF);
  });
  it("가족이 가져온 대출은 고칠 곳이 없어 누를 수 없는 줄이다", () => {
    expect(importedLoanHref({ canEdit: false })).toBeUndefined();
  });
});

describe("연결 계좌의 마지막 조회 칩", () => {
  it("새 값이면 칩이 없다", () => {
    expect(
      holdingChip({ stale: false, observedAt: new Date().toISOString() })
    ).toBeNull();
  });
  it("이전 값을 보여 주는 중이면 언제 조회한 값인지 적는다", () => {
    const observedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(holdingChip({ stale: true, observedAt })).toEqual([
      "neutral",
      "마지막 조회 · 3시간 전",
    ]);
  });
  it("시각을 읽을 수 없으면 시각 없이 적는다", () => {
    expect(holdingChip({ stale: true, observedAt: "x" })).toEqual([
      "neutral",
      "마지막 조회 값",
    ]);
  });
});

describe("확인이 필요한 가져온 대출", () => {
  it("서버 unresolvedLoans와 같은 기준 — 뺐고 '기록만 보관'이 아닌 것만", () => {
    const items = [
      { id: "a", includedInTotals: true, totalMode: "distinct" as const },
      { id: "b", includedInTotals: false, totalMode: "reference" as const },
      { id: "c", includedInTotals: false, totalMode: "distinct" as const },
      { id: "d", includedInTotals: false, totalMode: "replacement" as const },
    ];
    expect(unresolvedImportedLoans(items).map((item) => item.id)).toEqual([
      "c",
      "d",
    ]);
  });
});
