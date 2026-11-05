import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { isRetriableFailure, retryWithRefresh } from "./session-failure";

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

describe("401 갱신 후 재시도", () => {
  const unauthorized = () => new ApiError(401, "invalid credentials");

  it("갱신이 성공한 뒤의 재시도 실패는 그 요청의 거절이다 — 로그아웃하지 않는다(틀린 현재 비밀번호)", async () => {
    let dead = 0;
    const run = async () => {
      throw new ApiError(400, "지금 비밀번호가 맞지 않아요.");
    };
    // 첫 호출은 401(만료), 갱신 후 두 번째는 401이 아닌 거절 — 예전 서버 동작(401→401)도 같이 본다.
    let calls = 0;
    const flaky = async (token: string) => {
      calls += 1;
      if (calls === 1) throw unauthorized();
      return run();
    };
    await expect(retryWithRefresh(flaky, "old", async () => "new", () => { dead += 1; })).rejects.toThrow("지금 비밀번호");
    const twice401 = async () => { throw unauthorized(); };
    await expect(retryWithRefresh(twice401, "old", async () => "new", () => { dead += 1; })).rejects.toBeInstanceOf(ApiError);
    expect(dead).toBe(0);
  });

  it("갱신 자체가 401이면 세션이 끝났다 — 로그아웃한다. 네트워크·5xx는 이 요청만 실패시킨다", async () => {
    let dead = 0;
    const expired = async () => { throw unauthorized(); };
    await expect(retryWithRefresh(expired, "old", async () => { throw unauthorized(); }, () => { dead += 1; })).rejects.toBeInstanceOf(ApiError);
    expect(dead).toBe(1);
    await expect(retryWithRefresh(expired, "old", async () => { throw new ApiError(502, "bad gateway"); }, () => { dead += 1; })).rejects.toBeInstanceOf(ApiError);
    await expect(retryWithRefresh(expired, "old", async () => { throw new TypeError("Failed to fetch"); }, () => { dead += 1; })).rejects.toBeInstanceOf(TypeError);
    expect(dead).toBe(1);
  });

  it("갱신한 토큰으로 다시 실행하고, 401이 아닌 오류는 갱신 없이 그대로 던진다", async () => {
    const tokens: string[] = [];
    let first = true;
    const run = async (token: string) => {
      tokens.push(token);
      if (first) { first = false; throw unauthorized(); }
      return "ok";
    };
    await expect(retryWithRefresh(run, "old", async () => "new", () => undefined)).resolves.toBe("ok");
    expect(tokens).toEqual(["old", "new"]);
    let refreshed = false;
    await expect(retryWithRefresh(async () => { throw new ApiError(404, "x"); }, "t", async () => { refreshed = true; return "n"; }, () => undefined)).rejects.toBeInstanceOf(ApiError);
    expect(refreshed).toBe(false);
  });
});
