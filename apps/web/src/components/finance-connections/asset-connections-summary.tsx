"use client";

import type { FinanceConnectionList } from "@family/contracts";

import { SectionHeader } from "@/components/widgets/section-header";
import { StatusChip, type ChipTone } from "@/components/widgets/status-chip";
import {
  CONNECTION_ERROR,
  CONNECTION_STATUS,
  connectionMoney,
  connectionTime,
  hasPreviousSnapshot,
} from "./model";

const CURRENCY_LABEL = { KRW: "국내 주식", USD: "미국 주식" } as const;

/**
 * Presentation only: all reads, authorization fences and refreshes belong to ConnectionScreen.
 * 연결이 없으면 섹션 자체를 그리지 않는다 — 연결 시작은 `자산 추가` 시트가 맡는다(§5 자산).
 */
export function AssetConnectionsSummary({
  data,
  busy,
  loading,
  notice,
  uncertainId,
}: {
  data: FinanceConnectionList | null;
  busy: boolean;
  loading: boolean;
  notice: string | null;
  uncertainId: string | null;
}) {
  // Authorization revalidation hides even a previously supplied snapshot immediately.
  const visibleData = loading ? null : data;
  const items =
    visibleData?.items.filter((item) => item.status !== "disconnected") ?? [];
  if (!loading && !notice && !items.length) return null;
  return (
    <section className="min-w-0 space-y-2" aria-label="본인 연결 계좌">
      <SectionHeader
        title="내 연결 계좌"
        actionLabel="관리"
        actionHref="/more/connections"
      />
      <p className="text-caption text-muted-foreground -mt-2">
        나에게만 보이고 가족 합계에 더하지 않아요.
      </p>
      {notice ? (
        <p role="alert" className="text-body rounded-control bg-muted p-3">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-caption text-muted-foreground">
          연결 계좌를 확인하고 있어요.
        </p>
      ) : null}
      {busy && visibleData ? (
        <p role="status" className="sr-only">
          보유 주식을 새로 확인하고 있어요.
        </p>
      ) : null}
      {items.length ? (
        <div className="finance-panel divide-y divide-border/60 px-5">
          {items.map((item) => {
            const selected = item.accountOptions.find(
              (option) => option.id === item.selectedAccountId
            );
            const uncertain = uncertainId === item.id;
            const stale =
              hasPreviousSnapshot(item) || uncertain || !visibleData?.enabled;
            const fresh = item.status === "ready" && item.snapshot && !stale;
            const chip: [ChipTone, string] | null = uncertain
              ? ["attention", "조회 확인 필요"]
              : fresh
              ? null
              : item.status === "ready" && !item.snapshot
              ? ["neutral", "조회 전"]
              : item.status === "error" || item.status === "reauth_required"
              ? ["error", CONNECTION_STATUS[item.status]]
              : item.status === "ready"
              ? ["neutral", "이전 조회 내역"]
              : ["pending", CONNECTION_STATUS[item.status]];
            return (
              <article
                key={item.id}
                className="min-w-0 space-y-3 py-4"
                aria-label="연결 계좌 요약"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-body font-semibold">토스증권</h3>
                    {selected ? (
                      <p className="text-caption text-muted-foreground break-words">
                        {selected.label}
                      </p>
                    ) : null}
                  </div>
                  {chip ? (
                    <StatusChip tone={chip[0]}>{chip[1]}</StatusChip>
                  ) : null}
                </div>
                {item.errorCode ? (
                  <p className="text-caption text-muted-foreground">
                    {CONNECTION_ERROR[item.errorCode]}
                  </p>
                ) : null}
                {item.snapshot ? (
                  <>
                    {stale && chip?.[1] !== "이전 조회 내역" ? (
                      <p className="text-caption text-muted-foreground">
                        이전 조회 내역
                      </p>
                    ) : null}
                    <dl className="min-w-0 space-y-2">
                      {(["KRW", "USD"] as const).map((currency) => {
                        const total = item.snapshot!.totals.find(
                          (value) => value.currency === currency
                        );
                        return (
                          <div
                            key={currency}
                            className="flex min-w-0 items-baseline justify-between gap-3"
                          >
                            <dt className="text-body text-muted-foreground shrink-0">
                              {CURRENCY_LABEL[currency]}
                            </dt>
                            <dd
                              className={`min-w-0 break-all text-right tabular-nums ${
                                total
                                  ? "text-heading"
                                  : "text-body text-muted-foreground"
                              }`}
                            >
                              {total
                                ? connectionMoney(total.marketValue, currency)
                                : "조회 내역 없음"}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </>
                ) : (
                  <p className="text-body text-muted-foreground">
                    {item.status === "select_account"
                      ? "연결 관리에서 조회할 계좌를 선택해 주세요."
                      : "아직 보유 주식 조회 내역이 없어요."}
                  </p>
                )}
                <p className="text-micro text-muted-foreground">
                  마지막 조회 성공 {connectionTime(item.lastSuccessAt)}
                </p>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
