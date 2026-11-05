import * as React from "react";
import type { ManualAssetSummary, ManualFinanceScope } from "@family/contracts";

import { CONNECTABLE_PROVIDERS } from "@/components/finance-connections/providers";
import { formatMonthDay, formatRelativeTime } from "@/lib/format";
import { computeNetWorth, type ConnectedHolding } from "@/lib/net-worth";
import { displayManualKrw } from "./model";

/**
 * 순자산 합계에 들어간 값의 출처. 출처마다 자기 시각을 붙인다 — 직접 입력은 기준일, 연결 계좌는 조회 시각,
 * 가져온 대출은 은행 잔액 기준일을 모른다는 사실(기준일은 계약 문구라 지우지 않는다, §3.5-5).
 * 예전에는 출처가 늘 '직접 입력'이어서 연결 계좌·가져온 대출이 합계에 들어가도 근거 문구가 틀렸다(2026-11-05 HIG 검수).
 */
export function netWorthSources({
  summary,
  holdings = [],
  hasImportedBalance = false,
  now = new Date(),
}: {
  summary: ManualAssetSummary;
  holdings?: readonly ConnectedHolding[];
  hasImportedBalance?: boolean;
  now?: Date;
}): string[] {
  const sources: string[] = [];
  // 금액이 있는 직접 입력 항목만 기준일을 가진다 — 기준일이 있으면 직접 입력 금액이 합계에 들어갔다는 뜻이다.
  const oldest = summary.oldestAsOfDate;
  const newest = summary.newestAsOfDate ?? oldest;
  if (oldest) {
    sources.push(
      summary.mixedAsOfDates && newest !== oldest
        ? `직접 입력 항목별 기준일 ${formatMonthDay(oldest, now)} ~ ${formatMonthDay(newest, now)}`
        : `직접 입력 기준일 ${formatMonthDay(oldest, now)}`
    );
  }
  for (const provider of CONNECTABLE_PROVIDERS) {
    // 금액이 있어 합계에 들어간 연결 계좌만 센다. 시각은 가장 오래된 조회 — 합계는 그보다 새롭지 않다.
    const observed = holdings
      .filter((holding) => holding.provider === provider.id && holding.totalKrw !== null)
      .map((holding) => holding.observedAt)
      .sort();
    if (!observed.length) continue;
    const when = formatRelativeTime(observed[0]);
    sources.push(when ? `${provider.label} ${when}` : provider.label);
  }
  if (hasImportedBalance) sources.push("가져온 신한 대출(은행 잔액 기준일 미확인)");
  return sources;
}

/**
 * 자산 요약(§8): 순자산 숫자 하나 + 자산·남은 대출 두 줄 + 출처 한 줄.
 * 종류별 구성은 바로 아래 목록의 묶음 머리 소계가 맡는다 — 요약에도 막대·비율·대출 목록을 그리면
 * 같은 숫자가 한 화면에 두 번 나오고 폰에서 목록이 첫 화면 밖으로 밀렸다(2026-11-05 HIG 검수).
 * 순자산은 입력된 값만으로 계산하고, 비어 있는 칸은 `미입력`으로 남긴다(0으로 보여주지 않는다).
 */
export function ManualAssetsSummary({
  summary,
  scope = "household",
  holdings = [],
  hasImportedBalance = false,
  hasUncountedRecords = false,
  unresolvedLoans = 0,
}: {
  summary: ManualAssetSummary;
  scope?: ManualFinanceScope;
  /** 자산 목록에 합친 연결 계좌(원화 환산 포함). */
  holdings?: readonly ConnectedHolding[];
  /** 가져온 대출이 합계에 들어갔는지. 들어갔으면 출처에 은행 잔액 기준일을 모른다고 적는다. */
  hasImportedBalance?: boolean;
  /**
   * 합계에 들어가지 않은 기록(예: '기록만 보관' 대출)이 목록에 있는지. 서버는 이런 기록만 있으면
   * completeness를 'empty'로 두는데, 그때 '등록된 자산이 없어요'라고 하면 바로 아래 목록과 어긋난다.
   */
  hasUncountedRecords?: boolean;
  /** 확인이 필요해 합계에서 뺀 가져온 대출 수. 서버는 이것만으로도 대출을 'partial'로 둔다. */
  unresolvedLoans?: number;
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
        <p className="text-heading mt-1">
          {/* 금액 없이 등록한 자산·합계 밖 기록만 있을 때 '없어요'라고 하면 아래 목록과 어긋난다. */}
          {summary.completeness === "empty" && !holdings.length && !hasUncountedRecords
            ? "등록된 자산이 없어요"
            : "합계에 넣을 금액이 아직 없어요"}
        </p>
      </section>
    );
  }
  const rows: Array<[string, bigint | null]> = [
    [
      summary.assetsCompleteness === "partial" ? "자산 (일부 입력)" : "자산",
      worth.assets,
    ],
    [
      // 이름은 늘 '남은 대출'. 부분 표시는 원인대로 — 확인 필요 대출을 뺐으면 빈칸이 없어도 'partial'이라
      // '일부 입력'이라고 하면 원인을 잘못 말한다.
      summary.debtCompleteness !== "partial"
        ? "남은 대출"
        : unresolvedLoans > 0
          ? "남은 대출 (일부만 합산)"
          : "남은 대출 (일부 입력)",
      worth.debt,
    ],
  ];
  const sources = netWorthSources({ summary, holdings, hasImportedBalance });
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
      {sources.length ? (
        <p className="text-micro text-muted-foreground mt-3 break-words">
          {sources.join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
