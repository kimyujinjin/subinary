"use client";
/**
 * 은행·증권 연결 — 첫 화면은 기관 목록 한 장, 기관을 누르면 그 기관 상세(§5 자동 연결).
 *
 * 선택할 수 없는 금융사는 누를 수 없는 `준비 중` 행으로만 둔다 — 누를 수 있게 그리면
 * 다시 "되는 것처럼" 읽힌다. 분류는 `providers.ts`가 소유한다.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  assetConnectionCatalogSchema,
  type AssetConnectionCatalog,
  type MacBankRunnerState,
} from "@family/contracts";

import { Button } from "@/components/ui/button";
import { PageBackHeader } from "@/components/widgets/page-back-header";
import { StatusChip, type ChipTone } from "@/components/widgets/status-chip";
import { apiFetch, type AccessToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatRelativeTime } from "@/lib/format";
import { macBankRunnerApi } from "@/lib/mac-bank-runner-client";

import { ConnectionScreen } from "./connection-screen";
import { ConnectedSharingRow } from "@/components/connected-sharing";
import { BankStartPanel, MAC_JOB_ACTIVE_STATES } from "./bank-start-panel";
import {
  CONNECTABLE_PROVIDERS,
  UPCOMING_PROVIDERS,
  isConnectableProvider,
  type ConnectableProvider,
} from "./providers";

/** 화면 제목. 전체 메뉴(`/more`)의 항목 이름과 같다 — 누른 이름과 다른 제목이 뜨면 다른 화면으로 읽힌다. */
export const CONNECTIONS_TITLE = "은행·증권 연결";

/**
 * 기관 행 오른쪽의 상태 한 줄. 문제·진행은 칩으로, 정상은 칩 없이 메타 글자(`연결됨 · 3분 전`)로 쓴다
 * (§3.5 상태 = 칩 + 메타, §8 기본 상태 배지 없음).
 */
export interface ProviderRowStatus {
  /** null이면 칩 대신 메타 글자로 그린다. */
  tone: ChipTone | null;
  label: string;
}

/** 토스증권 행: 서버 카탈로그 기준. `runtime_required`는 연결 준비가 아직 끝나지 않은 것이라 `준비 중`이다. */
export function tossCatalogStatus(
  catalog: AssetConnectionCatalog | null,
  catalogError: boolean
): ProviderRowStatus {
  if (catalogError) return { tone: "attention", label: "상태 확인 필요" };
  if (!catalog) return { tone: "neutral", label: "확인 중…" };
  const capability = catalog.items.find((item) => item.provider === "toss_securities");
  if (!capability) return { tone: "attention", label: "상태 확인 필요" };
  return capability.state === "available"
    ? { tone: "ok", label: "연결 가능" }
    : { tone: "pending", label: "준비 중" };
}

/**
 * 신한 행: 사용자가 실제로 쓰는 Mac 기준이다. 카탈로그의 신한 항목은 쓰지 않는 옛 은행 연결의 준비
 * 상태라, 그걸 보여주면 "Mac은 연결됨"인데 "확인 필요"로 읽히는 모순이 생겼다.
 * 문제는 원인에 가까운 것부터 칩으로 쓴다 — Mac이 꺼져 있으면 조회 실패보다 그것이 먼저다.
 */
export function shinhanRunnerStatus(
  state: MacBankRunnerState | null,
  error: boolean
): ProviderRowStatus {
  if (error) return { tone: "attention", label: "상태 확인 필요" };
  if (!state) return { tone: "neutral", label: "확인 중…" };
  if (!state.runner) return { tone: "neutral", label: "연결 전" };
  if (!state.runner.online) return { tone: "attention", label: "Mac 꺼짐" };
  const job = state.job?.state;
  if (job === "authentication_required") return { tone: "attention", label: "인증 필요" };
  if (job && MAC_JOB_ACTIVE_STATES.has(job)) return { tone: "pending", label: "조회 중" };
  if (job === "failed" || job === "operation_unknown") return { tone: "attention", label: "확인 필요" };
  if (!state.credentials?.stored) return { tone: "attention", label: "로그인 정보 필요" };
  const last = job === "succeeded" ? state.job!.completedAt : state.previousResult?.completedAt ?? null;
  return { tone: null, label: last ? `연결됨 · ${formatRelativeTime(last)}` : "연결됨 · 조회 전" };
}

/** 토스증권 연결 준비 상태. 금융사 카탈로그는 서버의 은행 연결 모듈이 낸다. */
async function readCatalog(
  token: AccessToken,
  householdId: string,
  signal: AbortSignal
): Promise<AssetConnectionCatalog> {
  const catalog = assetConnectionCatalogSchema.parse(
    await apiFetch<unknown>(
      `/v1/bank-connections/catalog?${new URLSearchParams({ householdId })}`,
      { accessToken: token, signal }
    )
  );
  signal.throwIfAborted();
  return catalog;
}

const ROW =
  "hover:bg-muted/50 flex min-h-16 items-center gap-3 px-5 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring active:bg-muted";

export function AssetConnectionHub({
  householdId,
  userId,
  canManage,
}: {
  householdId: string;
  userId: string;
  canManage: boolean;
}) {
  const params = useSearchParams();
  const provider = params.get("provider");
  if (isConnectableProvider(provider)) {
    const label = CONNECTABLE_PROVIDERS.find(
      (item) => item.id === provider
    )!.label;
    return (
      <div className="mx-auto w-full max-w-2xl min-w-0 space-y-5 pb-8">
        <PageBackHeader title={label} backHref="/more/connections" />
        {provider === "toss_securities" ? (
          <ConnectionScreen
            key={`toss/${userId}/${householdId}/${canManage}`}
            householdId={householdId}
            userId={userId}
            canManage={canManage}
            presentation="embedded"
          />
        ) : canManage ? (
          <BankStartPanel
            key={`bank/${userId}/${householdId}`}
            householdId={householdId}
            userId={userId}
          />
        ) : (
          // 서버가 보기 전용 구성원의 Mac 조회를 받지 않는다 — 빈 화면 대신 이유를 한 줄로 둔다.
          <p role="status" className="text-caption text-muted-foreground">
            보기 전용 권한이라 은행 연결을 쓸 수 없어요.
          </p>
        )}
      </div>
    );
  }
  return <ProviderList householdId={householdId} userId={userId} />;
}

function ProviderList({
  householdId,
  userId,
}: {
  householdId: string;
  userId: string;
}) {
  const { authedFetch } = useAuth();
  const [catalog, setCatalog] = useState<AssetConnectionCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [runner, setRunner] = useState<MacBankRunnerState | null>(null);
  const [runnerError, setRunnerError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setCatalogError(false);
    setRunner(null);
    setRunnerError(false);
    void authedFetch((token) =>
      readCatalog(token, householdId, controller.signal)
    )
      .then((result) => {
        if (!controller.signal.aborted) setCatalog(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogError(true);
      });
    void authedFetch((token) =>
      macBankRunnerApi.state(token, householdId, userId, controller.signal)
    )
      .then((result) => {
        if (!controller.signal.aborted) setRunner(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRunnerError(true);
      });
    return () => controller.abort();
  }, [authedFetch, householdId, userId, revision]);

  const status = (id: ConnectableProvider["id"]): ProviderRowStatus =>
    id === "shinhan_bank"
      ? shinhanRunnerStatus(runner, runnerError)
      : tossCatalogStatus(catalog, catalogError);

  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 space-y-5 pb-8">
      <PageBackHeader title={CONNECTIONS_TITLE} backHref="/assets" />

      {catalogError || runnerError ? (
        <div role="alert" className="flex items-center justify-between gap-3">
          <p className="text-caption text-muted-foreground">
            연결 상태를 불러오지 못했어요.
          </p>
          <Button
            variant="weak"
            size="sm"
            onClick={() => setRevision((value) => value + 1)}
          >
            다시 불러오기
          </Button>
        </div>
      ) : null}

      <nav
        aria-label="연결할 금융사"
        className="finance-panel divide-y divide-border/60 overflow-hidden"
      >
        {CONNECTABLE_PROVIDERS.map((item) => {
          const { tone, label } = status(item.id);
          return (
            <Link
              key={item.id}
              href={`/more/connections?provider=${item.id}`}
              className={ROW}
            >
              <span className="min-w-0 flex-1">
                <span className="text-body block font-semibold">
                  {item.label}
                </span>
                <span className="text-caption text-muted-foreground block">
                  {item.method}
                </span>
              </span>
              {tone ? (
                <StatusChip tone={tone}>{label}</StatusChip>
              ) : (
                <span className="text-caption text-muted-foreground shrink-0 whitespace-nowrap">
                  {label}
                </span>
              )}
              <ChevronRight
                className="text-muted-foreground/60 size-5 shrink-0"
                aria-hidden="true"
              />
            </Link>
          );
        })}
        {/* 선택지가 아니라 안내다 — 링크가 아니다. */}
        {UPCOMING_PROVIDERS.map((item) => (
          <div
            key={item.id}
            className={`${ROW} hover:bg-transparent`}
            aria-disabled="true"
            title={item.reason}
          >
            <span className="text-body text-muted-foreground min-w-0 flex-1">
              {item.label}
            </span>
            <StatusChip>준비 중</StatusChip>
            <span className="size-5 shrink-0" aria-hidden="true" />
          </div>
        ))}
      </nav>

      <ConnectedSharingRow />

      <Link
        href="/assets/loan-records"
        className="text-caption text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center active:text-foreground"
      >
        이전에 가져온 대출 기록
      </Link>
    </div>
  );
}
