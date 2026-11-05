/**
 * 가져온 대출 확인 칸(2026-11-06 문구 정리).
 * 공개 범위는 대출 줄 부제·카드·거래 상세와 같은 이름('나만 보기'·'가족 공개')으로 부른다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LoanReviewDraft } from "./model";
import { LoanReviewFields } from "./review-fields";

const draft: LoanReviewDraft = {
  label: "합성 전세 대출",
  visibility: "private",
  totalMode: "reference",
  replacesManualAssetId: "",
  confirmedSharing: false,
};

function render(patch: Partial<LoanReviewDraft> = {}): string {
  return renderToStaticMarkup(
    <LoanReviewFields
      draft={{ ...draft, ...patch }}
      onChange={() => {}}
      options={[]}
      userId="me"
      householdId="4d1f3c22-1e6b-4b5f-8a3e-2a9b6c7d8e90"
    />
  );
}

describe("가져온 대출 확인 칸", () => {
  it("공개 범위 선택지는 '나만 보기'·'가족 공개'", () => {
    const html = render();
    expect(html).toMatch(/<label[^>]*>공개 범위<\/label>/);
    expect(html).toMatch(/<option value="private"[^>]*>나만 보기<\/option>/);
    expect(html).toMatch(/<option value="household"[^>]*>가족 공개<\/option>/);
    expect(html).not.toContain("가족 공유");
    expect(html).not.toContain("공유하지 않음");
  });

  it("연결할 대출 안내도 같은 이름 — '가족 공유 설정'이라고 하지 않는다", () => {
    const html = render({ totalMode: "replacement" });
    expect(html).toContain("공개 범위를 확인해 주세요.");
    expect(html).not.toContain("가족 공유 설정");
  });

  it("가족 공개를 고르면 동의 체크는 그대로 남는다", () => {
    const html = render({ visibility: "household" });
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("공유하는 데 동의해요.");
  });
});
