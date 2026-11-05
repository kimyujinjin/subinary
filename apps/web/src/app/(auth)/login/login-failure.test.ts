import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";

import { biometricCopyFor } from "./biometric-copy";
import { loginFailure } from "./login-failure";

describe("로그인 실패 자리", () => {
  it("이메일·비밀번호가 틀린 경우(401)만 비밀번호 칸 아래에 둔다", () => {
    const failure = loginFailure(
      new ApiError(
        401,
        "이메일 또는 비밀번호가 맞지 않아요.",
        null,
        "invalid credentials"
      )
    );
    expect(failure).toEqual({
      field: true,
      message: "이메일 또는 비밀번호가 맞지 않아요.",
    });
  });

  it("요청 과다(429)·서버 오류는 비밀번호와 무관하니 폼 위 알림이다", () => {
    expect(
      loginFailure(
        new ApiError(429, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")
      ).field
    ).toBe(false);
    expect(
      loginFailure(new ApiError(503, "서버가 잠시 응답하지 않아요.")).field
    ).toBe(false);
  });

  it("서버에 닿지 못한 실패(fetch TypeError)는 인터넷 연결을 확인하라고 폼 위에 알린다", () => {
    const failure = loginFailure(new TypeError("Failed to fetch"));
    expect(failure.field).toBe(false);
    expect(failure.message).toContain("인터넷 연결");
    // 영문 원문은 화면에 내보내지 않는다.
    expect(failure.message).not.toContain("Failed to fetch");
  });

  it("알 수 없는 실패도 폼 위 해요체 한 줄이다", () => {
    const failure = loginFailure(new Error("boom"));
    expect(failure).toEqual({
      field: false,
      message: "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  });
});

describe("생체 인식 이름은 기기별로 부른다", () => {
  it("안드로이드에는 'Face ID'라고 쓰지 않는다", () => {
    const copy = biometricCopyFor("android");
    expect(copy).toEqual({ name: "지문·얼굴 인식", by: "지문·얼굴 인식으로" });
    expect(`${copy.name}${copy.by}`).not.toContain("Face ID");
  });

  it("아이폰은 Face ID, 그 밖(웹)은 일반 이름이다", () => {
    expect(biometricCopyFor("ios")).toEqual({
      name: "Face ID",
      by: "Face ID로",
    });
    expect(biometricCopyFor("web")).toEqual({
      name: "생체인식",
      by: "생체인식으로",
    });
  });
});
