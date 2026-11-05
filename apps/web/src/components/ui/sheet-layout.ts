/**
 * 하단 시트 배치 — 대화상자(Dialog)·확인창(AlertDialog)·선택 시트(BottomSheet)가 모두 쓴다.
 *
 * 화면 폭과 상관없이 아래에 붙고 위 모서리만 둥글다. 넓은 화면(sm 이상)에서는 가운데 정렬만 더한다.
 * 2026-11-05 사용자 결정: 예전에는 sm 이상에서 가운데 대화상자로 바뀌어 PC·태블릿·펼친 폴드폰에서는
 * 시트가 아니었다. 최대 폭·높이·여백은 컴포넌트가 정한다. `sheet-layout.test.ts`가 고정한다.
 */
export const SHEET_POSITION =
  "inset-x-0 bottom-0 rounded-t-card data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom sm:inset-x-auto sm:left-[50%] sm:translate-x-[-50%]";

/** 대화상자·확인창 — 위쪽 안전 영역을 비우고 시트 안만 스크롤한다. 넓은 화면에서는 최대 폭 lg. */
export const DIALOG_SHEET = `${SHEET_POSITION} max-h-[calc(100dvh-var(--safe-top)-1.5rem)] sm:max-h-[calc(100dvh-4rem)] sm:max-w-lg sm:p-6`;
