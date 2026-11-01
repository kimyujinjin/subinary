import * as React from "react";
import type { ManualAssetSummary, ManualFinanceScope } from "@family/contracts";
import { displayManualKrw } from "./model";

export function ManualAssetsSummary({
  summary,
  scope = "household",
}: {
  summary: ManualAssetSummary;
  scope?: ManualFinanceScope;
}) {
  const range = summary.mixedAsOfDates
    ? `기준일 혼재 · ${summary.oldestAsOfDate ?? "미입력"} ~ ${
        summary.newestAsOfDate ?? "미입력"
      }`
    : `기준일 ${summary.asOfDate ?? "미입력"}`;
  return (
    <section
      className="bg-primary text-primary-foreground min-w-0 rounded-2xl p-5 sm:p-6"
      aria-label="입력한 자산 요약"
    >
      <p className="text-sm opacity-85">
        {scope === "household" ? "공유한 수동 기록" : "내 비공개 수동 기록"}
      </p>
      <h2 className="mt-3 text-sm font-medium">입력한 순자산</h2>
      <p className="mt-2 break-all text-3xl font-bold tabular-nums sm:text-4xl">
        {displayManualKrw(summary.netAssets)}
      </p>
      <p className="mt-2 text-xs leading-relaxed opacity-85">
        자산과 대출의 값이 모두 입력된 경우에만 계산해요. 실제 전체 재산을
        뜻하지 않아요.
      </p>
      <dl className="mt-5 grid min-w-0 grid-cols-2 gap-4 border-t border-current/20 pt-4 text-sm">
        <div className="min-w-0">
          <dt className="text-xs opacity-85">
            {summary.assetsCompleteness === "partial"
              ? "알려진 자산 부분합"
              : "입력한 자산"}
          </dt>
          <dd className="mt-1 break-all font-semibold tabular-nums">
            {displayManualKrw(summary.grossAssets)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs opacity-85">
            {summary.debtCompleteness === "partial"
              ? "알려진 대출 부분합"
              : "입력한 대출 원금"}
          </dt>
          <dd className="mt-1 break-all font-semibold tabular-nums">
            {displayManualKrw(summary.debt)}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs leading-relaxed opacity-85">
        {range} · 직접 입력
        {summary.completeness !== "complete"
          ? " · 일부 또는 전체 값 미입력"
          : ""}
      </p>
    </section>
  );
}
