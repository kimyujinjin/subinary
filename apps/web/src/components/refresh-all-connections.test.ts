import { describe, expect, it } from "vitest";
import type { MacBankJob, MacBankRunnerState } from "@family/contracts";
import { shinhanTarget } from "./refresh-all-connections";

const job = (state: MacBankJob["state"]) => ({ id: "00000000-0000-4000-8000-000000000001", state }) as MacBankJob;
const base: MacBankRunnerState = {
  runner: { id: "00000000-0000-4000-8000-000000000004", label: "Mac", online: true, lastSeenAt: null, expiresAt: null },
  job: null, previousResult: null, credentialStorageAvailable: true,
  credentials: { stored: true, runnerId: "00000000-0000-4000-8000-000000000004", version: 1, updatedAt: "2026-11-04T00:00:00Z" },
};

describe("자산 화면 다시 조회의 신한 항목", () => {
  it("진행 중인 작업이 있으면 새 요청 대신 조회 중으로 보여 준다", () => {
    for (const state of ["queued", "claimed", "running", "reading", "logging_out"] as const)
      expect(shinhanTarget({ ...base, job: job(state) })).toMatchObject({ step: "running", blocked: null, note: "Mac에서 조회 중" });
    expect(shinhanTarget({ ...base, job: job("authentication_required") })?.note).toBe("Mac에서 은행 추가 인증이 필요해요");
  });
  it("진행 중이면 Mac이 꺼져 보여도 막지 않고 따라간다", () => {
    expect(shinhanTarget({ ...base, runner: { ...base.runner!, online: false }, job: job("running") })?.step).toBe("running");
  });
  it("끝난 작업은 간격 제한 없이 바로 다시 조회할 수 있다", () => {
    for (const state of ["succeeded", "failed", "cancelled", "expired", "operation_unknown"] as const)
      expect(shinhanTarget({ ...base, job: job(state) })).toMatchObject({ step: "idle", blocked: null });
  });
  it("Mac이 꺼져 있거나 로그인 정보가 없으면 이유를 보여 준다", () => {
    expect(shinhanTarget({ ...base, runner: { ...base.runner!, online: false } })?.blocked).toBe("Mac이 꺼져 있어요");
    expect(shinhanTarget({ ...base, credentials: null })?.blocked).toBe("로그인 정보가 없어요");
    expect(shinhanTarget({ ...base, runner: null })).toBeNull();
  });
});
