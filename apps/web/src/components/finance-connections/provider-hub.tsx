"use client";
/**
 * 자동 연결 허브 — 연결할 수 있는 금융사만 선택지로 두고, 나머지는 안내로 분리한다.
 *
 * 예전에는 금융사 4개를 같은 크기의 선택 카드로 그렸다. 그중 둘(토스뱅크·국민은행)은
 * 서버가 어떤 설정에서도 `available`을 주지 않으므로 누를 수는 있는데 아무 데도
 * 가지 못했다. 선택할 수 없는 것을 선택지처럼 그리지 않는다 — 분류는
 * `providers.ts`가 소유한다.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { AssetConnectionCatalog } from "@family/contracts";

import { Button } from "@/components/ui/button";
import { PageBackHeader } from "@/components/widgets/page-back-header";
import { useAuth } from "@/lib/auth-context";
import { bankConnectionsApi } from "@/lib/bank-connections-client";

import { ConnectionScreen } from "./connection-screen";
import { BankConnectionScreen } from "./bank-screen";
import {
  CONNECTABLE_PROVIDERS,
  UPCOMING_PROVIDERS,
  selectedProvider,
  type ConnectableProvider,
} from "./providers";

/**
 * 선택 카드의 상태 한 줄.
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

export function AssetConnectionHub({
  householdId,
  userId,
  canManage,
}: {
  householdId: string;
  userId: string;
  canManage: boolean;
}) {
  const { authedFetch } = useAuth();
  const params = useSearchParams();
  const selected = selectedProvider(params.get("provider"));
  const [catalog, setCatalog] = useState<AssetConnectionCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setCatalogError(false);
    void authedFetch((token) =>
      bankConnectionsApi.catalog(token, householdId, controller.signal)
    )
      .then((result) => {
        if (!controller.signal.aborted) setCatalog(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogError(true);
      });
    return () => controller.abort();
  }, [authedFetch, householdId, userId, revision]);

  const shinhanReady =
    catalog?.items.find((item) => item.provider === "shinhan_bank")?.state ===
    "available";

  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 space-y-5 pb-8">
      <header className="pl-2.5">
        <PageBackHeader
          title="자동 연결"
          subtitle="은행·증권 계좌를 한곳에서 관리해요."
          backHref="/assets"
        />
      </header>

      <nav
        aria-label="연결할 금융사"
        className="grid min-w-0 grid-cols-2 gap-2"
      >
        {CONNECTABLE_PROVIDERS.map((provider) => (
          <Link
            key={provider.id}
            href={`/more/connections?provider=${provider.id}`}
            aria-current={selected === provider.id ? "page" : undefined}
            className={`flex min-h-20 min-w-0 flex-col justify-center rounded-xl border px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              selected === provider.id ? "border-primary bg-accent" : "bg-card"
            }`}
          >
            <span className="break-words text-sm font-semibold">
              {provider.label}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {providerStatusLabel(provider.id, catalog, catalogError)}
            </span>
          </Link>
        ))}
      </nav>

      {catalogError ? (
        <div role="alert" className="space-y-3 rounded-xl border p-4">
          <p className="text-sm">
            금융사 연결 상태를 확인하지 못했어요. 기존 연결은 아래에서 확인할 수
            있어요.
          </p>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setRevision((value) => value + 1)}
          >
            다시 확인
          </Button>
        </div>
      ) : null}

      <section className="rounded-xl bg-muted/60 p-4 text-xs leading-relaxed text-muted-foreground">
        금융사마다 연결 방식이 달라요. 로그인 정보와 API 키는 본인 계정에서
        관리하며 다른 가족에게 보여주지 않아요. 현재 연결 조회값은 기존 가족
        자산 합계와 별도로 표시해요.
      </section>

      {selected === "toss_securities" ? (
        <ConnectionScreen
          key={`toss/${userId}/${householdId}/${canManage}`}
          householdId={householdId}
          userId={userId}
          canManage={canManage}
          presentation="embedded"
        />
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold">신한은행</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {shinhanReady
                ? "선택한 통장의 원화 잔액이나 대출의 원금·만기일을 가져와요."
                : "조회 시작 버튼을 누르면 연결한 Mac의 실행기가 본인 통장·대출을 조회해요."}
            </p>
          </div>
          <BankConnectionScreen
            key={`bank/${userId}/${householdId}/${canManage}`}
            householdId={householdId}
            userId={userId}
            canManage={canManage}
          />
        </>
      )}

      {/* 선택 카드가 아니라 안내다 — 누를 수 있게 만들면 다시 "되는 것처럼" 읽힌다. */}
      <section
        className="rounded-xl border bg-card p-4"
        aria-label="아직 연결할 수 없는 금융사"
      >
        <h2 className="text-sm font-semibold">아직 연결할 수 없는 금융사</h2>
        <dl className="mt-3 space-y-3">
          {UPCOMING_PROVIDERS.map((provider) => (
            <div key={provider.id}>
              <dt className="text-sm font-medium">{provider.label}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {provider.reason}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          파일 업로드로 대신 연결하지 않아요.
        </p>
      </section>

      <details className="border-t text-sm">
        <summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">
          기존 대출 기록 관리
        </summary>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          이전에 가져와 저장한 대출은 그대로 보관돼요. 새 자동 연결이 이전
          기록을 덮어쓰지는 않아요.
        </p>
        <Link
          href="/assets/loan-records"
          className="inline-flex min-h-11 items-center font-medium text-primary"
        >
          이전에 저장한 대출 보기
        </Link>
      </details>
    </div>
  );
}
