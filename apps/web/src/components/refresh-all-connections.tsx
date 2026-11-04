"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  MAC_BANK_RUNNER_CONSENT_TEXT,
  type FinanceConnection,
  type MacBankJob,
  type MacBankRunnerState,
} from "@family/contracts";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/widgets/bottom-sheet";
import { StatusChip, type ChipTone } from "@/components/widgets/status-chip";
import { useAuth } from "@/lib/auth-context";
import { connectedAccountsKey } from "@/lib/connected-accounts-client";
import {
  financeConnectionKey,
  financeConnectionsApi,
} from "@/lib/finance-connections-client";
import { macBankRunnerApi } from "@/lib/mac-bank-runner-client";

type Step = "idle" | "running" | "done" | "failed" | "skipped";
interface Target {
  key: string;
  label: string;
  /** 지금 조회할 수 있으면 null, 아니면 이유. */
  blocked: string | null;
  step: Step;
  note: string | null;
}

const ACTIVE = new Set([
  "queued",
  "claimed",
  "running",
  "authentication_required",
  "reading",
  "logging_out",
]);
const STEP_CHIP: Record<Step, [ChipTone, string] | null> = {
  idle: null,
  running: ["pending", "조회 중"],
  done: ["ok", "완료"],
  failed: ["error", "실패"],
  skipped: ["neutral", "건너뜀"],
};
/** 인증 대기는 작업 만료(claim 후 10분)까지 이어질 수 있어 그보다 조금 길게 따라간다. */
const FOLLOW_LIMIT_MS = 660_000;

function timeText(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function activeJob(state: MacBankRunnerState | null): MacBankJob | null {
  return state?.job && ACTIVE.has(state.job.state) ? state.job : null;
}

function runningNote(job: MacBankJob): string {
  return job.state === "authentication_required"
    ? "Mac에서 은행 추가 인증이 필요해요"
    : "Mac에서 조회 중";
}

/** 신한 항목. 진행 중인 작업이 있으면(어느 버튼에서 시작했든) 새 요청 대신 그 작업을 '조회 중'으로 보여 준다. */
export function shinhanTarget(state: MacBankRunnerState): Target | null {
  const runner = state.runner;
  if (!runner) return null;
  const job = activeJob(state);
  if (job)
    return {
      key: "shinhan",
      label: "신한은행",
      blocked: null,
      step: "running",
      note: runningNote(job),
    };
  return {
    key: "shinhan",
    label: "신한은행",
    blocked: !runner.online
      ? "Mac이 꺼져 있어요"
      : !state.credentials?.stored
      ? "로그인 정보가 없어요"
      : null,
    step: "idle",
    note: null,
  };
}

/**
 * 자산 화면의 '다시 조회'(§8): 내 연결 계좌(토스증권·신한 Mac 조회)를 한 번에 새로 조회한다.
 * 다른 가족의 계좌는 그 사람의 키·Mac이 필요해 여기서 조회하지 않는다(공유된 마지막 값을 쓴다).
 * 신한 조회는 연결 화면의 '지금 조회하기'와 같은 요청이다. 진행 중이면 끝날 때까지 아이콘이 돌고 새 요청을 막는다.
 */
export function RefreshAllConnections({
  householdId,
  userId,
}: {
  householdId: string;
  userId: string;
}) {
  const { authedFetch } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [running, setRunning] = useState(false);
  const [following, setFollowing] = useState(false);
  const toss = useRef<FinanceConnection[]>([]);
  const abort = useRef<AbortController | null>(null);
  /** 화면이 떠 있는 동안 진행 중인 신한 작업을 따라간다. 같은 작업을 두 번 따라가지 않는다. */
  const life = useRef<AbortController | null>(null);
  const watching = useRef<string | null>(null);
  const busy = running || following;

  const patch = (key: string, change: Partial<Target>) =>
    setTargets(
      (current) =>
        current?.map((target) =>
          target.key === key ? { ...target, ...change } : target
        ) ?? current
    );

  const readState = (signal?: AbortSignal) =>
    authedFetch((token) =>
      macBankRunnerApi.state(token, householdId, userId, signal)
    );

  async function watch(jobId: string) {
    const signal = life.current?.signal;
    if (!signal || signal.aborted || watching.current === jobId) return;
    watching.current = jobId;
    setFollowing(true);
    try {
      const deadline = Date.now() + FOLLOW_LIMIT_MS;
      let final: MacBankJob | null = null;
      while (Date.now() < deadline && !signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const state = await readState(signal);
        const current = state.job?.id === jobId ? state.job : null;
        if (current && ACTIVE.has(current.state)) {
          patch("shinhan", { step: "running", note: runningNote(current) });
          continue;
        }
        final = current;
        break;
      }
      if (signal.aborted) return;
      patch(
        "shinhan",
        final?.state === "succeeded"
          ? { step: "done", note: null }
          : final
          ? { step: "failed", note: "신한은행 화면에서 확인해 주세요." }
          : {
              step: "failed",
              note: "시간이 오래 걸려요. 신한은행 화면에서 확인해 주세요.",
            }
      );
      await queryClient.invalidateQueries({
        queryKey: connectedAccountsKey(householdId, userId),
      });
    } catch {
      if (!signal.aborted)
        patch("shinhan", {
          step: "failed",
          note: "요청 결과를 확인하지 못했어요.",
        });
    } finally {
      if (watching.current === jobId) {
        watching.current = null;
        if (!signal.aborted) setFollowing(false);
      }
    }
  }

  // 화면에 들어오거나 앱으로 돌아왔을 때 진행 중인 신한 작업이 있으면 따라간다(다른 화면에서 시작한 것 포함).
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    const check = async () => {
      if (document.visibilityState !== "visible" || watching.current) return;
      try {
        const job = activeJob(await readState(controller.signal));
        if (job && !controller.signal.aborted) void watch(job.id);
      } catch {
        // 상태를 읽지 못하면 아이콘만 돌리지 않는다. 조회 자체는 Mac에서 계속된다.
      }
    };
    void check();
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      abort.current?.abort();
      document.removeEventListener("visibilitychange", check);
    };
    // 가구·사용자가 바뀔 때만 다시 건다. watch·readState는 렌더마다 새로 만들어지지만 같은 일을 한다.
  }, [householdId, userId]);

  async function load() {
    setTargets(null);
    const controller = new AbortController();
    abort.current = controller;
    const [list, state] = await Promise.allSettled([
      authedFetch((token) =>
        financeConnectionsApi.list(
          token,
          householdId,
          userId,
          controller.signal
        )
      ),
      readState(controller.signal),
    ]);
    if (controller.signal.aborted) return;
    const next: Target[] = [];
    if (list.status === "fulfilled") {
      toss.current = list.value.items.filter(
        (item) => item.status !== "disconnected" && item.selectedAccountId
      );
      for (const item of toss.current) {
        next.push({
          key: `toss:${item.id}`,
          label: "토스증권",
          blocked: !list.value.enabled
            ? "서비스 준비 중"
            : item.canRefresh
            ? null
            : item.nextRefreshAt
            ? `${timeText(item.nextRefreshAt)} 이후 가능`
            : "지금은 조회할 수 없어요",
          step: "idle",
          note: null,
        });
      }
    }
    if (state.status === "fulfilled") {
      const target = shinhanTarget(state.value);
      if (target) next.push(target);
      const job = activeJob(state.value);
      if (job) void watch(job.id);
    }
    setTargets(next);
  }

  async function refreshToss(item: FinanceConnection, signal: AbortSignal) {
    const key = `toss:${item.id}`;
    patch(key, { step: "running" });
    try {
      await authedFetch((token) =>
        financeConnectionsApi.refresh(
          token,
          item.id,
          {
            householdId,
            expectedVersion: item.version,
            requestId: crypto.randomUUID(),
          },
          userId,
          signal
        )
      );
      patch(key, { step: "done" });
    } catch {
      if (!signal.aborted)
        patch(key, { step: "failed", note: "잠시 후 다시 시도해 주세요." });
    }
  }

  async function refreshShinhan(signal: AbortSignal) {
    patch("shinhan", { step: "running", note: "Mac에서 은행 접속 중" });
    try {
      let jobId: string;
      try {
        jobId = (
          await authedFetch((token) =>
            macBankRunnerApi.start(
              token,
              householdId,
              userId,
              crypto.randomUUID(),
              signal
            )
          )
        ).id;
      } catch (error) {
        // 거의 동시에 다른 화면에서 시작했으면(서버가 진행 중 작업으로 거절) 그 작업을 따라간다.
        const job = activeJob(await readState(signal));
        if (!job) throw error;
        jobId = job.id;
      }
      await watch(jobId);
    } catch {
      if (!signal.aborted)
        patch("shinhan", {
          step: "failed",
          note: "요청 결과를 확인하지 못했어요.",
        });
    }
  }

  async function run() {
    if (!targets || busy) return;
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    const jobs: Promise<void>[] = [];
    for (const target of targets) {
      if (target.blocked) {
        patch(target.key, { step: "skipped" });
        continue;
      }
      if (target.step !== "idle") continue;
      if (target.key === "shinhan")
        jobs.push(refreshShinhan(controller.signal));
      else {
        const item = toss.current.find(
          (row) => `toss:${row.id}` === target.key
        );
        if (item) jobs.push(refreshToss(item, controller.signal));
      }
    }
    await Promise.allSettled(jobs);
    if (!controller.signal.aborted) {
      await queryClient.invalidateQueries({
        queryKey: connectedAccountsKey(householdId, userId),
      });
      await queryClient.invalidateQueries({
        queryKey: financeConnectionKey(householdId, userId),
      });
      setRunning(false);
    }
  }

  const runnable =
    targets?.some((target) => !target.blocked && target.step === "idle") ??
    false;
  const finished =
    targets?.some(
      (target) =>
        target.step === "done" ||
        target.step === "failed" ||
        target.step === "skipped"
    ) ?? false;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground -mr-2"
        aria-busy={busy}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <RefreshCw className={busy ? "animate-spin" : undefined} />
        {busy ? "조회 중" : "다시 조회"}
      </Button>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !busy) setTargets(null);
        }}
        title="연결 계좌 다시 조회"
      >
        {targets === null ? (
          <p className="text-body text-muted-foreground py-4" role="status">
            연결 상태를 확인하고 있어요.
          </p>
        ) : targets.length === 0 ? (
          <p className="text-body text-muted-foreground py-4">
            다시 조회할 내 연결 계좌가 없어요.
          </p>
        ) : (
          <ul className="divide-border/60 divide-y">
            {targets.map((target) => {
              const chip = STEP_CHIP[target.step];
              return (
                <li
                  key={target.key}
                  className="flex min-h-14 items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="text-body block font-semibold">
                      {target.label}
                    </span>
                    <span className="text-caption text-muted-foreground block">
                      {target.note ?? target.blocked ?? "조회할 수 있어요"}
                    </span>
                  </span>
                  {chip ? (
                    <StatusChip tone={chip[0]}>{chip[1]}</StatusChip>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {targets?.some(
          (target) =>
            target.key === "shinhan" &&
            !target.blocked &&
            target.step === "idle"
        ) ? (
          <details className="text-caption text-muted-foreground">
            <summary className="min-h-10 cursor-pointer py-2">
              조회하면 동의하는 내용
            </summary>
            <p className="pb-2">{MAC_BANK_RUNNER_CONSENT_TEXT}</p>
          </details>
        ) : null}
        <Button
          size="lg"
          className="mt-2 w-full"
          disabled={!runnable || busy || finished}
          onClick={() => void run()}
        >
          {busy ? (
            <>
              <RefreshCw className="animate-spin" aria-hidden />
              조회 중…
            </>
          ) : finished ? (
            "조회를 마쳤어요"
          ) : (
            "다시 조회"
          )}
        </Button>
        <p className="text-caption text-muted-foreground pt-2 text-center">
          가족이 공유한 계좌는 각자 조회한 마지막 값을 보여줘요.
        </p>
      </BottomSheet>
    </>
  );
}
