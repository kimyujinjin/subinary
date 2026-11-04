import * as React from "react";
import type { ManualAssetSummary, ManualFinanceScope } from "@family/contracts";

import { computeNetWorth, type AssetBreakdown, type BreakdownPart, type ConnectedHolding } from "@/lib/net-worth";
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
  breakdown,
}: {
  summary: ManualAssetSummary;
  scope?: ManualFinanceScope;
  /** 자산 목록에 합친 연결 계좌(원화 환산 포함). */
  holdings?: readonly ConnectedHolding[];
  /** 기준일 옆에 붙는 출처(예: 직접 입력). */
  sourceLabel?: string;
  /** 가져온 대출이 합계에 들어가면 은행 잔액 기준일을 알 수 없다고 표시한다. */
  hasImportedBalance?: boolean;
  /** 항목별 구성. 합이 요약 합계와 다르면 그리지 않는다(맞지 않는 표를 보여주지 않는다). */
  breakdown?: AssetBreakdown;
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
  const consistent =
    breakdown !== undefined &&
    breakdown.assetsTotal === worth.assets &&
    breakdown.debtsTotal === worth.debt;
  const max = [worth.assets, worth.debt].reduce<bigint>((m, v) => (v !== null && v > m ? v : m), 0n);
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
      {consistent ? (
        <div className="mt-5 space-y-5">
          <BreakdownGroup title={rows[0][0]} total={worth.assets} max={max} parts={breakdown.assets} palette={ASSET_COLORS} />
          <BreakdownGroup title={rows[1][0]} total={worth.debt} max={max} parts={breakdown.debts} palette={DEBT_COLORS} />
        </div>
      ) : (
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
      )}
      {range ? (
        <p className="text-micro text-muted-foreground mt-3 break-words">
          {range} · {sourceLabel}
        </p>
      ) : null}
    </section>
  );
}

const ASSET_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-5"];
const DEBT_COLORS = ["bg-chart-4", "bg-chart-3", "bg-chart-4/60", "bg-chart-3/60"];

function percentOf(part: bigint, total: bigint): string {
  if (total <= 0n) return "";
  const tenths = (part * 1000n + total / 2n) / total;
  return `${tenths / 10n}.${tenths % 10n}%`;
}

/**
 * 자산·대출 한 묶음: 합계 + 막대(길이는 자산·대출 중 큰 쪽 기준, 안은 항목별 색) + 항목별 금액·비율.
 * 금액이 비어 있는 항목은 막대에 넣지 않고 `미입력 N건`으로 적는다.
 */
function BreakdownGroup({
  title,
  total,
  max,
  parts,
  palette,
}: {
  title: string;
  total: bigint | null;
  max: bigint;
  parts: BreakdownPart[];
  palette: string[];
}) {
  const known = parts.filter((part) => part.amount !== null && part.amount > 0n);
  // 막대는 이 묶음만의 구성이다 — 폭 전체를 100%로 쓰고 칸 길이 = 옆에 적은 비율.
  // (예전에는 자산·대출 중 큰 쪽 기준으로 막대를 줄여, 칸 길이와 비율이 어긋나 보였다.)
  const width = known.length ? 100 : 0;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="text-body font-semibold">{title}</span>
        <span className={`text-body min-w-0 break-all text-right tabular-nums ${total === null ? "text-muted-foreground" : "font-semibold"}`}>
          {total === null ? "미입력" : displayManualKrw(total.toString())}
        </span>
      </div>
      {known.length ? (
        <div className="bg-muted mt-2 h-2.5 overflow-hidden rounded-full" aria-hidden="true">
          <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${width}%` }}>
            {known.map((part, index) => (
              <span
                key={part.key}
                className={`${palette[index % palette.length]} h-full`}
                style={{ width: `${Number((part.amount! * 1000n) / (total ?? 1n)) / 10}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}
      <ul className="mt-2 space-y-1">
        {parts.map((part) => {
          const index = known.indexOf(part);
          return (
            <li key={part.key} className="text-caption flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${index >= 0 ? palette[index % palette.length] : "bg-muted"}`}
              />
              <span className="text-muted-foreground min-w-0 flex-1 truncate">
                {part.label}
                {part.missing > 0 ? ` · 미입력 ${part.missing}건` : ""}
              </span>
              <span className="tabular-nums">
                {part.amount === null ? "—" : displayManualKrw(part.amount.toString())}
              </span>
              <span className="text-muted-foreground w-12 shrink-0 text-right tabular-nums">
                {part.amount !== null && total !== null ? percentOf(part.amount, total) : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
