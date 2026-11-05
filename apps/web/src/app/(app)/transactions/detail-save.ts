/**
 * 거래 상세에서 값을 고르면 그 자리에서 저장되는 동안의 표시(2026-11-05 HIG 검수 3·4단계).
 *
 * 예전에는 줄에서 값을 고르면 '변경 내용을 처리하고 있어요.' 문장이 금액과 목록 사이에 끼었다 빠지며
 * 목록을 한 줄만큼 밀고, 모든 줄이 흐려졌다가, '저장했어요' 토스트가 떴다. 연달아 고치면 누르려던 줄이
 * 손가락 아래에서 움직였다. 이제 바뀌는 줄의 값 자리에만 작은 진행 표시를 두고 오류도 그 줄 아래에 보인다.
 * 값이 제자리에서 바뀌는 것이 곧 확인이라, 토스트는 결과가 화면에 바로 보이지 않는 동작에만 띄운다.
 *
 * 금액 수정 칸(AmountInput)은 통화의 주 단위(USD '12.34')로 주고받고, 서버는 minor units 정수(1234)를 받는다.
 * 그 사이 변환도 여기 둔다 — 부동소수 곱셈 없이 글자로 옮겨 0.01 단위가 어긋나지 않게 한다.
 */
import type { TransactionUpdateRequest } from "@family/contracts";

import { amountDecimals } from "@/components/ui/amount-input";

import { rowActionToast, type RowActionKind } from "./decision-copy";

/** 상세 목록에서 고르면 바로 저장되는 줄. */
export type DetailField = "category" | "card" | "visibility" | "memo";

type ActionLike = Readonly<{
  kind: string;
  body?: Readonly<Record<string, unknown>>;
}>;

/**
 * 이 저장이 어느 줄의 값인가. 금액·날짜 수정과 확인·빼기·연결 같은 동작은 줄이 아니라 null이다
 * (금액·날짜는 수정 칸이, 나머지는 금액 아래 동작 자리가 오류를 보여 준다).
 * '앞으로도 이렇게 분류'(applyRule)도 카테고리 줄의 일이다.
 */
export function detailActionField(
  action: ActionLike | null | undefined
): DetailField | null {
  if (!action || action.kind !== "update" || !action.body) return null;
  const body = action.body;
  if (body.categoryId !== undefined) return "category";
  if (body.cardId !== undefined) return "card";
  if (body.visibility !== undefined) return "visibility";
  if (body.memo !== undefined) return "memo";
  return null;
}

/** 저장 하나가 차지하는 자리 — 고르는 줄, 또는 거래 전체에 걸린 동작('action': 확인·빼기·다시 넣기·연결·금액 수정). */
export type DetailSaveSlot = DetailField | "action";

/**
 * 진행 중이거나 실패한 저장 하나. 상세의 저장은 useMutation 하나로 보내는데, 그 상태는 마지막 호출만 기억한다.
 * 그래서 카테고리 저장 중에 공개 범위를 고르면 카테고리 줄이 옛 값으로 돌아가 보였고, 카테고리 저장이 실패해도
 * 그 문구가 어디에도 안 보였다. 이제 거래·자리마다 따로 둔다. seq는 같은 자리를 다시 저장했을 때
 * 앞 호출의 결과가 뒤 호출의 표시를 지우지 않게 한다.
 */
export type DetailSave = Readonly<{
  seq: number;
  kind: RowActionKind;
  status: "pending" | "error";
  /** 저장 중인 값(update만). 고른 값을 저장이 끝나기 전에 그 줄에 먼저 보인다. */
  body: TransactionUpdateRequest | null;
  /** 실패 문구 — status가 error일 때만. */
  message: string | null;
}>;

/** `${거래 id}:${자리}` → 저장 상태. */
export type DetailSaves = Readonly<Record<string, DetailSave>>;

/** 한 거래의 자리별 저장 상태(상세 시트가 읽는 모양). */
export type DetailSaveView = Readonly<Partial<Record<DetailSaveSlot, DetailSave>>>;

type SaveAction = Readonly<{
  id: string;
  kind: RowActionKind;
  body?: TransactionUpdateRequest;
}>;

const SAVE_SLOTS: readonly DetailSaveSlot[] = [
  "category",
  "card",
  "visibility",
  "memo",
  "action",
];

function saveKey(id: string, slot: DetailSaveSlot): string {
  return `${id}:${slot}`;
}

/** 이 저장이 차지하는 자리. 줄이 아니면 'action'이다. */
export function detailSaveSlot(action: SaveAction): DetailSaveSlot {
  return detailActionField(action) ?? "action";
}

/** 저장을 시작한다 — 그 자리의 지난 실패 문구는 새 진행 표시로 바뀐다. */
export function startDetailSave(
  saves: DetailSaves,
  action: SaveAction,
  seq: number
): DetailSaves {
  return {
    ...saves,
    [saveKey(action.id, detailSaveSlot(action))]: {
      seq,
      kind: action.kind,
      status: "pending",
      body: action.kind === "update" ? action.body ?? null : null,
      message: null,
    },
  };
}

/**
 * 저장이 끝났다. 성공이면 그 자리를 비우고, 실패면 문구를 남긴다.
 * 그 사이 같은 자리에 더 늦은 저장이 시작됐으면(seq가 다르면) 그 표시를 그대로 둔다.
 * seq를 모르면(onMutate 전에 실패) 그 자리의 진행 중 표시를 정리한다.
 */
export function settleDetailSave(
  saves: DetailSaves,
  action: SaveAction,
  seq: number | undefined,
  error: string | null
): DetailSaves {
  const key = saveKey(action.id, detailSaveSlot(action));
  const current = saves[key];
  if (current && seq !== undefined && current.seq !== seq) return saves;
  if (error == null) {
    if (!current) return saves;
    const next: Record<string, DetailSave> = { ...saves };
    delete next[key];
    return next;
  }
  return {
    ...saves,
    [key]: {
      seq: seq ?? current?.seq ?? 0,
      kind: action.kind,
      status: "error",
      body: null,
      message: error,
    },
  };
}

/**
 * 실패 문구를 지운다(진행 중인 저장은 그대로 둔다). 상세를 닫거나 다른 거래로 넘어갈 때 부른다 —
 * 같은 거래를 다시 열었을 때 이미 본 실패가 되살아나지 않게. slot을 주면 그 자리만 지운다.
 */
export function clearDetailErrors(
  saves: DetailSaves,
  id: string,
  slot?: DetailSaveSlot
): DetailSaves {
  let next: Record<string, DetailSave> | null = null;
  for (const each of slot ? [slot] : SAVE_SLOTS) {
    const key = saveKey(id, each);
    if (saves[key]?.status !== "error") continue;
    next ??= { ...saves };
    delete next[key];
  }
  return next ?? saves;
}

/** 한 거래의 자리별 저장 상태. */
export function detailSavesFor(
  saves: DetailSaves,
  id: string
): DetailSaveView {
  const view: Partial<Record<DetailSaveSlot, DetailSave>> = {};
  for (const slot of SAVE_SLOTS) {
    const save = saves[saveKey(id, slot)];
    if (save) view[slot] = save;
  }
  return view;
}

/**
 * 저장 성공 토스트. 고친 값(카테고리·카드·공개 범위·메모·금액·날짜)은 그 자리에서 바뀌어 보여서 띄우지 않는다.
 * 확인·빼기·다시 넣기·연결은 결정 블록이 사라지는 등 결과를 말로 해 줘야 알 수 있어 유지한다.
 */
export function savedToast(
  kind: RowActionKind,
  transactionType?: string
): string | null {
  if (kind === "update") return null;
  return rowActionToast(kind, transactionType);
}

/** minor units 정수 → 금액 칸 값(주 단위 글자). USD 1234 → '12.34', 5 → '0.05', 원화 13380 → '13380'. */
export function minorToAmountInput(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount) || amount < 0) return "";
  const places = amountDecimals(currency);
  if (places === 0) return String(amount);
  const digits = String(amount).padStart(places + 1, "0");
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/**
 * 금액 칸 값 → minor units 정수 글자. USD '12.3' → '1230', '0.05' → '5', 원화는 그대로.
 * 숫자가 아닌 값은 그대로 돌려 검사(`validateTransactionEdit`)가 막게 한다.
 */
export function amountInputToMinor(raw: string, currency: string): string {
  const places = amountDecimals(currency);
  const value = raw.trim();
  if (places === 0) return value;
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value);
  if (!match) return value;
  const int = match[1] ?? "";
  const frac = match[2] ?? "";
  if ((int === "" && frac === "") || frac.length > places) return value;
  return `${int}${frac.padEnd(places, "0")}`.replace(/^0+(?=\d)/, "");
}
