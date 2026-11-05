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
import { ErrorState } from "@/components/widgets/error-state";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { ListLoading } from "@/components/widgets/list-loading";
import { StatusChip, type ChipTone } from "@/components/widgets/status-chip";
import { useAuth } from "@/lib/auth-context";
import { connectedAccountsKey } from "@/lib/connected-accounts-client";
import { formatMonthDay, formatMonthDayTime, formatTimeShort } from "@/lib/format";
import {
  financeConnectionKey,
  financeConnectionsApi,
} from "@/lib/finance-connections-client";
import { macBankRunnerApi } from "@/lib/mac-bank-runner-client";

type Step = "idle" | "running" | "done" | "failed" | "skipped";
export interface Target {
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

/** 토스 조회 간격 제한이 풀리는 시각. 오늘이면 '오후 2:31', 다른 날이면 '11월 6일 오전 9:00'. */
export function nextRefreshText(iso: string, now: Date = new Date()): string {
  return formatMonthDay(iso, now) === formatMonthDay(now, now)
    ? formatTimeShort(iso)
    : formatMonthDayTime(iso, now);
}

/** 줄 아래 한 줄. 막힌 줄은 이유, 끝난 줄은 결과를 말한다(칩과 같은 뜻을 글자로도). */
export function targetNote(target: Target): string {
  switch (target.step) {
    case "running":
      return target.note ?? "조회하고 있어요";
    case "done":
      return target.note ?? "방금 새로 조회했어요";
    case "failed":
      return target.note ?? "조회하지 못했어요";
    case "skipped":
      return target.blocked ?? "이번에는 조회하지 않았어요";
    default:
      return target.blocked ?? "조회할 수 있어요";
  }
}

/** 실패한 줄에만 '다시 시도'를 둔다. 막힌 줄(Mac 꺼짐 등)은 눌러도 같은 결과라 두지 않는다. */
export function retryable(target: Target): boolean {
  return target.step === "failed" && !target.blocked;
}

export type RefreshPhase = "loading" | "failed" | "empty" | "ready" | "running" | "settled";

/**
 * 시트 아래 채움 버튼의 상태. 조회할 줄이 있으면 '조회하기', 도는 동안은 진행 표시,
 * 그 밖(끝남·전부 막힘·없음)에는 버튼을 두지 않고 시트의 '닫기'만 남긴다 —
 * 예전에는 비활성 '조회를 마쳤어요' 버튼이 상태 문구 노릇을 했다(2026-11-05 HIG 검수).
 */
export function refreshPhase(
  targets: readonly Target[] | null,
  busy: boolean,
  loadFailed = false
): RefreshPhase {
  if (targets === null) return "loading";
  if (busy) return "running";
  if (!targets.length) return loadFailed ? "failed" : "empty";
  return targets.some((target) => !target.blocked && target.step === "idle")
    ? "ready"
    : "settled";
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
 * 내 연결이 없으면 버튼을 숨긴다 — 눌러도 '없어요'뿐인 막다른 시트였다. 연결 진입점은 자산 추가 시트다.
 */
export function RefreshAllConnections({
  householdId,
  userId,
  hasOwnConnection = false,
}: {
  householdId: string;
  userId: string;
  /** 부모가 아는 내 연결(내 연결 계좌 값·토스 연결). 신한 Mac 연결은 여기서 상태를 읽어 더한다. */
  hasOwnConnection?: boolean;
}) {
  const { authedFetch } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [running, setRunning] = useState(false);
  const [following, setFollowing] = useState(false);
  /** 신한 Mac 연결이 있는지(값을 아직 못 가져왔어도 다시 조회할 대상이다). */
  const [hasRunner, setHasRunner] = useState(false);
  /** 연결 목록·신한 상태 중 하나라도 읽지 못했는지. */
  const [loadFailed, setLoadFailed] = useState(false);
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
        const state = await readState(controller.signal);
        if (controller.signal.aborted) return;
        setHasRunner(Boolean(state.runner));
        const job = activeJob(state);
        if (job) void watch(job.id);
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
    setLoadFailed(false);
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
            ? `${nextRefreshText(item.nextRefreshAt)}부터 조회할 수 있어요`
            : "지금은 조회할 수 없어요",
          step: "idle",
          note: null,
        });
      }
    }
    if (state.status === "fulfilled") {
      setHasRunner(Boolean(state.value.runner));
      const target = shinhanTarget(state.value);
      if (target) next.push(target);
      const job = activeJob(state.value);
      if (job) void watch(job.id);
    }
    // 읽지 못한 쪽을 '연결이 없다'로 말하지 않는다 — 실패는 실패로 알리고 다시 불러오게 한다.
    setLoadFailed(list.status === "rejected" || state.status === "rejected");
    setTargets(next);
  }

  async function refreshToss(item: FinanceConnection, signal: AbortSignal) {
    const key = `toss:${item.id}`;
    patch(key, { step: "running", note: null });
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
      patch(key, { step: "done", note: null });
    } catch {
      if (!signal.aborted)
        patch(key, { step: "failed", note: "조회하지 못했어요." });
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

  /** `only`를 주면 그 줄만 다시 시도한다(실패한 줄의 '다시 시도'). */
  async function run(only?: string) {
    if (!targets || busy) return;
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    const jobs: Promise<void>[] = [];
    for (const target of targets) {
      if (only !== undefined && target.key !== only) continue;
      if (target.blocked) {
        patch(target.key, { step: "skipped" });
        continue;
      }
      const ready =
        target.step === "idle" || (only !== undefined && retryable(target));
      if (!ready) continue;
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

  const phase = refreshPhase(targets, busy, loadFailed);
  // 도는 중이거나 시트가 열려 있으면 연결 여부와 상관없이 둔다(진행 표시·닫힌 뒤 다시 열기).
  const visible = hasOwnConnection || hasRunner || busy || open;

  return (
    <>
      {visible ? (
        // 보이는 높이도 44px(기본 크기) — 머리 오른쪽 하나뿐이라 줄일 이유가 없다.
        <Button
          variant="ghost"
          className="text-muted-foreground -mr-3 px-3"
          aria-busy={busy}
          onClick={() => {
            setOpen(true);
            void load();
          }}
        >
          <RefreshCw className={busy ? "animate-spin" : undefined} />
          {busy ? "조회 중" : "다시 조회하기"}
        </Button>
      ) : null}
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !busy) setTargets(null);
        }}
        title="연결 계좌 다시 조회"
      >
        {phase === "loading" ? (
          <ListLoading rows={2} label="연결 상태를 확인하고 있어요." />
        ) : phase === "failed" ? (
          <ErrorState
            message="연결 상태를 불러오지 못했어요."
            onRetry={() => void load()}
          />
        ) : targets === null || targets.length === 0 ? (
          <p className="text-body text-muted-foreground py-4">
            다시 조회할 내 연결 계좌가 없어요.
          </p>
        ) : (
          <>
            {/* 읽은 쪽은 그대로 보이고, 못 읽은 쪽이 있다는 것만 알린다. */}
            {loadFailed ? (
              <InlineNotice tone="error" className="mb-2">
                일부 연결의 상태를 불러오지 못했어요.
              </InlineNotice>
            ) : null}
            <ul className="divide-border/60 divide-y">
              {targets.map((target) => {
                const chip = STEP_CHIP[target.step];
                return (
                  <li
                    key={target.key}
                    className="flex min-h-14 items-center gap-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-body block font-semibold">
                        {target.label}
                      </span>
                      <span className="text-caption text-muted-foreground block">
                        {targetNote(target)}
                      </span>
                    </span>
                    {chip ? (
                      <StatusChip tone={chip[0]}>{chip[1]}</StatusChip>
                    ) : null}
                    {retryable(target) && !busy ? (
                      <Button
                        variant="weak"
                        size="sm"
                        onClick={() => void run(target.key)}
                      >
                        다시 시도
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {targets?.some(
          (target) =>
            target.key === "shinhan" &&
            !target.blocked &&
            (target.step === "idle" || target.step === "failed")
        ) ? (
          <details className="text-caption text-muted-foreground">
            <summary className="min-h-11 cursor-pointer py-3">
              조회하면 동의하는 내용
            </summary>
            <p className="pb-2">{MAC_BANK_RUNNER_CONSENT_TEXT}</p>
          </details>
        ) : null}
        {phase === "ready" || phase === "running" ? (
          <Button
            size="lg"
            className="mt-2 w-full"
            disabled={phase === "running"}
            onClick={() => void run()}
          >
            {phase === "running" ? (
              <>
                <RefreshCw className="animate-spin" aria-hidden />
                조회 중…
              </>
            ) : (
              "조회하기"
            )}
          </Button>
        ) : null}
        <p className="text-caption text-muted-foreground pt-2 text-center">
          가족이 공유한 계좌는 각자 조회한 마지막 값을 보여줘요.
        </p>
      </BottomSheet>
    </>
  );
}
