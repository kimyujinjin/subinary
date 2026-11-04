"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  MAC_BANK_RUNNER_CONSENT_TEXT,
  type FinanceConnection,
  type MacBankRunnerState,
} from "@family/contracts";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/widgets/bottom-sheet";
import { StatusChip, type ChipTone } from "@/components/widgets/status-chip";
import { useAuth } from "@/lib/auth-context";
import { connectedAccountsKey } from "@/lib/connected-accounts-client";
import { financeConnectionKey, financeConnectionsApi } from "@/lib/finance-connections-client";
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

function timeText(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * 자산 화면의 '다시 조회'(§8): 내 연결 계좌(토스증권·신한 Mac 조회)를 한 번에 새로 조회한다.
 * 다른 가족의 계좌는 그 사람의 키·Mac이 필요해 여기서 조회하지 않는다(공유된 마지막 값을 쓴다).
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
  const toss = useRef<FinanceConnection[]>([]);
  const mac = useRef<MacBankRunnerState | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const patch = (key: string, change: Partial<Target>) =>
    setTargets(
      (current) =>
        current?.map((target) =>
          target.key === key ? { ...target, ...change } : target
        ) ?? current
    );

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
      authedFetch((token) =>
        macBankRunnerApi.state(token, householdId, userId, controller.signal)
      ),
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
    if (state.status === "fulfilled" && state.value.runner) {
      mac.current = state.value;
      const runner = state.value.runner;
      next.push({
        key: "shinhan",
        label: "신한은행",
        blocked: !runner.online
          ? "Mac이 꺼져 있어요"
          : !state.value.credentials?.stored
          ? "로그인 정보가 없어요"
          : state.value.job && ACTIVE.has(state.value.job.state)
          ? "이미 조회 중이에요"
          : null,
        step: "idle",
        note: null,
      });
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
      const job = await authedFetch((token) =>
        macBankRunnerApi.start(
          token,
          householdId,
          userId,
          crypto.randomUUID(),
          signal
        )
      );
      // Mac 조회는 보통 1분 안팎이다. 최대 3분 동안 상태를 읽어 끝을 확인한다.
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline && !signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const state = await authedFetch((token) =>
          macBankRunnerApi.state(token, householdId, userId, signal)
        );
        const current = state.job?.id === job.id ? state.job : null;
        if (!current || ACTIVE.has(current.state)) {
          if (current?.state === "authentication_required")
            patch("shinhan", { note: "Mac에서 은행 추가 인증이 필요해요" });
          continue;
        }
        patch(
          "shinhan",
          current.state === "succeeded"
            ? { step: "done", note: null }
            : { step: "failed", note: "신한은행 화면에서 확인해 주세요." }
        );
        return;
      }
      if (!signal.aborted)
        patch("shinhan", {
          step: "failed",
          note: "시간이 오래 걸려요. 신한은행 화면에서 확인해 주세요.",
        });
    } catch {
      if (!signal.aborted)
        patch("shinhan", {
          step: "failed",
          note: "요청 결과를 확인하지 못했어요.",
        });
    }
  }

  async function run() {
    if (!targets || running) return;
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    const jobs: Promise<void>[] = [];
    for (const target of targets) {
      if (target.blocked) {
        patch(target.key, { step: "skipped" });
        continue;
      }
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

  const runnable = targets?.some((target) => !target.blocked) ?? false;
  const finished = targets?.some((target) => target.step !== "idle") ?? false;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground -mr-2"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <RefreshCw className={running ? "animate-spin" : undefined} />
        다시 조회
      </Button>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !running) setTargets(null);
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
          (target) => target.key === "shinhan" && !target.blocked
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
          disabled={!runnable || running || finished}
          onClick={() => void run()}
        >
          {running ? "조회 중…" : finished ? "조회를 마쳤어요" : "다시 조회"}
        </Button>
        <p className="text-caption text-muted-foreground pt-2 text-center">
          가족이 공유한 계좌는 각자 조회한 마지막 값을 보여줘요.
        </p>
      </BottomSheet>
    </>
  );
}
