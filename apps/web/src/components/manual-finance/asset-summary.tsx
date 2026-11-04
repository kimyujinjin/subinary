import * as React from "react";
import type { ManualAssetSummary, ManualFinanceScope } from "@family/contracts";

import { computeNetWorth, type ConnectedHolding } from "@/lib/net-worth";
import { displayManualKrw } from "./model";

/**
 * 자산 요약(§8): 순자산 숫자 하나 + 자산·대출 두 줄.
 * 순자산은 입력된 값만으로 계산하고, 비어 있는 칸은 `미입력`으로 남긴다(0으로 보여주지 않는다).
 */
export function ManualAssetsSummary({
  summary,
  scope = "household",
  holdings = [],
  sourceLabel = "직접 입력",
  hasImportedBalance = false,
}: {
  summary: ManualAssetSummary;
  scope?: ManualFinanceScope;
  /** 자산 목록에 합친 연결 계좌(원화 환산 포함). */
  holdings?: readonly ConnectedHolding[];
  /** 기준일 옆에 붙는 출처(예: 직접 입력). */
  sourceLabel?: string;
  /** 가져온 대출이 합계에 들어가면 은행 잔액 기준일을 알 수 없다고 표시한다. */
  hasImportedBalance?: boolean;
}) {
  const worth = computeNetWorth(summary, holdings);
  if (worth.net === null) {
    return (
      <section
        className="finance-panel min-w-0 px-5 py-5"
        aria-label="등록한 자산 요약"
      >
        <h2 className="text-caption text-muted-foreground">
          {scope === "household" ? "순자산" : "나만 보는 자산"}
        </h2>
        <p className="text-heading mt-1">등록된 자산이 없어요</p>
      </section>
    );
  }
  // 기준일은 계약 문구라 지우지 않고 가장 작은 글씨로 남긴다(§3.5-5).
  const range = hasImportedBalance
    ? "은행 잔액 기준일 미확인"
    : summary.mixedAsOfDates
    ? `항목별 기준일 ${summary.oldestAsOfDate ?? "미입력"} ~ ${summary.newestAsOfDate ?? "미입력"}`
    : summary.asOfDate
    ? `기준일 ${summary.asOfDate}`
    : null;
  const rows: Array<[string, bigint | null]> = [
    [
      summary.assetsCompleteness === "partial" ? "자산 (일부 입력)" : "자산",
      worth.assets,
    ],
    [
      summary.debtCompleteness === "partial" ? "대출 (일부 입력)" : "남은 대출",
      worth.debt,
    ],
  ];
  return (
    <section
      className="finance-panel min-w-0 px-5 py-5"
      aria-label="등록한 자산 요약"
    >
      <h2 className="text-caption text-muted-foreground">
        {scope === "household" ? "순자산" : "나만 보는 자산"}
      </h2>
      <p className="text-display mt-1 min-w-0 break-all tracking-tight tabular-nums">
        {displayManualKrw(worth.net.toString())}
      </p>
      <dl className="mt-3 min-w-0 space-y-1.5">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 items-baseline justify-between gap-3"
          >
            <dt className="text-body text-muted-foreground shrink-0">
              {label}
            </dt>
            <dd
              className={`text-body min-w-0 break-all text-right tabular-nums ${
                value === null ? "text-muted-foreground" : "font-semibold"
              }`}
            >
              {value === null ? "미입력" : displayManualKrw(value.toString())}
            </dd>
          </div>
        ))}
      </dl>
      {range ? (
        <p className="text-micro text-muted-foreground mt-3 break-words">
          {range} · {sourceLabel}
        </p>
      ) : null}
    </section>
  );
}
