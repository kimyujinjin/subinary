/**
 * 가져온 대출 줄의 글자(2026-11-05 HIG 검수 4단계).
 * 줄마다 반복되던 '은행 잔액 기준일 미확인'은 부제에서 뺐다.
 * '합계 제외' 칩은 자산 탭과 같은 importedLoanChip 하나를 쓴다 — 여기서는 수정 창·선택지와 말이 맞는지만 묶는다.
 */
import { describe, expect, it } from "vitest";

import { importedLoanChip } from "@/app/(app)/assets/asset-rows";

import { loanInclusionLabel, loanRowSubtitle } from "./loan-rows";
import { LOAN_EXCLUSION_LABELS, LOAN_TOTAL_LABELS } from "./model";

const now = new Date("2026-11-05T12:00:00+09:00");

describe("'기록만 보관' 한 단어", () => {
  it("선택지·칩·수정 창 설명이 같은 말을 쓴다(예전 '참고용'·'참고만 하기' 없음)", () => {
    const reference = {
      includedInTotals: false,
      totalMode: "reference",
      exclusionReason: "reference",
    } as const;
    const texts = [
      LOAN_TOTAL_LABELS.reference,
      LOAN_EXCLUSION_LABELS.reference,
      loanInclusionLabel(reference),
      importedLoanChip(reference)?.[1] ?? "",
    ];
    for (const text of texts) {
      expect(text).toContain("기록만 보관");
      expect(text).not.toContain("참고");
    }
    // 사용자가 고른 상태라 문제 색(주의)이 아니다.
    expect(importedLoanChip(reference)?.[0]).toBe("neutral");
  });
});

describe("loanInclusionLabel", () => {
  it("합계에 어떻게 들어가는지 해요체로 말한다", () => {
    expect(
      loanInclusionLabel({
        includedInTotals: true,
        totalMode: "replacement",
        exclusionReason: null,
      })
    ).toBe("직접 입력한 대출 대신 합계에 들어가요");
    expect(
      loanInclusionLabel({
        includedInTotals: false,
        totalMode: "distinct",
        exclusionReason: "duplicate_visible_loan",
      })
    ).toContain("중복 확인 필요");
  });
});

describe("loanRowSubtitle", () => {
  it("만기일은 'M월 D일'(해가 다르면 연도)로 쓰고 ISO 날짜를 그대로 보이지 않는다", () => {
    const text = loanRowSubtitle(
      {
        visibility: "household",
        loanType: "jeonse",
        maturityDate: "2027-03-02",
      },
      now
    );
    expect(text).toBe("전세 대출 · 만기 2027년 3월 2일");
    expect(text).not.toContain("2027-03-02");
    expect(text).not.toContain("기준일 미확인");
  });

  it("나만 보는 기록과 모르는 만기를 알린다", () => {
    expect(
      loanRowSubtitle(
        { visibility: "private", loanType: "interim", maturityDate: null },
        now
      )
    ).toBe("나만 보기 · 중도금 대출 · 만기 미확인");
  });
});
