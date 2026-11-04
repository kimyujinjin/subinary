import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { isRetriableFailure } from "./session-failure";

describe("토큰 갱신 실패 분류", () => {
  it("세션이 끝난 응답만 로그아웃 대상이다", () => {
    for (const status of [401, 400, 403, 404]) expect(isRetriableFailure(new ApiError(status, "x"))).toBe(false);
  });
  it("응답이 없거나 서버·프록시 사정이면 세션을 유지한다", () => {
    for (const status of [500, 502, 503, 504, 429]) expect(isRetriableFailure(new ApiError(status, "x"))).toBe(true);
    expect(isRetriableFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetriableFailure(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isRetriableFailure(new Error("보안 저장소의 refresh 토큰 쓰기 검증에 실패했습니다."))).toBe(true);
  });
});
