/* ---------------------------------------------------------------------------
 * 초대 전용 가입(P0-4) — 로그인·가입 화면이 주고받는 링크와 가입 안내 문구.
 *
 * 운영은 초대받은 사람만 가입할 수 있다(API `auth.registrationMode`, 기본 'invite').
 * 웹은 그 설정 값을 모르므로 "초대 토큰이 있는가"로만 화면을 가르고, 가입 가능
 * 여부의 최종 판단은 서버에 맡긴다(개발 환경은 공개 가입일 수 있다).
 *
 * 초대 토큰은 세 화면을 돈다: /join?token= → /login?returnTo=/join?token= →
 * /register?invite=. 한 곳에서라도 토큰을 버리면 로그인·가입 뒤 초대 수락이
 * 끊기므로 링크는 여기서만 만든다.
 * ------------------------------------------------------------------------- */
import type { InvitationPreview } from "@family/contracts";

/** returnTo 파싱에만 쓰는 표식 오리진(실제 요청에는 쓰이지 않는다). */
const PARSE_ORIGIN = "https://invite-links.invalid";

/** 초대 수락 화면 경로. 토큰은 여기서 한 번만 인코딩한다. */
export function joinPathFor(token: string): string {
  return `/join?token=${encodeURIComponent(token)}`;
}

/**
 * 로그인 화면의 `returnTo`(safeInternalPath를 통과한 값)가 초대 수락이면 그 토큰.
 * 아니면 null. 정적 export(trailingSlash)에서는 `/join/`으로 올 수 있어 둘 다 받는다.
 */
export function inviteTokenFromReturnTo(returnTo: string): string | null {
  let url: URL;
  try {
    url = new URL(returnTo, PARSE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PARSE_ORIGIN) return null;
  if (url.pathname !== "/join" && url.pathname !== "/join/") return null;
  return url.searchParams.get("token") || null;
}

/**
 * 로그인 → 가입 링크. 초대가 없으면 null — 초대 없이 가입 화면을 열면 다 입력한
 * 뒤에야 서버가 거절하므로, 그 자리에 "초대 링크로 가입한다"는 안내를 둔다.
 */
export function registerHrefFor(inviteToken: string | null): string | null {
  return inviteToken
    ? `/register?invite=${encodeURIComponent(inviteToken)}`
    : null;
}

/**
 * 가입 → 로그인 링크. 초대가 있으면 `returnTo`로 실어 로그인 뒤 수락 화면으로
 * 돌아오게 한다. 인코딩은 두 겹이다 — `joinPathFor`가 토큰을, 여기서 returnTo 값
 * 전체를 한 번 더. 로그인 화면은 searchParams.get이 바깥 겹을,
 * `inviteTokenFromReturnTo`가 안쪽 겹을 푼다.
 */
export function loginHrefFor(inviteToken: string | null): string {
  return inviteToken
    ? `/login?returnTo=${encodeURIComponent(joinPathFor(inviteToken))}`
    : "/login";
}

export const INVITE_ONLY_NOTICE =
  "모아는 가족 초대 링크로 가입해요. 받은 초대 링크를 열어 주세요.";
export const DEAD_INVITE_NOTICE =
  "이 초대 링크는 지금 쓸 수 없어요. 가족에게 새 링크를 받아 주세요.";

/**
 * 가입 화면 폼 위 안내 한 줄.
 *
 * - 토큰 없음: 초대 링크로 가입한다는 안내(폼은 그대로 — 서버가 판단).
 * - 미리보기가 없는 초대(404)이거나 대기 중이 아님(수락·취소·만료): 쓸 수 없는 링크.
 * - 그 밖(대기 중·불러오는 중·조회 실패): 초대로 가입한다는 한 줄. 가족 이름은
 *   미리보기가 준 경우에만 붙인다.
 */
export function registerNoticeFor(
  inviteToken: string | null,
  preview: Pick<InvitationPreview, "status" | "householdName"> | undefined,
  inviteMissing: boolean
): string {
  if (!inviteToken) return INVITE_ONLY_NOTICE;
  if (inviteMissing || (preview && preview.status !== "pending")) {
    return DEAD_INVITE_NOTICE;
  }
  return preview?.householdName
    ? `'${preview.householdName}' 가족 초대로 가입해요`
    : "가족 초대로 가입해요";
}
