import * as React from "react";
import type { ManualAssetSummary, ManualFinanceScope } from "@family/contracts";

import { StatusChip } from "@/components/widgets/status-chip";
import { displayManualKrw } from "./model";

/**
 * 자산 요약(§5 자산 3): 대표 숫자 하나. 순자산을 계산할 수 없으면 숫자를 만들지 않고
 * `계산 전` 칩과 함께 아는 값만 보여준다(미입력은 0이 아니다).
 */
export function ManualAssetsSummary({
  summary,
  scope = "household",
  sourceLabel = "직접 입력",
  hasImportedBalance = false,
}: {
  summary: ManualAssetSummary;
  scope?: ManualFinanceScope;
  sourceLabel?: string;
  hasImportedBalance?: boolean;
}) {
  const scopeLabel =
    scope === "household" ? "가족과 공유한 자산" : "나만 보는 자산";
  if (summary.completeness === "empty") {
    return (
      <section
        className="finance-panel min-w-0 p-5"
        aria-label="등록한 자산 요약"
      >
        <h2 className="text-caption text-muted-foreground">{scopeLabel}</h2>
        <p className="text-heading mt-2">등록된 자산이 없어요</p>
        <p className="text-caption text-muted-foreground mt-1">
          통장·적금·주식·대출을 추가해 보세요.
        </p>
      </section>
    );
  }
  const range = hasImportedBalance
    ? "은행 잔액 기준일 미확인"
    : summary.mixedAsOfDates
    ? `항목별 기준일 ${summary.oldestAsOfDate ?? "미입력"} ~ ${
        summary.newestAsOfDate ?? "미입력"
      }`
    : `기준일 ${summary.asOfDate ?? "미입력"}`;
  const netKnown =
    summary.completeness === "complete" && summary.netAssets !== null;
  const rows: Array<[string, string | null]> = [
    [
      summary.assetsCompleteness === "partial"
        ? "자산 (일부 입력)"
        : "등록한 자산",
      summary.grossAssets,
    ],
    [
      summary.debtCompleteness === "partial" ? "대출 (일부 입력)" : "남은 대출",
      summary.debt,
    ],
  ];
  return (
    <section
      className="finance-panel min-w-0 p-5"
      aria-label="등록한 자산 요약"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-caption text-muted-foreground">
          {netKnown ? `순자산 · ${scopeLabel}` : scopeLabel}
        </h2>
        {netKnown ? null : (
          <StatusChip tone="pending">순자산 계산 전</StatusChip>
        )}
      </div>
      {netKnown ? (
        <p className="text-display mt-1 min-w-0 break-all tracking-tight tabular-nums">
          {displayManualKrw(summary.netAssets)}
        </p>
      ) : null}
      <dl className={`min-w-0 space-y-2 ${netKnown ? "mt-4" : "mt-3"}`}>
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 items-baseline justify-between gap-3"
          >
            <dt className="text-body text-muted-foreground shrink-0">
              {label}
            </dt>
            <dd
              className={`min-w-0 break-all text-right tabular-nums ${
                value === null
                  ? "text-body text-muted-foreground"
                  : netKnown
                  ? "text-body font-semibold"
                  : "text-heading"
              }`}
            >
              {value === null ? "미입력" : displayManualKrw(value)}
            </dd>
          </div>
        ))}
      </dl>
      {netKnown ? null : (
        <p className="text-caption text-muted-foreground mt-3">
          미입력 금액이 있어 순자산은 아직 계산하지 않았어요.
        </p>
      )}
      <p className="text-micro text-muted-foreground mt-3 break-words">
        {range} · {sourceLabel}
      </p>
    </section>
  );
}
