"use client";
import { macBankJobSchema, macBankRunnerStateSchema, type MacBankJob } from "@family/contracts";
import { apiFetch, type AccessToken } from "./api-client";
const base = "/v1/mac-bank-runner";

/** 다른 사용자의 결과를 화면에 표시하지 않는다. */
function own(job: MacBankJob | null, householdId: string, userId: string, id?: string): void {
  if (job && (job.householdId !== householdId || job.ownerUserId !== userId || (id && job.id !== id))) throw new Error("실행 요청의 소유자를 확인하지 못했어요.");
}
/** 모아 세션은 요청·취소만 전송하며 Mac의 키나 ChatGPT 토큰을 받지 않는다. */
export const macBankRunnerApi = {
  async state(token: AccessToken, householdId: string, userId: string, signal?: AbortSignal) {
    const result = macBankRunnerStateSchema.parse(await apiFetch(`${base}/state?${new URLSearchParams({ householdId })}`, { accessToken: token, signal }));
    signal?.throwIfAborted(); own(result.job, householdId, userId); return result;
  },
  async approve(token: AccessToken, householdId: string, pairId: string, userCode: string, signal?: AbortSignal) {
    await apiFetch(`${base}/approve`, { accessToken: token, method: "POST", body: { householdId, pairId, userCode }, signal }); signal?.throwIfAborted();
  },
  async start(token: AccessToken, householdId: string, userId: string, requestId: string, signal?: AbortSignal) {
    const result = macBankJobSchema.parse(await apiFetch(`${base}/jobs`, { accessToken: token, method: "POST", body: { householdId, requestId }, signal }));
    signal?.throwIfAborted(); own(result, householdId, userId, requestId); return result;
  },
  async change(token: AccessToken, householdId: string, userId: string, id: string, action: "continue" | "cancel", signal?: AbortSignal) {
    const result = macBankJobSchema.parse(await apiFetch(`${base}/jobs/${encodeURIComponent(id)}/${action}`, { accessToken: token, method: "POST", body: { householdId }, signal }));
    signal?.throwIfAborted(); own(result, householdId, userId, id); return result;
  },
  async revoke(token: AccessToken, householdId: string, id: string, signal?: AbortSignal) {
    await apiFetch(`${base}/runner/${encodeURIComponent(id)}?${new URLSearchParams({ householdId })}`, { accessToken: token, method: "DELETE", signal }); signal?.throwIfAborted();
  },
};
