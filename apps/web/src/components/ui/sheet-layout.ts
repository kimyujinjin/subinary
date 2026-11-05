/**
 * 창 모양 — 용도마다 하나(2026-11-05 전수조사로 정리).
 *
 * | 용도                         | 모양                                                   | 쓰는 것                          |
 * |------------------------------|--------------------------------------------------------|----------------------------------|
 * | 상세 보기(가계부 거래 상세)  | 바텀 시트: 모든 폭에서 아래에 붙음, 최대 85%, 손잡이   | `DialogContent layout="sheet"`   |
 * | 선택지·안내(자산 추가 등)    | 바텀 시트: 모든 폭, 최대 85%, 손잡이                   | `BottomSheet` 위젯               |
 * | 입력 폼(거래 추가·메모 등)   | 폰은 아래에서 올라오고 넓은 화면은 가운데, 손잡이 없음 | `DialogContent`(기본)            |
 * | 확인(지울까요? 등 예/아니오) | 모든 폭에서 화면 가운데 작은 창                        | `AlertDialogContent`             |
 * | 값 고르기(카테고리·기간 등)  | 누른 자리 아래 드롭다운 — 창이 아니다                  | `PickerMenu`(transactions)       |
 *
 * 같은 날 '대화상자·확인창·선택 목록을 모두 바텀 시트로' 넓혔다가 사용자 지적("모든 걸 다 바텀 시트로
 * 만들라고 한 건 아니었다")으로 되돌렸다. 바텀 시트는 상세 보기와 선택지·안내에만 쓴다.
 * `sheet-layout.test.ts`가 고정한다.
 */

/** 바텀 시트 위치 — 아래에 붙고 위 모서리만 둥글다. 넓은 화면(sm 이상)에서는 가운데 정렬만 더한다. */
export const SHEET_POSITION =
  "inset-x-0 bottom-0 rounded-t-card data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom sm:inset-x-auto sm:left-[50%] sm:translate-x-[-50%]";

/** 바텀 시트 높이 — 내용만큼, 최대 화면의 85%라 뒤의 화면이 늘 보인다. 넘치면 시트 안에서 스크롤한다. */
export const SHEET_MAX_HEIGHT = "max-h-[85dvh]";

/** 상세 보기 시트(`DialogContent layout="sheet"`). 넓은 화면에서는 최대 폭 lg. */
export const DIALOG_SHEET = `${SHEET_POSITION} ${SHEET_MAX_HEIGHT} sm:max-w-lg sm:p-6`;

/** 입력 폼(`DialogContent` 기본) — 폰은 아래에서 올라오는 창, 넓은 화면(sm 이상)은 가운데 창. */
export const DIALOG_RESPONSIVE =
  "inset-x-0 bottom-0 max-h-[calc(100dvh-var(--safe-top)-1.5rem)] rounded-t-card data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom sm:inset-x-auto sm:bottom-auto sm:top-[50%] sm:left-[50%] sm:max-h-[calc(100dvh-4rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-card sm:p-6 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95";

/** 확인(`AlertDialogContent`) — 모든 폭에서 화면 가운데 작은 창. */
export const ALERT_CENTERED =
  "top-[50%] left-[50%] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card p-6 shadow-lg sm:max-w-sm data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95";
