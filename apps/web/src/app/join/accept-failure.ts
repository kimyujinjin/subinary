/**
 * 초대 수락 실패를 화면 상태로 바꾼다.
 *
 * 예전에는 모든 실패가 잠깐 뜨는 토스트였다. 이미 처리됐거나 만료된 초대(409·410)도 토스트뿐이라 수락 버튼이
 * 그대로 남았고, 다른 계정 앞 초대(403)는 계정을 바꿀 길 없이 끝났다(2026-11-05 HIG 검수).
 * 서버 의미(household.service acceptInvitation): 없음 404 · 수락됨 409 · 취소·만료 410 · 이메일 불일치 403.
 */
import type { InvitationPreview } from "@family/contracts";

import { ApiError } from "@/lib/api-client";

/** 더 이상 쓸 수 없는 초대의 상태별 안내(서버가 가족 정보를 주지 않는 상태들). */
export const DEAD_INVITE_COPY: Record<
  Exclude<InvitationPreview["status"], "pending">,
  string
> = {
  accepted: "이미 수락된 초대예요. 초대한 가족에게 다시 물어봐 주세요.",
  revoked: "취소된 초대예요. 초대한 가족에게 링크를 다시 받아 주세요.",
  expired: "만료된 초대예요. 초대한 가족에게 링크를 다시 받아 주세요.",
};

export const OTHER_ACCOUNT_COPY =
  "다른 계정 앞으로 보낸 초대예요. 초대받은 이메일의 계정으로 로그인해 주세요.";

export type AcceptFailure =
  /** 없는 초대 — '유효하지 않은 초대' 화면. */
  | { kind: "unknown" }
  /** 수락·취소·만료 — '지금은 쓸 수 없는 초대' 화면(수락 버튼 없음). */
  | { kind: "dead"; message: string }
  /** 다른 계정 앞 초대 — 화면 안 문장 + '다른 계정으로 로그인하기'. */
  | { kind: "account"; message: string }
  /** 그 밖(네트워크·서버) — 화면 안 문장, 다시 누를 수 있다. */
  | { kind: "retry"; message: string };

export function acceptFailure(err: unknown): AcceptFailure {
  if (!(err instanceof ApiError)) {
    return {
      kind: "retry",
      message: "초대를 수락하지 못했어요. 잠시 후 다시 시도해 주세요.",
    };
  }
  if (err.status === 404) return { kind: "unknown" };
  if (err.status === 409) return { kind: "dead", message: DEAD_INVITE_COPY.accepted };
  if (err.status === 410) {
    return {
      kind: "dead",
      message:
        err.serverMessage === "invitation has been revoked"
          ? DEAD_INVITE_COPY.revoked
          : DEAD_INVITE_COPY.expired,
    };
  }
  if (err.status === 403 && err.serverMessage === "invitation is for a different account") {
    return { kind: "account", message: OTHER_ACCOUNT_COPY };
  }
  return { kind: "retry", message: err.message };
}
