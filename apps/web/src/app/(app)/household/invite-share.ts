/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족 초대 링크의 유효 기간과 전달(공유·복사)
 *
 * 화면과 떼어 둔 순수 함수. 서버는 유효 기간을 시간 단위(`expiresInHours`, 1~720)로 받지만
 * 화면에는 날 단위 선택지만 보인다 — '만료 (시간)' 숫자 칸에 168을 받던 것은 서버 필드가
 * 그대로 드러난 것이었다(2026-11 HIG 검수).
 * ------------------------------------------------------------------------- */

/** 링크 유효 기간 선택지. 값은 서버에 보낼 시간(문자열 — 값 고르기 메뉴가 문자열을 쓴다). */
export const INVITE_EXPIRY_OPTIONS = [
  { value: "24", label: "1일" },
  { value: "72", label: "3일" },
  { value: "168", label: "7일" },
  { value: "720", label: "30일" },
] as const;

/** 기본 7일 — 서버 기본값(contracts `invitationCreateRequestSchema`)과 같다. */
export const DEFAULT_INVITE_EXPIRY_HOURS = 168;

export function inviteExpiryLabel(hours: number): string {
  return (
    INVITE_EXPIRY_OPTIONS.find((option) => Number(option.value) === hours)
      ?.label ?? `${hours}시간`
  );
}

/**
 * 공유 시트(Web Share API)를 쓸 수 있는가. Android 웹뷰(Capacitor)에는 없다 —
 * 그때는 '링크 복사하기'가 주 버튼이 된다.
 */
export function canShareLink(nav: { share?: unknown } | undefined): boolean {
  return typeof nav?.share === "function";
}

export function inviteShareText(householdName: string): string {
  return householdName
    ? `'${householdName}' 가족 가계부에 초대했어요. 링크를 눌러 함께해요.`
    : "가족 가계부에 초대했어요. 링크를 눌러 함께해요.";
}

export type ShareResult = "shared" | "cancelled" | "failed";

/**
 * 초대 결과 창이 열린 채 안드로이드 뒤로 버튼을 눌렀을 때 할 일. 창이 받지 않으면 앱이 앞 화면으로
 * 돌아가 한 번만 보이는 링크가 확인 없이 사라진다. 보내기(복사·공유) 전에는 바깥 누르기와 같은 오조작으로
 * 보고 무시한다 — 창의 X·'닫기'가 출구다. 보낸 뒤에는 화면은 두고 창만 닫는다(Android 대화상자 관례).
 */
export function inviteResultBackAction(handedOff: boolean): "close" | "ignore" {
  return handedOff ? "close" : "ignore";
}

/**
 * 공유 시트를 연다. 사용자가 시트를 그냥 닫으면(AbortError) 실패가 아니라 취소다 —
 * 오류 문구를 띄우지 않고, 링크를 전달한 것으로도 치지 않는다.
 */
export async function shareInviteLink(
  nav: { share: (data: ShareData) => Promise<void> },
  input: { url: string; householdName: string }
): Promise<ShareResult> {
  try {
    await nav.share({
      title: "가족 초대",
      text: inviteShareText(input.householdName),
      url: input.url,
    });
    return "shared";
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    return name === "AbortError" ? "cancelled" : "failed";
  }
}
