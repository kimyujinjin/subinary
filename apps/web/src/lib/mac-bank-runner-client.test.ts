import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccessToken } from "./api-client";
import { macBankRunnerApi } from "./mac-bank-runner-client";

const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./api-client", () => ({ apiFetch: mock.fetch }));
afterEach(() => { mock.fetch.mockReset(); });
const token = "synthetic-test-token" as AccessToken;
const home = "00000000-0000-4000-8000-000000000001", user = "00000000-0000-4000-8000-000000000002", runner = "00000000-0000-4000-8000-000000000003";

describe("Mac 연결의 명시적인 지속 허용", () => {
  it("연결 승인에는 until_revoked를 명시해 구형 7일 기본값과 구분한다", async () => {
    mock.fetch.mockResolvedValue(undefined);
    await macBankRunnerApi.approve(token, home, runner, "a".repeat(32));
    expect(mock.fetch).toHaveBeenCalledWith("/v1/mac-bank-runner/approve", expect.objectContaining({
      body: { householdId: home, pairId: runner, userCode: "a".repeat(32), grantMode: "until_revoked" },
    }));
  });
  it("만료 없는 연결을 읽되 관측하지 않은 잔액을 만들지 않는다", async () => {
    mock.fetch.mockResolvedValue({ runner: { id: runner, label: "합성 Mac", online: true, lastSeenAt: "2026-11-03T00:00:00Z", expiresAt: null }, job: null, previousResult: null });
    const state = await macBankRunnerApi.state(token, home, user);
    expect(state.runner?.expiresAt).toBeNull(); expect(state.job).toBeNull(); expect(state.previousResult).toBeNull();
  });
  it("실패한 승인은 성공으로 바꾸거나 자동 재요청하지 않는다", async () => {
    mock.fetch.mockRejectedValue(new Error("synthetic_failure"));
    await expect(macBankRunnerApi.approve(token, home, runner, "a".repeat(32))).rejects.toThrow("synthetic_failure");
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
});
