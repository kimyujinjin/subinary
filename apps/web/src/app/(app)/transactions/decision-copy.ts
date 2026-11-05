/**
 * 거래 상세의 '확인할 거래' 결정 블록 — 무엇을 묻고 어떤 답을 받을지(2026-11-05 HIG 검수 P0-1).
 *
 * 예전에는 상태 칩과 채움 버튼 '정상 거래로 확인하기'만 있었다. 무엇이 의심스러운지 말하지 않았고,
 * 반대 답('중복이라 빼기')은 ⋯ 메뉴 안에만 있어 진짜 중복을 '정상'으로 확정해 합계가 두 번 잡힐 수 있었다.
 * 이제 상태마다 질문 한 줄과 같은 무게의 답을 나란히 둔다(채움 버튼 없음).
 *
 * 서버가 이 상태를 매기는 때(apps/worker 승격, packages/transaction-domain):
 * - duplicate_suspected: 같은 카드(카드가 없으면 같은 구성원)·같은 금액·같은 가맹점 승인이 5분 안에 또 있을 때.
 *   그 '짝 결제'는 duplicate-pair.ts가 같은 조건으로 찾는다. 찾았을 때만 비교 안내와 '그 결제 보기'를 낸다.
 * - pending_review 승인: 카드 자동 연결이 애매할 때(뒤 4자리·발급사로 고른 카드가 여럿이거나 다른 구성원 카드) — 카드는 비어 있다.
 * - pending_review 취소: 원래 결제를 하나로 못 골랐을 때, 또는 사용자가 연결을 풀었을 때.
 *   연결 안 된 취소에 '정상 확인'(markValid)을 보내면 서버는 그대로 pending_review로 둔다 — 그래서 취소에는 연결만 묻는다.
 */

/** 결정 블록의 답 하나가 하는 일. */
export type ReviewDecisionAction =
  /** 확인 표시를 지운다(markValid). */
  | "markValid"
  /** 합계에서 뺀다(exclude). */
  | "exclude"
  /** 카드 메뉴를 열고, 고르면 카드 연결과 확인을 한 번에 한다. */
  | "pickCard"
  /** 원래 결제 고르기 창을 연다. */
  | "linkCancellation";

export type ReviewDecision = Readonly<{
  question: string;
  hint: string | null;
  /** 짝 결제로 넘어가는 버튼 이름. 짝을 찾았을 때만 있다(답이 아니라 이동이라 답과 다른 모양이다). */
  pairLabel: string | null;
  actions: ReadonlyArray<
    Readonly<{ action: ReviewDecisionAction; label: string }>
  >;
}>;

export type ReviewDecisionInput = Readonly<{
  status: string;
  transactionType: string;
  /** 합계에서 뺀 거래(excludedAt). 이미 답한 것이라 묻지 않는다. */
  excluded: boolean;
  hasCard: boolean;
  /** 취소가 원래 결제에 연결돼 있는가(parentTransactionId). */
  linked: boolean;
  /** 고를 카드가 있는가. 없으면 카드 고르기를 내지 않는다. */
  canPickCard: boolean;
  /**
   * 서버가 중복으로 본 짝 결제(duplicate-pair.ts — 같은 카드·금액·가맹점, 5분 안)의 시각 표기.
   * 못 찾았으면 null — 그때는 비교 안내를 하지 않는다. 예전에는 '이 가맹점 최근 결제'(최신 5건)가
   * 보이기만 하면 '아래 최근 결제에 같은 금액이 있는지 보세요'라고 해서, 짝이 그 5건 밖에 있는
   * 오래된 거래에서도 안내가 나왔다 — 같은 금액을 못 찾은 사용자가 '정상 결제예요'를 눌러 합계가 두 번 잡혔다.
   */
  duplicatePairAt: string | null;
}>;

/** 확인할 거래면 질문과 답을, 아니면 null을 돌려준다. */
export function reviewDecision(
  input: ReviewDecisionInput
): ReviewDecision | null {
  if (input.excluded) return null;
  if (
    input.status !== "duplicate_suspected" &&
    input.status !== "pending_review"
  ) {
    return null;
  }

  if (input.transactionType === "cancellation") {
    // 연결 안 된 취소는 '정상 확인'을 눌러도 그대로라, 할 수 있는 답은 원래 결제를 고르는 것뿐이다.
    if (!input.linked) {
      return {
        question: "어떤 결제를 취소한 건지 골라 주세요",
        hint: null,
        pairLabel: null,
        actions: [{ action: "linkCancellation", label: "원래 결제 고르기" }],
      };
    }
    return {
      question: "이 취소가 맞는지 확인해 주세요",
      hint: null,
      pairLabel: null,
      actions: [{ action: "markValid", label: "확인했어요" }],
    };
  }

  if (input.status === "duplicate_suspected") {
    return {
      question: "같은 결제가 두 번 들어온 것 같아요",
      // 거래 요약에는 겹친 결제의 id가 없다 — 서버와 같은 조건으로 찾은 짝 결제를 가리킨다.
      hint:
        input.duplicatePairAt != null
          ? `5분 안에 같은 금액 결제가 한 번 더 있어요 (${input.duplicatePairAt})`
          : null,
      pairLabel: input.duplicatePairAt != null ? "그 결제 보기" : null,
      actions: [
        { action: "markValid", label: "정상 결제예요" },
        { action: "exclude", label: "중복이라 빼기" },
      ],
    };
  }

  // pending_review 승인 = 어느 카드인지 몰라 카드를 비워 둔 결제.
  if (!input.hasCard) {
    return {
      question: "어느 카드로 결제했는지 확인해 주세요",
      hint: input.canPickCard ? "카드를 고르면 확인도 같이 끝나요" : null,
      pairLabel: null,
      actions: input.canPickCard
        ? [
            { action: "pickCard", label: "카드 고르기" },
            { action: "markValid", label: "이대로 확인" },
          ]
        : [{ action: "markValid", label: "이대로 확인" }],
    };
  }
  // 카드는 나중에 골랐지만 아직 확인하지 않은 결제.
  return {
    question: "이 카드로 결제한 게 맞는지 확인해 주세요",
    hint: null,
    pairLabel: null,
    actions: input.canPickCard
      ? [
          { action: "pickCard", label: "다른 카드 고르기" },
          { action: "markValid", label: "이 카드가 맞아요" },
        ]
      : [{ action: "markValid", label: "이 카드가 맞아요" }],
  };
}

/** 결정 블록이 '합계에서 빼기'를 이미 묻는가 — 그렇다면 ⋯ 메뉴에서 같은 동작을 빼낸다. */
export function decisionOffersExclude(
  decision: ReviewDecision | null
): boolean {
  return decision?.actions.some((item) => item.action === "exclude") ?? false;
}

/** 거래 상세에서 일어나는 저장 동작의 종류(page.tsx의 RowAction kind와 같다). */
export type RowActionKind =
  | "update"
  | "markDuplicate"
  | "markValid"
  | "exclude"
  | "include"
  | "linkCancellation"
  | "resolveCard";

const ROW_ACTION_TOASTS: Readonly<Record<RowActionKind, string>> = {
  update: "저장했어요",
  markDuplicate: "중복 의심으로 표시했어요",
  markValid: "정상 결제로 확인했어요",
  exclude: "합계에서 뺐어요",
  include: "합계에 다시 넣었어요",
  linkCancellation: "원래 결제와 연결했어요",
  resolveCard: "카드를 연결하고 확인했어요",
};

/**
 * 저장 성공 토스트. 예전에는 무엇을 했든 '저장했어요'라, 빼기·확인을 눌렀는지 토스트로는 알 수 없었다.
 * 취소 거래의 확인은 '결제'가 아니므로 따로 말한다.
 */
export function rowActionToast(
  kind: RowActionKind,
  transactionType?: string
): string {
  if (kind === "markValid" && transactionType === "cancellation") {
    return "확인했어요";
  }
  return ROW_ACTION_TOASTS[kind];
}
