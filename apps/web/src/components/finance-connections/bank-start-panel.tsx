"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MAC_BANK_RUNNER_CONSENT_TEXT, type MacBankJob, type MacBankRunnerState } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { macBankRunnerApi } from "@/lib/mac-bank-runner-client";
import { connectionDecimal, connectionTime } from "./model";

const activeStates = new Set(["queued", "claimed", "running", "authentication_required", "reading", "logging_out"]);
const labels: Record<string, string> = { queued: "Mac에서 실행 대기", claimed: "Mac의 Codex 시작 중", running: "Mac에서 은행 접속 중",
  authentication_required: "Mac에서 은행 인증이 필요해요", reading: "통장·대출 잔액 조회 중", logging_out: "은행 로그아웃 확인 중",
  succeeded: "모아에 저장 완료", failed: "조회 미완료", operation_unknown: "실행 결과 확인 필요", cancelled: "요청 취소", expired: "요청 만료" };

/** 대기·실행·인증·저장을 구분하며 본인 조회값만 표시한다. */
export function BankMacJob({ job }: { job: MacBankJob }) {
  return <div className="space-y-3 rounded-xl border bg-card p-4" aria-label="Mac 은행 조회 상태">
    <p role="status" className="font-medium">{labels[job.state] ?? "실행 상태 확인 필요"}</p>
    {job.state === "authentication_required" ? <p className="text-sm leading-relaxed">Mac에 열린 신한은행에서 정상 로그인·추가 인증을 마친 뒤 ‘인증 완료, 계속 조회’를 눌러 주세요.</p> : null}
    {job.state === "cancelled" && !job.logoutConfirmed ? <p className="text-sm leading-relaxed">Mac의 은행 화면에서 정상 로그아웃 여부를 확인해 주세요.</p> : null}
    {job.state === "failed" || job.state === "operation_unknown" ? <p className="text-sm leading-relaxed">{job.errorCode === "operation_unknown" ? "실행 결과를 확인하지 못했어요. 다시 로그인하지 않아요. Mac의 은행 화면과 로그아웃 상태를 확인해 주세요." : "은행 조회를 완료하지 못했어요. 인증 상태와 Mac의 은행 화면을 확인해 주세요."}</p> : null}
    {job.state === "succeeded" ? <>
      <p className="text-xs text-muted-foreground">은행 로그아웃 확인 후 저장했어요. 가족 자산 합계에는 자동으로 더하지 않아요.</p>
      {job.observations.map(observation => <div key={observation.accountFingerprint} className="space-y-1 border-t pt-3">
        <p className="text-sm">{observation.pageKind === "deposit_account_list" ? "통장 잔액" : observation.loanType === "jeonse" ? "전세대출 남은 원금" : "중도금대출 남은 원금"} · 끝 {observation.accountLast4}</p>
        <p className="break-all text-xl font-semibold tabular-nums">{connectionDecimal(observation.pageKind === "deposit_account_list" ? observation.balanceKrw : observation.outstandingPrincipalKrw)}원</p>
        {observation.pageKind === "loan_account_list" ? <p className="text-sm">만기 {observation.maturityDate ?? "미확인"}</p> : null}
        <p className="text-xs text-muted-foreground">화면 확인 {connectionTime(observation.capturedAt)}</p>
      </div>)}
    </> : null}
  </div>;
}

/** 버튼 요청을 서버에 저장하고 승인한 Mac이 자동으로 받게 한다. */
export function BankStartPanel({ householdId, userId, disabled = false }: { householdId: string; userId: string; disabled?: boolean }) {
  const { authedFetch } = useAuth(); const params = useSearchParams();
  const pairId = params.get("macPair"), userCode = params.get("macCode");
  const pairing = !!pairId && /^[a-f0-9-]{36}$/.test(pairId) && !!userCode && /^[a-f0-9]{32}$/.test(userCode);
  const [data, setData] = useState<MacBankRunnerState | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false), [paired, setPaired] = useState(false);
  const mounted = useRef(false), writing = useRef(false), readController = useRef<AbortController | null>(null), writeController = useRef<AbortController | null>(null);
  const requestId = useRef<string | null>(null);
  const read = useCallback(async () => {
    if (writing.current) return;
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller;
    try {
      const result = await authedFetch(token => macBankRunnerApi.state(token, householdId, userId, controller.signal));
      if (!controller.signal.aborted && mounted.current) { setData(result); if (result.job?.id === requestId.current) { setUncertain(false); requestId.current = null; } }
    } catch {
      if (!controller.signal.aborted && mounted.current) { setData(null); setNotice("Mac 연결 상태를 확인하지 못했어요. 연결 상태를 다시 확인해 주세요."); }
    }
  }, [authedFetch, householdId, userId]);
  useEffect(() => {
    mounted.current = true; void read();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void read(); }, 5000);
    return () => { mounted.current = false; clearInterval(timer); readController.current?.abort(); writeController.current?.abort(); };
  }, [read]);
  async function write(action: "start" | "approve" | "continue" | "cancel" | "revoke"): Promise<void> {
    if (disabled || writing.current) return;
    writing.current = true; readController.current?.abort(); setBusy(true); setNotice(null);
    const controller = new AbortController(); writeController.current = controller;
    try {
      if (action === "approve" && pairId && userCode && pairing) {
        await authedFetch(token => macBankRunnerApi.approve(token, householdId, pairId, userCode, controller.signal));
        if (mounted.current && !controller.signal.aborted) { setPaired(true); setNotice("이 Mac을 연결했어요. 실행기가 연결 상태를 확인하고 있어요."); }
      } else if (action === "start") {
        requestId.current ??= crypto.randomUUID(); const id = requestId.current;
        const job = await authedFetch(token => macBankRunnerApi.start(token, householdId, userId, id, controller.signal));
        if (mounted.current && !controller.signal.aborted) { setData(value => value ? { ...value, job } : value); requestId.current = null; setUncertain(false); }
      } else if (action === "revoke" && data?.runner) {
        const id = data.runner.id; await authedFetch(token => macBankRunnerApi.revoke(token, householdId, id, controller.signal));
      } else if ((action === "continue" || action === "cancel") && data?.job) {
        const id = data.job.id;
        const job = await authedFetch(token => macBankRunnerApi.change(token, householdId, userId, id, action, controller.signal));
        if (mounted.current && !controller.signal.aborted) setData(value => value ? { ...value, job } : value);
      }
    } catch {
      if (mounted.current && !controller.signal.aborted) { if (action === "start") setUncertain(true); setNotice("요청 결과를 확인하지 못했어요. 연결 상태를 확인해 주세요. 같은 요청으로만 다시 확인해요."); }
    } finally {
      writing.current = false; if (mounted.current && !controller.signal.aborted) { setBusy(false); void read(); }
    }
  }
  const active = !!data?.job && activeStates.has(data.job.state);
  return <div className="min-w-0 space-y-3">
    <p className="text-sm leading-relaxed">모아에서 요청하면 연결한 Mac의 Codex가 신한은행에 접속해 조회하고 결과를 저장해요. Mac이 켜져 있고 실행기가 연결되어 있어야 해요.</p>
    {pairing && !paired ? <section className="space-y-3 rounded-xl border p-4" aria-label="Mac 실행기 연결 승인">
      <h3 className="font-semibold">이 Mac의 Codex 연결</h3>
      <p className="text-sm leading-relaxed">이 Mac에 7일 동안 내가 버튼으로 요청한 신한은행 조회와 본인 결과 저장을 허용해요. 은행 인증은 Mac의 정상 은행 화면에서 진행해요. 언제든 연결을 해제할 수 있어요.</p>
      <Button disabled={disabled || busy} onClick={() => { void write("approve"); }}>이 Mac 연결</Button>
    </section> : null}
    <p className="text-sm text-muted-foreground">{data?.runner ? `${data.runner.label} · ${data.runner.online ? "연결됨" : "오프라인"}` : "연결된 Mac이 없어요. Mac 실행기에서 기기 연결을 진행해 주세요."}</p>
    <p className="text-xs leading-relaxed text-muted-foreground">{MAC_BANK_RUNNER_CONSENT_TEXT}</p>
    <Button type="button" className="min-h-12 w-full" disabled={disabled || busy || active || !data?.runner?.online || uncertain}
      onClick={event => { if (event.detail <= 1) void write("start"); }}>{busy ? "요청 중…" : active ? "Mac에서 진행 중" : "신한은행 조회 시작"}</Button>
    {data?.job ? <BankMacJob job={data.job} /> : null}
    {data?.previousResult && data.job?.id !== data.previousResult.jobId ? <section className="space-y-2 rounded-xl border p-4" aria-label="이전 저장 내역">
      <h3 className="text-sm font-medium">이전 저장 내역 · {connectionTime(data.previousResult.completedAt)}</h3>
      {data.previousResult.observations.map(item => <p key={item.accountFingerprint} className="text-sm tabular-nums">
        {item.pageKind === "deposit_account_list" ? "통장 잔액" : "대출 남은 원금"} · 끝 {item.accountLast4} · {connectionDecimal(item.pageKind === "deposit_account_list" ? item.balanceKrw : item.outstandingPrincipalKrw)}원
      </p>)}
    </section> : null}
    {data?.job?.state === "authentication_required" ? <Button className="min-h-11 w-full" disabled={disabled || busy || !data.runner?.online} onClick={() => { void write("continue"); }}>인증 완료, 계속 조회</Button> : null}
    {active ? <Button variant="outline" className="min-h-11" disabled={busy || disabled} onClick={() => { void write("cancel"); }}>요청 취소</Button> : null}
    {notice ? <p role="alert" className="text-sm leading-relaxed">{notice}</p> : null}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { setNotice(null); void read(); }}>Mac 연결 상태 확인</Button>
      {uncertain ? <Button variant="outline" disabled={busy || disabled} onClick={() => { void write("start"); }}>같은 요청 결과 확인</Button> : null}
      {data?.runner ? <Button variant="ghost" disabled={busy || disabled} onClick={() => { void write("revoke"); }}>Mac 연결 해제</Button> : null}
    </div>
  </div>;
}
