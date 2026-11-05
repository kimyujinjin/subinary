/**
 * 창 모양 — 용도마다 하나, 애플 HIG의 구분을 따른다(2026-11-05 전수조사로 정리).
 *
 * | 용도                                   | HIG 부품        | 모양                                                       | 쓰는 것                              |
 * |----------------------------------------|-----------------|------------------------------------------------------------|--------------------------------------|
 * | 상세 보기(가계부 거래 상세)            | 시트            | 모든 폭에서 아래에 붙음, 최대 85%, 손잡이                  | `DialogContent layout="sheet"`       |
 * | 선택지·안내(자산 추가·보관 안내 등)    | 시트            | 모든 폭에서 아래에 붙음, 최대 85%, 손잡이                  | `BottomSheet` 위젯                   |
 * | 입력 폼(거래 추가·메모 등)             | 시트·폼 시트    | 폰은 아래에서 올라오고 넓은 화면은 가운데, 손잡이 없음     | `DialogContent`(기본)                |
 * | 내가 누른 동작의 확인(삭제·해제 등)    | 액션 시트       | 폰은 아래쪽에 떠 있는 카드(위험한 버튼 위, 취소 아래), 넓은 화면은 가운데 | `AlertDialogContent`(기본)  |
 * | 예상 못 한 문제 알림                   | 얼럿            | 모든 폭에서 화면 가운데 작은 창                            | `AlertDialogContent variant="alert"` |
 * | 값 고르기(카테고리·기간 등)            | 팝업 버튼+메뉴  | 누른 자리 아래 메뉴, 지금 값에 체크 — 창이 아니다          | `PickerMenu`(components/ui)           |
 *
 * HIG: "의도한 동작에 딸린 선택(확인)에는 얼럿이 아니라 액션 시트를 쓴다. 얼럿은 보통 예상하지 못한 문제를 알린다."
 * 같은 날 '전부 바텀 시트'로 넓혔다가("모든 걸 다 바텀 시트로 만들라고 한 건 아니었다") 정리했고,
 * 확인을 가운데 창으로만 두었다가 HIG 기준으로 액션 시트로 고쳤다. `sheet-layout.test.ts`가 고정한다.
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

/**
 * 액션 시트(`AlertDialogContent` 기본) — 내가 누른 동작의 확인. 폰에서는 화면 양옆·아래에 여백을 두고 떠 있는
 * 작은 카드(손잡이·스크롤 없음, 위험한 버튼이 위·취소가 아래), 넓은 화면(sm 이상)에서는 가운데 작은 창.
 */
export const ACTION_SHEET =
  "inset-x-2 bottom-[max(0.5rem,var(--safe-bottom))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card p-5 shadow-lg data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom sm:inset-x-auto sm:bottom-auto sm:top-[50%] sm:left-[50%] sm:w-full sm:max-w-sm sm:translate-x-[-50%] sm:translate-y-[-50%] sm:p-6 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95";

/** 얼럿(`AlertDialogContent variant="alert"`) — 예상 못 한 문제 알림. 모든 폭에서 화면 가운데 작은 창. */
export const ALERT_CENTERED =
  "top-[50%] left-[50%] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card p-6 shadow-lg sm:max-w-sm data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95";
