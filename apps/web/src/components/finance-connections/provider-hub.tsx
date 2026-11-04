"use client";
/**
 * 자동 연결 — 첫 화면은 기관 목록 한 장, 기관을 누르면 그 기관 상세(§5 자동 연결).
 *
 * 선택할 수 없는 금융사는 누를 수 없는 `준비 중` 행으로만 둔다 — 누를 수 있게 그리면
 * 다시 "되는 것처럼" 읽힌다. 분류는 `providers.ts`가 소유한다.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type {
  AssetConnectionCatalog,
  MacBankRunnerState,
} from "@family/contracts";

import { Button } from "@/components/ui/button";
import { PageBackHeader } from "@/components/widgets/page-back-header";
import { StatusChip, type ChipTone } from "@/components/widgets/status-chip";
import { useAuth } from "@/lib/auth-context";
import { bankConnectionsApi } from "@/lib/bank-connections-client";
import { macBankRunnerApi } from "@/lib/mac-bank-runner-client";

import { ConnectionScreen } from "./connection-screen";
import { BankConnectionScreen } from "./bank-screen";
import {
  CONNECTABLE_PROVIDERS,
  UPCOMING_PROVIDERS,
  isConnectableProvider,
  type ConnectableProvider,
} from "./providers";

/**
 * 카탈로그 기준 상태 한 줄.
 *
 * `runtime_required`의 뜻이 금융사마다 다르다 — 신한은 내 Mac이 꺼져 있는 것이고,
 * 토스증권은 운영자가 키 저장을 아직 켜지 않은 것이다. 같은 문구로 뭉뚱그리면
 * 사용자가 할 수 있는 일(Mac 켜기)과 할 수 없는 일(운영자 대기)이 구분되지 않는다.
 */
export function providerStatusLabel(
  provider: ConnectableProvider["id"],
  catalog: AssetConnectionCatalog | null,
  catalogError: boolean
): string {
  if (catalogError) return "상태 확인 필요";
  if (!catalog) return "확인 중…";
  const capability = catalog.items.find((item) => item.provider === provider);
  if (!capability) return "상태 확인 필요";
  if (capability.state === "available") return "연결 가능";
  return provider === "shinhan_bank"
    ? "연결한 Mac 확인 필요"
    : "운영자 설정 대기";
}

/**
 * 신한 행의 상태는 사용자가 실제로 쓰는 Mac 실행기 기준이다. 카탈로그의 신한 항목은
 * 별도 은행 연결 API의 준비 상태라, 그걸 보여주면 "Mac은 연결됨"인데 "Mac 확인 필요"로
 * 읽히는 모순이 생겼다.
 */
export function shinhanRunnerStatus(
  state: MacBankRunnerState | null,
  error: boolean
): [ChipTone, string] {
  if (error) return ["attention", "상태 확인 필요"];
  if (!state) return ["neutral", "확인 중…"];
  if (!state.runner) return ["neutral", "연결 전"];
  return state.runner.online ? ["ok", "Mac 연결됨"] : ["attention", "Mac 꺼짐"];
}

function catalogTone(label: string): ChipTone {
  if (label === "연결 가능") return "ok";
  if (label === "확인 중…") return "neutral";
  if (label === "상태 확인 필요") return "attention";
  return "pending";
}

const ROW =
  "hover:bg-muted/50 flex min-h-16 items-center gap-3 px-5 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

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
        ) : (
          <BankConnectionScreen
            key={`bank/${userId}/${householdId}/${canManage}`}
            householdId={householdId}
            userId={userId}
            canManage={canManage}
          />
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
      bankConnectionsApi.catalog(token, householdId, controller.signal)
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

  const status = (id: ConnectableProvider["id"]): [ChipTone, string] => {
    if (id === "shinhan_bank") return shinhanRunnerStatus(runner, runnerError);
    const label = providerStatusLabel(id, catalog, catalogError);
    return [
      catalogTone(label),
      label === "운영자 설정 대기" ? "준비 중" : label,
    ];
  };

  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 space-y-5 pb-8">
      <PageBackHeader title="자동 연결" backHref="/assets" />

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
          const [tone, label] = status(item.id);
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
              <StatusChip tone={tone}>{label}</StatusChip>
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

      <Link
        href="/assets/loan-records"
        className="text-caption text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center"
      >
        이전에 가져온 대출 기록
      </Link>
    </div>
  );
}
