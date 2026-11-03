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

describe("은행 로그인 정보 전송 경계", () => {
  const input = { householdId: home, runnerId: runner, loginId: "synthetic-id", password: "synthetic-password", consentVersion: 1, expectedVersion: null };
  const state = { stored: true, runnerId: runner, version: 1, updatedAt: "2026-11-03T00:00:00Z" };
  it("별도 동의를 받은 본인 Mac의 저장 요청만 전송하고 비밀번호를 응답으로 받지 않는다", async () => {
    mock.fetch.mockResolvedValue(state);
    expect(await macBankRunnerApi.saveCredentials(token, input)).toEqual(state);
    expect(mock.fetch).toHaveBeenCalledWith("/v1/mac-bank-runner/credentials", expect.objectContaining({ method: "POST", body: input }));
  });
  it("동의 누락과 비어 있는 입력은 네트워크 전송 전에 거부한다", async () => {
    for (const invalid of [{ ...input, consentVersion: undefined }, { ...input, password: "" }, { ...input, loginId: "\n" }]) {
      await expect(macBankRunnerApi.saveCredentials(token, invalid)).rejects.toThrow();
    }
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("다른 Mac의 응답이나 평문을 섞은 응답을 성공으로 처리하지 않는다", async () => {
    for (const response of [{ ...state, runnerId: user }, { ...state, password: input.password }]) {
      mock.fetch.mockResolvedValue(response);
      await expect(macBankRunnerApi.saveCredentials(token, input)).rejects.toThrow();
    }
  });
  it("저장 응답 유실은 비밀번호를 자동 재전송하지 않는다", async () => {
    mock.fetch.mockRejectedValue(new Error("synthetic-network-failure"));
    await expect(macBankRunnerApi.saveCredentials(token, input)).rejects.toThrow();
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it("삭제에는 화면에서 확인한 버전이 필요하다", async () => {
    mock.fetch.mockResolvedValue({ ...state, stored: false, version: 2 });
    await macBankRunnerApi.deleteCredentials(token, { householdId: home, runnerId: runner, expectedVersion: 1 });
    expect(mock.fetch).toHaveBeenCalledWith("/v1/mac-bank-runner/credentials", expect.objectContaining({ method: "DELETE", body: { householdId: home, runnerId: runner, expectedVersion: 1 } }));
  });
});
