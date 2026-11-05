/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족 초대 목록 정리(순수 함수)
 *
 * 서버는 초대를 상태와 무관하게 전부 준다(household.service listInvitations). 화면은
 * 아직 쓸 수 있는 초대만 펼치고, 수락·만료·취소된 것은 접어 둔다.
 * ------------------------------------------------------------------------- */
import type { InvitationSummary } from "@family/contracts";

import type { ChipTone } from "@/components/widgets/status-chip";

export type InvitationStatus = InvitationSummary["status"];
export type PastInvitationStatus = Exclude<InvitationStatus, "pending">;

/**
 * 화면에서 보는 초대 상태.
 *
 * 서버는 만료 시각이 지난 초대를 누군가 수락을 시도하기 전까지 `pending`으로 둔다
 * (GET은 쓰기를 하지 않는다 — household.service `previewInvitation` 주석). 그대로 그리면
 * 이미 쓸 수 없는 링크가 '대기'로 보이고 취소 메뉴까지 붙으므로, 만료 시각으로 다시
 * 판정한다. 판정식은 서버 수락 경로와 같다(`expiresAt < now`면 만료).
 * 시각을 읽을 수 없으면 서버 값을 그대로 둔다 — 모르는 것을 만료라고 단정하지 않는다.
 */
export function invitationStatus(
  invitation: Pick<InvitationSummary, "status" | "expiresAt">,
  now: number
): InvitationStatus {
  if (invitation.status !== "pending") return invitation.status;
  const expiresAt = Date.parse(invitation.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt < now ? "expired" : "pending";
}

export interface PastInvitation {
  invitation: InvitationSummary;
  status: PastInvitationStatus;
}

/** 쓸 수 있는 초대(펼침)와 지난 초대(접음)로 나눈다. 서버 순서(최신순)를 유지한다. */
export function splitInvitations(
  invitations: readonly InvitationSummary[],
  now: number
): { pending: InvitationSummary[]; past: PastInvitation[] } {
  const pending: InvitationSummary[] = [];
  const past: PastInvitation[] = [];
  for (const invitation of invitations) {
    const status = invitationStatus(invitation, now);
    if (status === "pending") pending.push(invitation);
    else past.push({ invitation, status });
  }
  return { pending, past };
}

/** 지난 초대의 상태 칩(§3.5 — 상태는 문장 대신 칩). */
export const PAST_INVITATION_CHIP: Readonly<
  Record<PastInvitationStatus, { label: string; tone: ChipTone }>
> = {
  accepted: { label: "수락됨", tone: "ok" },
  expired: { label: "만료", tone: "neutral" },
  revoked: { label: "취소됨", tone: "neutral" },
};
