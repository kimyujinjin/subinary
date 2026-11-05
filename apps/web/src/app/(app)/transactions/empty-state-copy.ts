/**
 * 거래 목록이 비었을 때 무엇을 말하고 어떤 버튼 하나를 둘지(2026-11-05 HIG 검수 P0-3).
 *
 * 예전에는 조건이 없으면 늘 '아직 거래가 없어요 · 장치 연결하러 가기'였다. 매달 초에는 이번 달 결제가
 * 아직 없을 뿐인데 연결이 끊긴 것처럼 읽혔다. 장치 권유는 이 가족에게 거래가 하나도 없을 때만 한다.
 * '하나도 없다'는 목록과 같은 기준(기간·조건 없이 거래 목록 1건)으로 판단한다 — 원화 승인만 세는
 * 달별 집계로 판단하면 외화·취소·뺀 거래만 있는 가족에게도 '아직 거래가 없어요'라고 했다.
 * 조건 결과 0건의 버튼은 원인 하나만 지운다 — 예전 '필터 초기화하기'는 달·검색어까지 지워
 * 칩 줄의 '초기화'(조건만 지움)와 뜻이 달랐다.
 */
import { addMonths, prevAvailable } from "@/lib/month";

export type TransactionsEmptyInput = Readonly<{
  /** 고른 달(`YYYY-MM`). 빈 문자열은 전체 기간. */
  month: string;
  /** 이번 달(`YYYY-MM`, Asia/Seoul). */
  currentMonth: string;
  /** '확인할 거래'를 뺀 칩 조건(카테고리·구성원·카드·취소·환불·뺀 거래·공용 카드)이 하나라도 있는가. */
  hasOtherConditions: boolean;
  /** '확인할 거래' 칩이 켜졌는가. */
  reviewOnly: boolean;
  /** 목록에 실제로 적용된 검색어(디바운스 뒤). */
  query: string;
  /**
   * 이 가족에게 볼 수 있는 거래가 하나라도 있는가 — 기간·조건 없이 거래 목록을 1건만 불러 판단한다
   * (목록과 같은 API·같은 공개 범위). 아직 모르거나 불러오지 못했으면 null —
   * 그때는 장치 권유도 '지난달 보기'도 하지 않는다(모르는 것을 말하지 않는다).
   */
  hasAnyTransaction: boolean | null;
  /**
   * 거래가 있는 달(`useAnalyticsMonths` — 원화·승인·뺀 거래와 자산 이동 제외 집계라 목록보다 좁다).
   * '지난달 보기'가 빈 달을 가리키지 않게 이동 대상을 고르는 데만 쓴다. 모르면 null(지난달로 보낸다).
   */
  monthsWithTransactions: readonly string[] | null;
}>;

export type TransactionsEmptyAction =
  | Readonly<{ kind: "clearConditions"; label: string }>
  | Readonly<{ kind: "clearSearch"; label: string }>
  | Readonly<{ kind: "showMonth"; label: string; month: string }>
  | Readonly<{ kind: "connectDevice"; label: string; href: "/devices" }>;

export type TransactionsEmptyCopy = Readonly<{
  /** noMatch: 조건·검색 결과가 0건. empty: 고른 기간에 거래가 없음. */
  reason: "noMatch" | "empty";
  title: string;
  description: string | null;
  action: TransactionsEmptyAction | null;
}>;

/** `YYYY-MM` → '11월'. 올해가 아니면 '2025년 12월'. */
export function monthName(month: string, currentMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const label = `${Number(match[2])}월`;
  return match[1] === currentMonth.slice(0, 4)
    ? label
    : `${match[1]}년 ${label}`;
}

const NO_TRANSACTIONS: TransactionsEmptyCopy = {
  reason: "empty",
  title: "아직 거래가 없어요",
  description: "카드 문자가 도착하면 자동으로 정리해 드려요",
  action: {
    kind: "connectDevice",
    label: "장치 연결하러 가기",
    href: "/devices",
  },
};

export function transactionsEmptyCopy(
  input: TransactionsEmptyInput
): TransactionsEmptyCopy {
  const { month, currentMonth } = input;
  // 검색·조건은 고른 달 안에서만 찾는다 — 다른 달에 있을 수 있다는 것을 알 수 있게 범위를 말한다.
  const scope = month
    ? `${monthName(month, currentMonth)} 거래 중에서 찾았어요`
    : null;

  if (input.reviewOnly || input.hasOtherConditions) {
    // '확인할 거래가 없어요'는 다른 조건·검색어 없이 그 칩만 켰을 때만 사실이다.
    const narrowed = input.hasOtherConditions || input.query !== "";
    return {
      reason: "noMatch",
      title: !input.reviewOnly
        ? "조건에 맞는 거래가 없어요"
        : narrowed
        ? "조건에 맞는 확인할 거래가 없어요"
        : "확인할 거래가 없어요",
      description: scope,
      action: { kind: "clearConditions", label: "조건 지우기" },
    };
  }
  if (input.query !== "") {
    return {
      reason: "noMatch",
      title: "검색어와 맞는 거래가 없어요",
      description: scope,
      action: { kind: "clearSearch", label: "검색어 지우기" },
    };
  }
  // 조건 없이 전체 기간이 비었다 = 이 가족이 볼 수 있는 거래가 하나도 없다.
  if (month === "") return NO_TRANSACTIONS;
  if (month !== currentMonth) {
    return {
      reason: "empty",
      title: `${monthName(month, currentMonth)} 거래가 없어요`,
      description: null,
      action: { kind: "showMonth", label: "이번 달 보기", month: currentMonth },
    };
  }

  const thisMonth: TransactionsEmptyCopy = {
    reason: "empty",
    title: `${monthName(currentMonth, currentMonth)} 거래는 아직 없어요`,
    description: null,
    action: null,
  };
  if (input.hasAnyTransaction == null) return thisMonth;
  if (!input.hasAnyTransaction) return NO_TRANSACTIONS;
  // 이동 대상은 지난달이다. 달별 집계가 지난달이 비었다고 알 때만 거래가 있는 더 이전 달로 보낸다 —
  // 빈 화면을 한 번 더 보이지 않는다. 집계에 이전 달이 하나도 없으면(외화·취소·뺀 거래만 있거나 낡은 값)
  // 거래가 어느 달에 있는지 몰라 버튼을 두지 않는다.
  const lastMonth = addMonths(currentMonth, -1);
  const months = input.monthsWithTransactions;
  const earlier =
    months == null || months.includes(lastMonth)
      ? lastMonth
      : prevAvailable([...months].sort(), currentMonth);
  if (earlier == null) return thisMonth;
  return {
    ...thisMonth,
    action: {
      kind: "showMonth",
      label:
        earlier === lastMonth
          ? "지난달 보기"
          : `${monthName(earlier, currentMonth)} 보기`,
      month: earlier,
    },
  };
}
