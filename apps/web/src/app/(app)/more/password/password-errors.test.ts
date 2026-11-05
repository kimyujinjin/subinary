import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";

import { serverPasswordError, validatePasswordChange } from "./password-errors";

describe("비밀번호 변경 오류는 해당 칸 아래에 둔다", () => {
  const ok = {
    current: "old-secret-1",
    next: "new-secret-2",
    confirm: "new-secret-2",
  };

  it("문제없으면 오류가 없다", () => {
    expect(validatePasswordChange(ok)).toEqual({});
  });

  it("지금 비밀번호가 비었으면 그 칸이다", () => {
    expect(Object.keys(validatePasswordChange({ ...ok, current: "" }))).toEqual(
      ["current"]
    );
  });

  it("새 비밀번호 길이·지금과 같음은 새 비밀번호 칸이다", () => {
    expect(
      Object.keys(
        validatePasswordChange({ ...ok, next: "short", confirm: "short" })
      )
    ).toEqual(["next"]);
    expect(
      Object.keys(
        validatePasswordChange({
          ...ok,
          next: "x".repeat(201),
          confirm: "x".repeat(201),
        })
      )
    ).toEqual(["next"]);
    expect(
      Object.keys(
        validatePasswordChange({ ...ok, next: ok.current, confirm: ok.current })
      )
    ).toEqual(["next"]);
  });

  it("확인이 다르면 확인 칸이다", () => {
    expect(
      Object.keys(validatePasswordChange({ ...ok, confirm: "new-secret-3" }))
    ).toEqual(["confirm"]);
  });

  it("서버가 지금 비밀번호가 틀렸다고 하면(400) 지금 비밀번호 칸, 나머지는 버튼 위 한 줄이다", () => {
    expect(
      serverPasswordError(new ApiError(400, "지금 비밀번호가 맞지 않아요."))
    ).toEqual({
      current: "지금 비밀번호가 맞지 않아요.",
    });
    expect(
      serverPasswordError(new ApiError(503, "서버가 잠시 응답하지 않아요."))
    ).toEqual({
      form: "서버가 잠시 응답하지 않아요.",
    });
    expect(
      Object.keys(serverPasswordError(new TypeError("Failed to fetch")))
    ).toEqual(["form"]);
  });
});
