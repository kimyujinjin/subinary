import { describe, expect, it } from "vitest";
import type { MacBankJob, MacBankRunnerState } from "@family/contracts";
import {
  nextRefreshText,
  refreshPhase,
  retryable,
  shinhanTarget,
  targetNote,
  type Target,
} from "./refresh-all-connections";

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

const target = (change: Partial<Target> = {}): Target => ({ key: "toss:1", label: "토스증권", blocked: null, step: "idle", note: null, ...change });

describe("다시 조회 시트의 단계", () => {
  it("불러오는 중·불러오기 실패·연결 없음을 구분한다", () => {
    expect(refreshPhase(null, false)).toBe("loading");
    expect(refreshPhase([], false, true)).toBe("failed");
    expect(refreshPhase([], false)).toBe("empty");
  });
  it("조회할 줄이 있으면 '조회하기', 도는 중이면 진행 표시", () => {
    expect(refreshPhase([target()], false)).toBe("ready");
    expect(refreshPhase([target({ step: "running" })], true)).toBe("running");
  });
  it("끝났거나 전부 막혔으면 채움 버튼 없이 '닫기'만 남는다(비활성 '조회를 마쳤어요' 버튼을 두지 않는다)", () => {
    expect(refreshPhase([target({ step: "done" }), target({ key: "shinhan", step: "failed" })], false)).toBe("settled");
    expect(refreshPhase([target({ blocked: "Mac이 꺼져 있어요" })], false)).toBe("settled");
  });
});

describe("다시 조회 시트의 줄", () => {
  it("실패한 줄에만 '다시 시도'를 둔다", () => {
    expect(retryable(target({ step: "failed" }))).toBe(true);
    expect(retryable(target({ step: "done" }))).toBe(false);
    expect(retryable(target({ step: "skipped", blocked: "Mac이 꺼져 있어요" }))).toBe(false);
    expect(retryable(target({ step: "failed", blocked: "Mac이 꺼져 있어요" }))).toBe(false);
  });
  it("끝난 줄은 '조회할 수 있어요' 대신 결과를 말한다", () => {
    expect(targetNote(target({ step: "done" }))).toBe("방금 새로 조회했어요");
    expect(targetNote(target({ step: "failed" }))).toBe("조회하지 못했어요");
    expect(targetNote(target({ step: "skipped", blocked: "로그인 정보가 없어요" }))).toBe("로그인 정보가 없어요");
    expect(targetNote(target())).toBe("조회할 수 있어요");
    expect(targetNote(target({ step: "running", note: "Mac에서 조회 중" }))).toBe("Mac에서 조회 중");
  });
  it("조회 간격 제한은 오늘이면 시각만, 다른 날이면 날짜와 시각으로 적는다", () => {
    const now = new Date("2026-11-05T03:00:00Z"); // 서울 낮 12시
    expect(nextRefreshText("2026-11-05T05:31:00Z", now)).toBe("오후 2:31");
    expect(nextRefreshText("2026-11-06T00:00:00Z", now)).toBe("11월 6일 오전 9:00");
  });
});
