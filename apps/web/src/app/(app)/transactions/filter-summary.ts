export type TransactionFilterKey =
  | "categoryId"
  | "cardId"
  | "memberId"
  | "type"
  | "status";
export type TransactionFilterOption = { value: string; label: string };
export type TransactionFilterChoices = Record<
  TransactionFilterKey,
  ReadonlyArray<TransactionFilterOption>
>;
export type TransactionFilterValues = Record<TransactionFilterKey, string> & {
  reviewOnly: boolean;
  excludedOnly: boolean;
  sharedOnly: boolean;
};
export type ActiveTransactionFilter = {
  key: TransactionFilterKey | "reviewOnly" | "excludedOnly" | "sharedOnly";
  label: string;
};

export const TRANSACTION_FILTER_LABELS: Record<TransactionFilterKey, string> = {
  categoryId: "카테고리",
  cardId: "카드",
  memberId: "구성원",
  type: "유형",
  status: "상태",
};

/**
 * 칩에 보일 값 이름. 목록에 아직 없거나 볼 수 없는 값(딥링크·비활성 구성원·남의 비공개 카드)은
 * id를 드러내지 않고 '선택됨'으로 보인다. 목록이 불러와지면 이름으로 바뀐다.
 */
export function filterValueLabel(
  key: TransactionFilterKey,
  values: TransactionFilterValues,
  choices: TransactionFilterChoices
): string | null {
  if (!values[key]) return null;
  return (
    choices[key].find((item) => item.value === values[key])?.label ?? "선택됨"
  );
}

/**
 * 기간·검색어를 뺀 조건이 하나라도 있는가. '초기화'는 이 조건만 지우고 기간·검색어는 남긴다.
 */
export function hasTransactionConditions(
  values: TransactionFilterValues
): boolean {
  return (
    (Object.keys(TRANSACTION_FILTER_LABELS) as TransactionFilterKey[]).some(
      (key) => values[key] !== ""
    ) ||
    values.reviewOnly ||
    values.excludedOnly ||
    values.sharedOnly
  );
}

/**
 * '취소·환불' 칩 하나로 유형(type)과 상태(status)를 함께 고른다(2026-11-05).
 * 예전에는 '유형: 승인·취소'와 '상태: 승인·부분취소·취소·확인필요·중복의심'이 따로 있어 '취소'가 두 군데 나왔다.
 * 확인 필요·중복 의심은 '확인할 거래' 칩이 맡고(서버의 review 필터와 같다), 승인만 보기는 쓸 일이 거의 없어 뺐다.
 * URL로 들어온 값(예: status=approved)은 그대로 보여 주고 '전체'로 지울 수 있다.
 *
 * 이름은 앱 전체 규칙을 따른다(2026-11-05 HIG 검수 3·4단계) — 원래 결제는 '취소됨'·'부분 취소',
 * 취소로 생긴 기록은 '환불'이라, 고르는 말도 '취소된 결제'·'부분 취소된 결제'·'환불 기록'이다.
 * 고른 이름이 칩에 그대로 보인다(`cancellationFilterLabel`).
 */
export const CANCELLATION_FILTER_OPTIONS: ReadonlyArray<TransactionFilterOption> =
  [
    { value: "status:cancelled", label: "취소된 결제" },
    { value: "status:partially_cancelled", label: "부분 취소된 결제" },
    { value: "type:cancellation", label: "환불 기록" },
  ];

/** 지금 유형·상태 값을 '취소·환불' 칩의 값으로 바꾼다. 둘 다 있으면 유형이 먼저다. */
export function cancellationFilterValue(
  values: Pick<TransactionFilterValues, "type" | "status">
): string {
  if (values.type) return `type:${values.type}`;
  if (values.status) return `status:${values.status}`;
  return "";
}

/** '취소·환불' 칩에서 고른 값을 유형·상태로 푼다. 빈 값은 둘 다 지운다. */
export function cancellationFilterChange(
  value: string
): Pick<TransactionFilterValues, "type" | "status"> {
  const [key, raw = ""] = value.split(":");
  return {
    type: key === "type" ? raw : "",
    status: key === "status" ? raw : "",
  };
}

/** '취소·환불' 칩에 보일 이름. 칩 목록에 없는 값은 원래 이름(유형·상태)으로 보인다. */
export function cancellationFilterLabel(
  values: TransactionFilterValues,
  choices: TransactionFilterChoices
): string | null {
  const value = cancellationFilterValue(values);
  if (!value) return null;
  const known = CANCELLATION_FILTER_OPTIONS.find(
    (option) => option.value === value
  );
  if (known) return known.label;
  const key: TransactionFilterKey = values.type ? "type" : "status";
  return `${TRANSACTION_FILTER_LABELS[key]}: ${filterValueLabel(
    key,
    values,
    choices
  )}`;
}
