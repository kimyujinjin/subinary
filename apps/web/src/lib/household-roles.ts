/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족 역할의 이름과 설명
 *
 * 가족 화면(구성원 줄·초대 폼)과 머리의 가족 전환 메뉴가 같은 말을 쓰도록 한곳에 둔다.
 * 권한 판정은 서버가 한다(PRD §26). 여기 설명은 서버 권한과 같은 기준으로 적는다:
 * 구성원은 기록을 쓰고, 관리자는 거기에 예산·분류·가맹점 같은 가족 설정을 더 바꾸고,
 * 보기 전용은 읽기만 한다. 초대·내보내기·역할 바꾸기는 소유자만 한다.
 * ------------------------------------------------------------------------- */
import type { HouseholdRole } from "@family/contracts";

export const ROLE_LABEL: Readonly<Record<HouseholdRole, string>> = {
  owner: "소유자",
  admin: "관리자",
  member: "구성원",
  // 은행 연결 화면과 같은 이름 — '뷰어'는 영어라 무엇을 할 수 있는지 읽히지 않았다(2026-11 HIG 검수).
  viewer: "보기 전용",
};

/** 초대·역할 바꾸기로 줄 수 있는 역할. 소유자 넘기기는 없다(contracts `invitableRoleSchema`). */
export type InvitableRole = Exclude<HouseholdRole, "owner">;

/** 고르는 순서 — 가장 흔한 '구성원'이 먼저다. */
export const INVITABLE_ROLES: ReadonlyArray<InvitableRole> = [
  "member",
  "admin",
  "viewer",
];

/** 역할을 고르는 자리에 붙는 한 줄 설명. */
export const ROLE_DESCRIPTION: Readonly<Record<InvitableRole, string>> = {
  member: "지출을 함께 기록하고 볼 수 있어요",
  admin: "예산·분류 같은 가족 설정까지 바꿀 수 있어요",
  viewer: "기록을 볼 수만 있어요",
};

export function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as ReadonlyArray<string>).includes(value);
}
