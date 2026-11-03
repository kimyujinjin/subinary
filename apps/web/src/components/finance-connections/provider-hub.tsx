"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { AssetConnectionCatalog, AssetConnectionProvider } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { PageBackHeader } from "@/components/widgets/page-back-header";
import { useAuth } from "@/lib/auth-context";
import { bankConnectionsApi } from "@/lib/bank-connections-client";
import { ConnectionScreen } from "./connection-screen";
import { BankConnectionScreen } from "./bank-screen";

export const CONNECTION_PROVIDERS = [
  { id: "shinhan_bank", label: "신한은행", method: "웹 로그인 · 통장 잔액·대출" },
  { id: "toss_securities", label: "토스증권", method: "공식 API · 국내·미국 주식" },
  { id: "toss_bank", label: "토스뱅크", method: "개인계좌 연결 방식 확인 중" },
  { id: "kb_bank", label: "국민은행", method: "웹 로그인 · 계좌 조회 검증 필요" },
] as const;
export function AssetConnectionHub({ householdId, userId, canManage }: { householdId: string; userId: string; canManage: boolean }) {
  const { authedFetch } = useAuth(); const params = useSearchParams();
  const candidate = params.get("provider");
  const selected: AssetConnectionProvider = CONNECTION_PROVIDERS.some(item => item.id === candidate) ? candidate as AssetConnectionProvider : "shinhan_bank";
  const [catalog, setCatalog] = useState<AssetConnectionCatalog | null>(null), [catalogError, setCatalogError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setCatalog(null); setCatalogError(false);
    void authedFetch(token => bankConnectionsApi.catalog(token, householdId, controller.signal))
      .then(result => { if (!controller.signal.aborted) setCatalog(result); })
      .catch(() => { if (!controller.signal.aborted) setCatalogError(true); });
    return () => controller.abort();
  }, [authedFetch, householdId, userId, revision]);
  const capability = (provider: AssetConnectionProvider) => catalog?.items.find(item => item.provider === provider);
  return <div className="mx-auto w-full max-w-2xl min-w-0 space-y-5 pb-8">
    <header className="pl-2.5"><PageBackHeader title="자동 연결" subtitle="은행·증권 계좌를 한곳에서 관리해요." backHref="/assets" /></header>
    <nav aria-label="연결할 금융사" className="grid min-w-0 grid-cols-2 gap-2">
      {CONNECTION_PROVIDERS.map(provider => <Link key={provider.id} href={`/more/connections?provider=${provider.id}`} aria-current={selected === provider.id ? "page" : undefined}
        className={`flex min-h-20 min-w-0 flex-col justify-center rounded-xl border px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected === provider.id ? "border-primary bg-accent" : "bg-card"}`}>
        <span className="break-words text-sm font-semibold">{provider.label}</span>
        <span className="mt-1 text-xs text-muted-foreground">{catalogError ? "상태 확인 필요" : !catalog ? "확인 중…" : capability(provider.id)?.state === "available" ? "연결 가능" : provider.id === "shinhan_bank" ? "Codex에서 연동 준비" : provider.id === "kb_bank" ? "실제 조회 검증 필요" : "연결 방식 확인 중"}</span>
      </Link>)}
    </nav>
    {catalogError ? <div role="alert" className="space-y-3 rounded-xl border p-4"><p className="text-sm">금융사 연결 상태를 확인하지 못했어요. 기존 토스증권 연결은 아래에서 확인할 수 있어요.</p><Button variant="outline" className="min-h-11" onClick={() => setRevision(value => value + 1)}>다시 확인</Button></div> : null}
    <section className="rounded-xl bg-muted/60 p-4 text-xs leading-relaxed text-muted-foreground">금융사마다 연결 방식이 달라요. 로그인 정보와 API 키는 본인 계정에서 관리하며 다른 가족에게 보여주지 않아요. 현재 연결 조회값은 기존 가족 자산 합계와 별도로 표시해요.</section>
    {selected === "toss_securities" ? <ConnectionScreen key={`toss/${userId}/${householdId}/${canManage}`} householdId={householdId} userId={userId} canManage={canManage} presentation="embedded" />
      : selected === "shinhan_bank" ? <>
        <div><h2 className="text-lg font-semibold">신한은행</h2><p className="mt-1 text-sm text-muted-foreground">{capability("shinhan_bank")?.state === "available"
          ? "선택한 통장의 원화 잔액이나 대출의 원금·만기일을 가져와요."
          : "본인 신한 통장·대출 연동을 준비해요. 실제 조회·저장은 아직 시작되지 않아요."}</p></div>
        <BankConnectionScreen key={`bank/${userId}/${householdId}/${canManage}`} householdId={householdId} userId={userId} canManage={canManage} />
      </> : <section className="space-y-3 rounded-xl border bg-card p-4" aria-label={`${selected === "kb_bank" ? "국민은행" : "토스뱅크"} 연결 안내`}>
        <h2 className="font-semibold">{selected === "kb_bank" ? "국민은행" : "토스뱅크"}</h2>
        <p className="text-sm leading-relaxed">{selected === "kb_bank" ? "공식 웹에서 아이디 로그인과 보안 입력 방식을 확인했어요. 실제 계좌 조회와 읽어올 항목을 검증한 뒤 연결할 수 있어요." : "개인계좌는 토스 앱 중심으로 제공돼요. 무료로 사용할 수 있는 외부 조회 방식이 아직 확인되지 않아 연결 정보를 받지 않아요."}</p>
        <p className="text-xs text-muted-foreground">아직 자동으로 가져오는 계좌가 없어요. 파일 업로드로 대신 연결하지 않아요.</p>
      </section>}
    <details className="border-t text-sm"><summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">기존 대출 기록 관리</summary><p className="mb-3 text-xs leading-relaxed text-muted-foreground">이전에 가져와 저장한 대출은 그대로 보관돼요. 새 자동 연결이 이전 기록을 덮어쓰지는 않아요.</p><Link href="/assets/loan-records" className="inline-flex min-h-11 items-center font-medium text-primary">이전에 저장한 대출 보기</Link></details>
  </div>;
}
