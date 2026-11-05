import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";

import {
  DEAD_INVITE_COPY,
  OTHER_ACCOUNT_COPY,
  acceptFailure,
} from "./accept-failure";

/** 서버 원문은 household.service acceptInvitation이 던지는 그대로다. */
const apiError = (status: number, serverMessage: string) =>
  new ApiError(status, "화면용 문구", null, serverMessage);

describe("초대 수락 실패 → 화면 상태", () => {
  it("이미 수락된 초대(409)는 '지금은 쓸 수 없는 초대' 화면이다", () => {
    expect(
      acceptFailure(apiError(409, "invitation has already been accepted"))
    ).toEqual({
      kind: "dead",
      message: DEAD_INVITE_COPY.accepted,
    });
  });

  it("취소·만료(410)도 같은 화면이고 사유를 구분해 말한다", () => {
    expect(acceptFailure(apiError(410, "invitation has been revoked"))).toEqual(
      {
        kind: "dead",
        message: DEAD_INVITE_COPY.revoked,
      }
    );
    expect(acceptFailure(apiError(410, "invitation has expired"))).toEqual({
      kind: "dead",
      message: DEAD_INVITE_COPY.expired,
    });
  });

  it("다른 계정 앞 초대(403)는 화면 안 문장으로 알리고 계정을 바꾸게 한다", () => {
    expect(
      acceptFailure(apiError(403, "invitation is for a different account"))
    ).toEqual({
      kind: "account",
      message: OTHER_ACCOUNT_COPY,
    });
  });

  it("없는 초대(404)는 '유효하지 않은 초대' 화면이다", () => {
    expect(acceptFailure(apiError(404, "invitation not found"))).toEqual({
      kind: "unknown",
    });
  });

  it("네트워크·서버 오류는 다시 누를 수 있는 화면 안 문장이다", () => {
    expect(acceptFailure(new TypeError("Failed to fetch"))).toEqual({
      kind: "retry",
      message: "초대를 수락하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(acceptFailure(apiError(500, "internal"))).toEqual({
      kind: "retry",
      message: "화면용 문구",
    });
  });
});
