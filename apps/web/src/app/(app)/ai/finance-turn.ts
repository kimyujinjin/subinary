/* ---------------------------------------------------------------------------
 * AI 도우미 — 가계부 응답 → 말풍선 한 턴.
 *
 * 화면(page.tsx)에서 떼어 둔 이유: "답 아래에 어떤 근거 행을 붙이는가"는 규칙이라
 * 테스트로 고정한다(Next 페이지 파일은 default 외의 export를 둘 수 없다).
 * ------------------------------------------------------------------------- */
import type {
  FinanceQueryItem,
  FinanceQueryResponse,
} from "@family/contracts";

/** 답 아래에 붙이는 근거 행의 최대 수(서버도 상위 5개까지만 준다). */
export const MAX_GROUNDING_ROWS = 5;

/** 화면의 문답 한 턴. 로컬에 저장되므로 필드를 지우지 말고 늘리기만 한다. */
export interface Turn {
  id: number;
  /** 저장 시각(ms) — 보존 기간 판정에 쓴다(lib/ai-chat-history.ts). */
  at: number;
  question: string;
  answer?: string;
  /** 서버가 "답할 근거가 없다"고 한 경우(오류 아님). */
  refused?: boolean;
  /** 거부와 함께 제시하는 "대신 이렇게 물어보세요". */
  suggestions?: string[];
  /** 답의 근거가 된 집계 행(어디에 얼마). 업데이트 전에 저장된 대화에는 없다. */
  rows?: FinanceQueryItem[];
  /** 네트워크/서버 오류 — 이때만 오류 스타일로 그린다. */
  error?: boolean;
}

/** 가계부 응답. `refused`면 답 대신 안내 + 예시 질문을 싣는다(오류 아님). */
export function financeTurn(res: FinanceQueryResponse): Partial<Turn> {
  return {
    answer: res.answer,
    refused: res.refused,
    suggestions: res.refused ? res.suggestions : undefined,
    rows: res.refused ? undefined : groundingRows(res),
  };
}

/**
 * 답 아래에 붙일 근거 행. 답이 대상 하나(카테고리·가맹점)에 대한 것이면 그 대상과 같은
 * 이름의 행은 답을 되풀이할 뿐이라 뺀다 — 브랜드처럼 여러 매장을 모은 답이면 매장 행이
 * 남는다. 총지출 답에는 행이 없다.
 */
export function groundingRows(
  res: FinanceQueryResponse,
): FinanceQueryItem[] | undefined {
  const items = res.data?.items;
  if (!items || items.length === 0) return undefined;
  const subject = res.data?.merchantName ?? res.data?.categoryName ?? null;
  const rows = items
    .filter((row) => row.label !== subject)
    .slice(0, MAX_GROUNDING_ROWS);
  return rows.length > 0 ? rows : undefined;
}
