"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  MAC_BANK_RUNNER_CONSENT_TEXT,
  type MacBankJob,
  type MacBankRunnerState,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/widgets/bottom-sheet";
import { OverflowMenu, type OverflowAction } from "@/components/widgets/overflow-menu";
import { StatusChip } from "@/components/widgets/status-chip";
import { useAuth } from "@/lib/auth-context";
import { macBankRunnerApi } from "@/lib/mac-bank-runner-client";
import { connectionDecimal, connectionTime } from "./model";
import { BankCredentialForm } from "./bank-credential-form";

const READ_FAILED = "Mac 상태를 불러오지 못했어요. 잠시 후 자동으로 다시 확인해요.";
const activeStates = new Set([
  "queued",
  "claimed",
  "running",
  "authentication_required",
  "reading",
  "logging_out",
]);
/** "Codex"·"실행기"는 제품 안에서 설명되지 않는 내부 용어라 사용자 문구에 쓰지 않는다
 *  (docs/ux-renewal-2026-11.md §3.5) — 사용자에게는 "Mac"이라고만 말한다. Mac은 사용자 본인의 기기이므로 남긴다
 *  (켜져 있어야 조회가 된다는 전제를 숨기면 실패 원인을 알 수 없다). */
const labels: Record<string, string> = {
  queued: "Mac에서 실행 대기",
  claimed: "Mac에서 시작하는 중",
  running: "Mac에서 은행 접속 중",
  authentication_required: "Mac에서 은행 인증이 필요해요",
  reading: "통장·대출 잔액 조회 중",
  logging_out: "은행 로그아웃 확인 중",
  succeeded: "모아에 저장 완료",
  failed: "조회 미완료",
  operation_unknown: "실행 결과 확인 필요",
  cancelled: "요청 취소",
  expired: "요청 만료",
};

const failedStates = new Set(["failed", "operation_unknown", "cancelled", "expired"]);

/** 대기·실행·인증·저장을 구분하며 본인 조회값만 표시한다. */
export function BankMacJob({ job }: { job: MacBankJob }) {
  const tone = job.state === "succeeded" ? "ok" : failedStates.has(job.state) ? "error" : job.state === "authentication_required" ? "attention" : "pending";
  return (
    <section className="finance-panel min-w-0 px-5 py-4" aria-label="Mac 은행 조회 상태">
      <p role="status" className="flex flex-wrap items-center gap-2">
        <StatusChip tone={tone}>{labels[job.state] ?? "실행 상태 확인 필요"}</StatusChip>
        {job.completedAt ? <span className="text-caption text-muted-foreground">{connectionTime(job.completedAt)}</span> : null}
      </p>
      {job.state === "authentication_required" ? (
        <p className="text-body mt-2">
          은행이 추가 인증을 요구했어요. Mac의 신한은행 화면에서 인증을 마친 뒤 ‘인증 완료, 계속 조회’를 눌러 주세요.
        </p>
      ) : null}
      {job.state === "cancelled" && !job.logoutConfirmed ? (
        <p className="text-caption text-muted-foreground mt-2">Mac의 은행 화면에서 로그아웃됐는지 확인해 주세요.</p>
      ) : null}
      {job.state === "failed" || job.state === "operation_unknown" ? (
        <p className="text-caption text-muted-foreground mt-2">
          {job.errorCode === "operation_unknown"
            ? "실행 결과를 확인하지 못했어요. 다시 로그인하지 않아요. Mac의 은행 화면과 로그아웃 상태를 확인해 주세요."
            : "은행 조회를 마치지 못했어요. Mac의 은행 화면과 인증 상태를 확인해 주세요."}
        </p>
      ) : null}
      {job.state === "succeeded" ? (
        <>
          <p className="text-caption text-muted-foreground mt-2">가족 자산 합계에는 자동으로 더하지 않아요.</p>
          <div className="divide-y divide-border/60">
            {job.observations.map((observation) => (
              <ObservationRow key={observation.accountFingerprint} observation={observation} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** 버튼 요청을 서버에 저장하고 승인한 Mac이 자동으로 받게 한다. */
export function BankStartPanel({
  householdId,
  userId,
  disabled = false,
}: {
  householdId: string;
  userId: string;
  disabled?: boolean;
}) {
  const { authedFetch } = useAuth();
  const params = useSearchParams();
  const pairId = params.get("macPair"),
    userCode = params.get("macCode");
  const pairing =
    !!pairId &&
    /^[a-f0-9-]{36}$/.test(pairId) &&
    !!userCode &&
    /^[a-f0-9]{32}$/.test(userCode);
  const [data, setData] = useState<MacBankRunnerState | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false),
    [paired, setPaired] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false),
    [revokeOpen, setRevokeOpen] = useState(false);
  const mounted = useRef(false),
    writing = useRef(false),
    readController = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null);
  const requestId = useRef<string | null>(null);
  const read = useCallback(async () => {
    if (writing.current) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    try {
      const result = await authedFetch((token) =>
        macBankRunnerApi.state(token, householdId, userId, controller.signal)
      );
      if (!controller.signal.aborted && mounted.current) {
        setData(result);
        setNotice((value) => (value === READ_FAILED ? null : value));
        if (result.job?.id === requestId.current) {
          setUncertain(false);
          requestId.current = null;
        }
      }
    } catch {
      if (!controller.signal.aborted && mounted.current) {
        setData(null);
        setNotice(READ_FAILED);
      }
    }
  }, [authedFetch, householdId, userId]);
  useEffect(() => {
    mounted.current = true;
    void read();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 5000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      readController.current?.abort();
      writeController.current?.abort();
    };
  }, [read]);
  async function write(
    action: "start" | "approve" | "continue" | "cancel" | "revoke"
  ): Promise<void> {
    if (disabled || writing.current) return;
    writing.current = true;
    readController.current?.abort();
    setBusy(true);
    setNotice(null);
    const controller = new AbortController();
    writeController.current = controller;
    try {
      if (action === "approve" && pairId && userCode && pairing) {
        await authedFetch((token) =>
          macBankRunnerApi.approve(
            token,
            householdId,
            pairId,
            userCode,
            controller.signal
          )
        );
        if (mounted.current && !controller.signal.aborted) {
          setPaired(true);
          setNotice(
            "이 Mac을 연결했어요."
          );
        }
      } else if (action === "start") {
        requestId.current ??= crypto.randomUUID();
        const id = requestId.current;
        const job = await authedFetch((token) =>
          macBankRunnerApi.start(
            token,
            householdId,
            userId,
            id,
            controller.signal
          )
        );
        if (mounted.current && !controller.signal.aborted) {
          setData((value) => (value ? { ...value, job } : value));
          requestId.current = null;
          setUncertain(false);
        }
      } else if (action === "revoke" && data?.runner) {
        const id = data.runner.id;
        await authedFetch((token) =>
          macBankRunnerApi.revoke(token, householdId, id, controller.signal)
        );
      } else if ((action === "continue" || action === "cancel") && data?.job) {
        const id = data.job.id;
        const job = await authedFetch((token) =>
          macBankRunnerApi.change(
            token,
            householdId,
            userId,
            id,
            action,
            controller.signal
          )
        );
        if (mounted.current && !controller.signal.aborted)
          setData((value) => (value ? { ...value, job } : value));
      }
    } catch {
      if (mounted.current && !controller.signal.aborted) {
        if (action === "start") setUncertain(true);
        setNotice(
          "요청 결과를 확인하지 못했어요. 아래 ‘같은 요청 결과 확인’으로 다시 확인해 주세요."
        );
      }
    } finally {
      writing.current = false;
      if (mounted.current && !controller.signal.aborted) {
        setBusy(false);
        void read();
      }
    }
  }
  const active = !!data?.job && activeStates.has(data.job.state);
  const runner = data?.runner ?? null;
  const stored = !!data?.credentials?.stored;
  const authRequired = data?.job?.state === "authentication_required";
  const lastRun = data?.job?.state === "succeeded" ? data.job.completedAt : data?.previousResult?.completedAt ?? null;
  const startDisabled = disabled || busy || active || !runner?.online || !stored || uncertain;
  const menu: OverflowAction[] = runner
    ? [
        { label: stored ? "로그인 정보 변경" : "로그인 정보 입력", onSelect: () => setCredentialOpen(true), disabled: disabled || active },
        { label: "Mac 연결 해제", onSelect: () => setRevokeOpen(true), destructive: true, disabled: busy || disabled },
      ]
    : [];
  return (
    <div className="min-w-0 space-y-5">
      {pairing && !paired ? (
        <section className="finance-panel space-y-3 p-5" aria-label="Mac 연결 승인">
          <h3 className="text-heading">이 Mac 연결</h3>
          <p className="text-caption text-muted-foreground">
            연결을 해제할 때까지 이 Mac에서 내가 요청한 신한은행 조회를 허용해요. 모아에서 언제든 연결을 해제할 수 있어요.
          </p>
          <Button className="w-full" disabled={disabled || busy} onClick={() => { void write("approve"); }}>
            연결 해제 전까지 허용
          </Button>
        </section>
      ) : null}
      {data && !runner ? (
        <section className="finance-panel p-5" aria-label="Mac 연결 상태">
          <p className="text-heading">연결된 Mac이 없어요</p>
          <p className="text-caption text-muted-foreground mt-1">Mac에서 모아 연결을 먼저 진행해 주세요.</p>
        </section>
      ) : null}
      {runner ? (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <p className="text-caption text-muted-foreground flex min-w-0 flex-wrap items-center gap-2">
            <StatusChip tone={runner.online ? "ok" : "attention"}>{runner.online ? "Mac 연결됨" : "Mac 꺼짐"}</StatusChip>
            <span>마지막 조회 {lastRun ? connectionTime(lastRun) : "없음"}</span>
            {runner.expiresAt !== null ? <span>· 허용 기한 {connectionTime(runner.expiresAt)}</span> : null}
          </p>
          <OverflowMenu actions={menu} label="신한 연결 메뉴" />
        </div>
      ) : null}
      {data?.job ? <BankMacJob job={data.job} /> : null}
      {data?.previousResult && data.job?.id !== data.previousResult.jobId ? (
        <section className="finance-panel divide-y divide-border/60 px-5" aria-label="이전 저장 내역">
          {data.previousResult.observations.map((item) => (
            <ObservationRow key={item.accountFingerprint} observation={item} />
          ))}
        </section>
      ) : null}
      {notice ? <p role="alert" className="text-caption text-muted-foreground">{notice}</p> : null}
      {!data || runner ? (
        <div className="space-y-2">
          {authRequired ? (
            <Button size="lg" className="w-full" disabled={disabled || busy || !runner?.online} onClick={() => { void write("continue"); }}>
              인증 완료, 계속 조회
            </Button>
          ) : runner && !stored ? (
            <Button size="lg" className="w-full" disabled={disabled || busy} onClick={() => setCredentialOpen(true)}>
              로그인 정보 입력
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={startDisabled}
              onClick={(event) => { if (event.detail <= 1) void write("start"); }}
            >
              {busy ? "요청 중…" : active ? "Mac에서 조회 중…" : "지금 조회하기"}
            </Button>
          )}
          {active ? (
            <Button variant="ghost" className="w-full" disabled={busy || disabled} onClick={() => { void write("cancel"); }}>
              요청 취소
            </Button>
          ) : null}
          {uncertain ? (
            <Button variant="weak" className="w-full" disabled={busy || disabled} onClick={() => { void write("start"); }}>
              같은 요청 결과 확인
            </Button>
          ) : null}
          {runner && !runner.online && !active ? (
            <p className="text-caption text-muted-foreground text-center">Mac을 켜면 조회할 수 있어요.</p>
          ) : null}
          <details className="text-caption text-muted-foreground">
            <summary className="min-h-11 cursor-pointer py-3 text-center">조회하면 동의하는 내용</summary>
            <p className="pb-2">{MAC_BANK_RUNNER_CONSENT_TEXT}</p>
          </details>
        </div>
      ) : null}
      {runner ? (
        <BottomSheet open={credentialOpen} onOpenChange={setCredentialOpen} title="신한은행 로그인 정보">
          <BankCredentialForm
            key={runner.id}
            householdId={householdId}
            runnerId={runner.id}
            credentials={data?.credentials ?? null}
            storageAvailable={!!data?.credentialStorageAvailable}
            disabled={disabled || busy || active}
            onChanged={() => { void read(); }}
          />
        </BottomSheet>
      ) : null}
      <BottomSheet open={revokeOpen} onOpenChange={setRevokeOpen} title="Mac 연결을 해제할까요?">
        <p className="text-body text-muted-foreground pb-3">
          저장한 로그인 정보도 함께 폐기돼요. 다시 쓰려면 Mac에서 기기 연결을 새로 해야 해요.
        </p>
        <Button
          variant="destructive"
          size="lg"
          className="w-full"
          disabled={busy || disabled}
          onClick={() => { setRevokeOpen(false); void write("revoke"); }}
        >
          연결 해제
        </Button>
      </BottomSheet>
    </div>
  );
}

function ObservationRow({ observation }: { observation: MacBankJob["observations"][number] }) {
  const deposit = observation.pageKind === "deposit_account_list";
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <p className="text-body font-semibold">
          {deposit ? "통장 잔액" : observation.loanType === "jeonse" ? "전세대출 남은 원금" : "중도금대출 남은 원금"}
        </p>
        <p className="text-caption text-muted-foreground">
          끝 {observation.accountLast4}
          {!deposit ? ` · 만기 ${observation.maturityDate ?? "미확인"}` : ""}
        </p>
      </div>
      <p className="text-heading min-w-0 break-all text-right tabular-nums">
        {connectionDecimal(deposit ? observation.balanceKrw : observation.outstandingPrincipalKrw)}원
      </p>
    </div>
  );
}
