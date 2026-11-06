import { describe, expect, it } from "vitest";

import {
  decisionOffersExclude,
  reviewDecision,
  rowActionToast,
  type ReviewDecisionInput,
} from "./decision-copy";

const approval: ReviewDecisionInput = {
  status: "duplicate_suspected",
  transactionType: "approval",
  excluded: false,
  hasCard: true,
  linked: false,
  canPickCard: true,
  duplicatePairAt: null,
};

describe("reviewDecision", () => {
  it("중복 의심은 정상·빼기를 같은 무게로 묻는다", () => {
    const decision = reviewDecision(approval);
    expect(decision?.question).toBe("같은 결제가 두 번 들어온 것 같아요");
    expect(decision?.actions).toEqual([
      { action: "markValid", label: "정상 결제예요" },
      { action: "exclude", label: "합계에서 빼기" },
    ]);
    expect(decision?.hint).toBeNull();
    expect(decision?.pairLabel).toBeNull();
    expect(decisionOffersExclude(decision)).toBe(true);
  });

  it("짝 결제를 찾았으면 그 결제의 시각을 가리키고 그 결제로 가는 버튼을 둔다", () => {
    const decision = reviewDecision({
      ...approval,
      duplicatePairAt: "11월 5일 오후 2:31",
    });
    expect(decision?.hint).toBe(
      "5분 안에 같은 금액 결제가 한 번 더 있어요 (11월 5일 오후 2:31)"
    );
    expect(decision?.pairLabel).toBe("그 결제 보기");
    // 이동 버튼은 답이 아니다 — 답은 그대로 두 개다.
    expect(decision?.actions.map((item) => item.action)).toEqual([
      "markValid",
      "exclude",
    ]);
  });

  it("오래된 거래라 최근 5건에 짝이 없어도, 짝을 못 찾았으면 비교 안내를 하지 않는다", () => {
    // 예전에는 '이 가맹점 최근 결제'가 보이기만 하면 '아래 최근 결제에 같은 금액이 있는지 보세요'라고 했다.
    // 오래된 중복 의심 거래는 짝이 최근 5건 밖에 있어 목록에서 찾을 수 없었다.
    const decision = reviewDecision({ ...approval, duplicatePairAt: null });
    expect(decision?.hint).toBeNull();
    expect(decision?.pairLabel).toBeNull();
    expect(JSON.stringify(decision)).not.toContain("최근 결제");
  });

  it("짝 결제 안내는 중복 의심에만 붙는다", () => {
    const decision = reviewDecision({
      ...approval,
      status: "pending_review",
      duplicatePairAt: "11월 5일 오후 2:31",
    });
    expect(decision?.hint).toBeNull();
    expect(decision?.pairLabel).toBeNull();
  });

  it("카드가 애매한 승인은 카드를 묻는다", () => {
    const decision = reviewDecision({
      ...approval,
      status: "pending_review",
      hasCard: false,
    });
    expect(decision?.question).toBe("어느 카드로 결제했는지 확인해 주세요");
    expect(decision?.actions.map((item) => item.action)).toEqual([
      "pickCard",
      "markValid",
    ]);
    expect(decisionOffersExclude(decision)).toBe(false);
  });

  it("고를 카드가 없으면 카드 고르기를 내지 않는다", () => {
    const decision = reviewDecision({
      ...approval,
      status: "pending_review",
      hasCard: false,
      canPickCard: false,
    });
    expect(decision?.actions).toEqual([
      { action: "markValid", label: "이대로 확인하기" },
    ]);
    expect(decision?.hint).toBeNull();
  });

  it("카드를 골라 둔 확인 필요 승인은 그 카드가 맞는지 묻는다", () => {
    const decision = reviewDecision({ ...approval, status: "pending_review" });
    expect(decision?.question).toBe("이 카드로 결제한 게 맞는지 확인해 주세요");
    expect(decision?.actions.map((item) => item.label)).toEqual([
      "다른 카드 고르기",
      "이 카드가 맞아요",
    ]);
  });

  it("원래 결제를 못 찾은 환불은 고르기·합계에서 빼기를 같은 무게로 묻는다(정상 확인은 서버에서 아무 일도 안 한다)", () => {
    const decision = reviewDecision({
      ...approval,
      status: "pending_review",
      transactionType: "cancellation",
    });
    // 질문은 지시가 아니라 사실 한 줄 — 원래 결제가 앱에 없을 수도 있어 '골라 주세요'만으로는 답할 수 없었다.
    expect(decision?.question).toBe("원래 결제를 찾지 못한 환불이에요");
    expect(decision?.hint).toBeNull();
    expect(decision?.pairLabel).toBeNull();
    expect(decision?.actions).toEqual([
      { action: "linkCancellation", label: "원래 결제 고르기" },
      { action: "exclude", label: "합계에서 빼기" },
    ]);
    // 삭제(되돌릴 수 없음)는 답으로 내지 않는다 — ⋯ 메뉴에만 있다.
    expect(JSON.stringify(decision)).not.toContain("삭제");
    // 삭제 확인도 이제 '합계에서 빼기'를 대안으로 말할 수 있다(page.tsx canExclude).
    expect(decisionOffersExclude(decision)).toBe(true);
  });

  it("중복 의심으로 잡힌 연결 안 된 환불도 같은 두 답이다 — 짝 결제 안내는 승인에만", () => {
    const decision = reviewDecision({
      ...approval,
      transactionType: "cancellation",
      duplicatePairAt: "11월 5일 오후 2:31",
    });
    expect(decision?.question).toBe("원래 결제를 찾지 못한 환불이에요");
    expect(decision?.actions.map((item) => item.action)).toEqual([
      "linkCancellation",
      "exclude",
    ]);
    expect(decision?.hint).toBeNull();
    expect(decision?.pairLabel).toBeNull();
  });

  it("합계에서 뺀 연결 안 된 환불은 다시 묻지 않는다", () => {
    expect(
      reviewDecision({
        ...approval,
        status: "pending_review",
        transactionType: "cancellation",
        excluded: true,
      })
    ).toBeNull();
  });

  it("연결된 취소의 확인 표시는 확인만 받는다", () => {
    const decision = reviewDecision({
      ...approval,
      status: "pending_review",
      transactionType: "cancellation",
      linked: true,
    });
    // 취소로 생긴 기록은 '환불'이라 부른다(이름 규칙). 원래 결제만 '취소됨'이다.
    expect(decision?.question).toBe("이 환불이 맞는지 확인해 주세요");
    expect(decision?.actions.map((item) => item.action)).toEqual(["markValid"]);
    // 연결된 환불은 원래 결제 금액에 이미 반영돼 있다 — 빼기를 묻지 않는다(돈 계산을 바꾸지 않는다).
    expect(decisionOffersExclude(decision)).toBe(false);
  });

  it("뺀 거래·확인할 필요 없는 거래는 묻지 않는다", () => {
    expect(reviewDecision({ ...approval, excluded: true })).toBeNull();
    expect(reviewDecision({ ...approval, status: "approved" })).toBeNull();
    expect(reviewDecision({ ...approval, status: "cancelled" })).toBeNull();
    expect(decisionOffersExclude(null)).toBe(false);
  });

  it("두 답은 늘 짧은 해요체이고 영어·내부 상태명을 쓰지 않는다", () => {
    const inputs: ReviewDecisionInput[] = [
      approval,
      { ...approval, duplicatePairAt: "11월 5일 오후 2:31" },
      { ...approval, status: "pending_review", hasCard: false },
      { ...approval, status: "pending_review" },
      {
        ...approval,
        status: "pending_review",
        transactionType: "cancellation",
      },
      {
        ...approval,
        status: "pending_review",
        transactionType: "cancellation",
        linked: true,
      },
    ];
    for (const input of inputs) {
      const decision = reviewDecision(input);
      const text = [
        decision?.question,
        decision?.hint,
        decision?.pairLabel,
        ...(decision?.actions.map((item) => item.label) ?? []),
      ].join(" ");
      expect(text).not.toMatch(/[A-Za-z_]/);
      // 행동 이름은 '합계에서 빼기' 하나 — '중복이라 빼기' 같은 변형을 쓰지 않는다.
      for (const item of decision?.actions ?? []) {
        if (item.action === "exclude") expect(item.label).toBe("합계에서 빼기");
      }
    }
  });
});

describe("rowActionToast", () => {
  it("한 일에 맞는 말을 한다", () => {
    expect(rowActionToast("markValid")).toBe("정상 결제로 확인했어요");
    expect(rowActionToast("markValid", "cancellation")).toBe("확인했어요");
    expect(rowActionToast("exclude")).toBe("합계에서 뺐어요");
    // 환불을 빼도 한 일 그대로 말한다(확인처럼 '결제' 말을 바꿀 필요가 없다).
    expect(rowActionToast("exclude", "cancellation")).toBe("합계에서 뺐어요");
    expect(rowActionToast("include", "cancellation")).toBe("합계에 다시 넣었어요");
    expect(rowActionToast("include")).toBe("합계에 다시 넣었어요");
    expect(rowActionToast("resolveCard")).toBe("카드를 연결하고 확인했어요");
    expect(rowActionToast("linkCancellation")).toBe("원래 결제와 연결했어요");
    expect(rowActionToast("update")).toBe("저장했어요");
  });
});
