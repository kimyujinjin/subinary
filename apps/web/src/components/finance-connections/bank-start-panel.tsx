"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
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

const READ_FAILED = "Mac 상태를 불러오지 못해 잠시 뒤 다시 확인해요.";
/** 결과를 모르는 조회 요청. 같은 요청 번호로 다시 보내므로 다시 눌러도 된다(write의 start 참고). */
const START_UNCERTAIN = "요청이 전달됐는지 확인하지 못했지만, 다시 눌러도 한 번만 조회해요.";
const WRITE_FAILED: Record<"approve" | "continue" | "cancel" | "revoke", string> = {
  approve: "Mac 연결을 승인하지 못했어요.",
  continue: "계속 조회를 요청하지 못했어요.",
  cancel: "요청을 취소하지 못했어요.",
  revoke: "Mac 연결을 해제하지 못했어요.",
};
/** Mac이 맡고 있는 작업 상태. 이 동안에는 새 조회를 보내지 않는다(서버도 한 사람당 하나만 받는다). */
export const MAC_JOB_ACTIVE_STATES: ReadonlySet<MacBankJob["state"]> = new Set<MacBankJob["state"]>([
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
/** Mac 조회 실패를 종류별로 알린다. 로그인 실패·시간 초과·화면 변경은 사용자가 할 일이 다르다. */
const failedReasons: Partial<Record<NonNullable<MacBankJob["errorCode"]>, string>> = {
  credentials_invalid: "은행이 아이디나 비밀번호가 맞지 않다고 했어요. 계정 잠금을 막으려고 다시 시도하지 않았어요. 로그인 정보를 확인해 주세요.",
  timeout: "은행 화면이 제때 응답하지 않아 멈췄어요. 다시 로그인하지 않았어요. 잠시 뒤 다시 조회해 주세요.",
  unsupported_layout: "은행 화면 구성이 달라져 읽지 못했어요. 이전 금액은 바뀌지 않았어요.",
  network_error: "Mac에서 은행 화면을 열지 못했어요. Mac이 켜져 있는지 확인해 주세요.",
  runtime_unavailable: "Mac에서 은행 화면을 열지 못했어요. Mac이 켜져 있는지 확인해 주세요.",
  operation_unknown: "실행 결과를 확인하지 못했어요. 다시 로그인하지 않아요. Mac의 은행 화면과 로그아웃 상태를 확인해 주세요.",
};

/** 처음 연결 안내의 한 단계. */
export interface FirstConnectionStep {
  label: string;
  /** 지금 할 단계일 때만 보이는 한 문장. */
  detail: string;
  done: boolean;
}

/**
 * 처음 연결 3단계(§5 자동 연결: 1) Mac 연결 2) 로그인 정보 3) 첫 조회). 모두 끝났으면 null — 안내를 그리지 않는다.
 *
 * 예전에는 Mac이 없으면 "Mac에서 모아 연결을 먼저 진행해 주세요" 한 줄만 있어 다음에 무엇을 하는지 알 수 없었다.
 * 판정은 서버 상태(`GET /v1/mac-bank-runner/state`)만 쓴다: 승인한 Mac, 저장한 로그인 정보, 성공한 조회.
 */
export function firstConnectionSteps(state: MacBankRunnerState): FirstConnectionStep[] | null {
  const steps: FirstConnectionStep[] = [
    { label: "Mac 연결", detail: "Mac에서 모아 연결을 시작한 뒤 나오는 링크를 열어 허용해 주세요.", done: state.runner !== null },
    { label: "로그인 정보", detail: "신한은행 아이디와 비밀번호를 암호화해 저장해요.", done: state.runner !== null && !!state.credentials?.stored },
    { label: "첫 조회", detail: "Mac이 켜져 있을 때 ‘지금 조회하기’를 누르면 잔액을 가져와요.", done: state.job?.state === "succeeded" || state.previousResult !== null },
  ];
  return steps.every((step) => step.done) ? null : steps;
}

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
          은행이 추가 인증을 요구했어요. Mac에서 신한은행에 직접 로그인해 인증을 마친 뒤 ‘인증 완료, 계속 조회’를 눌러 주세요. 그 화면에서 이어서 조회하고 로그아웃해요.
        </p>
      ) : null}
      {job.state === "cancelled" && !job.logoutConfirmed ? (
        <p className="text-caption text-muted-foreground mt-2">Mac의 은행 화면에서 로그아웃됐는지 확인해 주세요.</p>
      ) : null}
      {job.state === "failed" || job.state === "operation_unknown" ? (
        <p className="text-caption text-muted-foreground mt-2">
          {(job.errorCode && failedReasons[job.errorCode]) ?? "은행 조회를 마치지 못했어요. Mac의 은행 화면과 인증 상태를 확인해 주세요."}
        </p>
      ) : null}
      {job.state === "succeeded" ? (
        <>
          <p className="text-caption text-muted-foreground mt-2">자산 합계에 반영돼요. 가족과 공유하면 가족 합계에도 들어가요.</p>
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

/**
 * 버튼 요청을 서버에 저장하고 승인한 Mac이 자동으로 받게 한다.
 *
 * 밖에서 비활성화하지 않는다 — 예전에는 옛 은행 연결 목록을 60초마다 다시 읽는 동안 이 패널 전체를 막아
 * 로그인 정보 입력칸의 포커스와 키보드가 1분마다 빠졌다. 진행 중 표시는 이 패널의 요청(busy)과 Mac 작업만 따른다.
 */
export function BankStartPanel({
  householdId,
  userId,
}: {
  householdId: string;
  userId: string;
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
  const [paired, setPaired] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false),
    [revokeOpen, setRevokeOpen] = useState(false);
  const mounted = useRef(false),
    writing = useRef(false),
    readController = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null);
  /** 결과를 확인하지 못한 조회 요청 번호. 서버에서 그 작업이 보이거나 응답을 받으면 비운다. */
  const requestId = useRef<string | null>(null);
  /**
   * 로그인 정보 시트가 떠 있는 동안에는 5초 확인을 쉰다 — 확인이 한 번 실패하면 시트가 사라져 입력이 지워진다.
   * Mac이 목록에서 사라져 시트가 내려간 뒤에는 다시 확인한다(멈춘 채 남지 않게).
   */
  const credentialSheet = useRef(false);
  const sheetShown = credentialOpen && !!data?.runner;
  useEffect(() => {
    credentialSheet.current = sheetShown;
  }, [sheetShown]);
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
        const confirmed = requestId.current !== null && result.job?.id === requestId.current;
        if (confirmed) requestId.current = null;
        setNotice((value) => (value === READ_FAILED || (confirmed && value === START_UNCERTAIN) ? null : value));
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
      if (document.visibilityState === "visible" && !credentialSheet.current) void read();
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
    if (writing.current) return;
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
          setNotice("이 Mac을 연결했어요.");
        }
      } else if (action === "start") {
        // 결과를 모르는 요청은 같은 요청 번호로 다시 보낸다. 서버는 같은 번호를 다시 실행하지 않고 그 작업을
        // 돌려주므로(mac-bank-runner.service.ts enqueue) '지금 조회하기'를 다시 눌러도 은행에 두 번 로그인하지 않는다.
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
      if (mounted.current && !controller.signal.aborted)
        setNotice(action === "start" ? START_UNCERTAIN : WRITE_FAILED[action]);
    } finally {
      writing.current = false;
      if (mounted.current && !controller.signal.aborted) {
        // 결과를 다시 읽은 뒤에 진행 표시를 푼다 — 승인·해제 직후 이전 상태가 잠깐 보이지 않게.
        void read().finally(() => {
          if (mounted.current) setBusy(false);
        });
      }
    }
  }
  const active = !!data?.job && MAC_JOB_ACTIVE_STATES.has(data.job.state);
  const runner = data?.runner ?? null;
  const stored = !!data?.credentials?.stored;
  const authRequired = data?.job?.state === "authentication_required";
  const lastRun = data?.job?.state === "succeeded" ? data.job.completedAt : data?.previousResult?.completedAt ?? null;
  // 승인 화면이 떠 있는 동안에는 'Mac 없음' 안내를 함께 그리지 않는다. 다시 연 승인 링크는 이미 연결된 Mac이면 숨긴다.
  const approving = pairing && !paired && runner?.id !== pairId;
  // 승인 직후 Mac 상태를 다시 읽는 동안(busy·Mac 없음)에도 안내를 그리지 않는다 — '1. Mac 연결'로 잠깐 되돌아가 보인다.
  const steps = data && !approving && !(busy && !runner) ? firstConnectionSteps(data) : null;
  const current = steps ? steps.findIndex((step) => !step.done) : -1;
  // 결과를 모르는 요청이 있어도 막지 않는다 — 같은 요청 번호로 다시 보낸다(write의 start).
  const startDisabled = busy || active || !runner?.online || !stored;
  const menu: OverflowAction[] = runner
    ? [
        { label: stored ? "로그인 정보 변경" : "로그인 정보 입력", onSelect: () => setCredentialOpen(true), disabled: active },
        { label: "Mac 연결 해제", onSelect: () => setRevokeOpen(true), destructive: true, disabled: busy },
      ]
    : [];
  return (
    <div className="min-w-0 space-y-5">
      {approving ? (
        <section className="finance-panel space-y-3 p-5" aria-label="Mac 연결 승인">
          <h3 className="text-heading">이 Mac 연결</h3>
          <p className="text-caption text-muted-foreground">
            연결을 해제할 때까지 이 Mac에서 내가 요청한 신한은행 조회를 허용하며, 모아에서 언제든 연결을 해제할 수 있어요.
          </p>
          <Button className="w-full" disabled={busy} onClick={() => { void write("approve"); }}>
            연결 해제 전까지 허용
          </Button>
        </section>
      ) : null}
      {steps && current >= 0 ? (
        <section className="finance-panel space-y-2 p-5" aria-label="처음 연결">
          <ol className="text-caption flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="연결 순서">
            {steps.map((step, index) => (
              <li
                key={step.label}
                aria-current={index === current ? "step" : undefined}
                className={`inline-flex items-center gap-1 ${index === current ? "font-semibold text-primary" : "text-muted-foreground"}`}
              >
                {step.done ? <Check className="size-3.5" aria-hidden="true" /> : <span aria-hidden="true">{index + 1}.</span>}
                {step.label}
                {step.done ? <span className="sr-only"> 완료</span> : null}
                {index < steps.length - 1 ? <span aria-hidden="true" className="ml-2 text-muted-foreground">›</span> : null}
              </li>
            ))}
          </ol>
          <p className="text-body">{steps[current].detail}</p>
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
      {!approving && (!data || runner) ? (
        <div className="space-y-2">
          {authRequired ? (
            <Button size="lg" className="w-full" disabled={busy || !runner?.online} onClick={() => { void write("continue"); }}>
              인증 완료, 계속 조회
            </Button>
          ) : runner && !stored ? (
            <Button size="lg" className="w-full" disabled={busy} onClick={() => setCredentialOpen(true)}>
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
              {busy || active ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? "요청 중…" : active ? "Mac에서 조회 중…" : "지금 조회하기"}
            </Button>
          )}
          {active ? (
            <Button variant="ghost" className="w-full" disabled={busy} onClick={() => { void write("cancel"); }}>
              요청 취소
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
            disabled={busy || active}
            onChanged={() => { void read(); }}
          />
        </BottomSheet>
      ) : null}
      <BottomSheet open={revokeOpen} onOpenChange={setRevokeOpen} title="Mac 연결을 해제할까요?">
        <p className="text-body text-muted-foreground pb-3">
          저장한 로그인 정보도 함께 지워지고, 다시 쓰려면 Mac에서 연결을 새로 해야 해요.
        </p>
        <Button
          variant="destructive"
          size="lg"
          className="w-full"
          disabled={busy}
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
