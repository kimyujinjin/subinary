import type {
  ConnectedAccountHolding,
  FxReference,
  ManualAssetSummary,
} from "@family/contracts";

import { convertToKrw } from "./fx-client";

/** 자산 목록·합계에 섞어 보여줄 연결 계좌 한 건(원화 환산 포함). */
export interface ConnectedHolding {
  id: string;
  /** 자산 화면 묶음: 통장 / 주식 / 대출. */
  kind: "account" | "stock" | "loan";
  provider: "toss_securities" | "shinhan_bank";
  label: string;
  ownerName: string;
  own: boolean;
  /** 조회 시각(UTC ISO). 목록에 기준일로 보여준다. */
  observedAt: string;
  /** 원화 금액(원 단위). 값이 없으면 null. */
  krw: string | null;
  /** 달러 금액(10진 문자열). 값이 없으면 null. */
  usd: string | null;
  /** 달러를 원화로 바꾼 값. 환율이 없으면 null — 합계에 넣지 않는다. */
  usdInKrw: bigint | null;
  /** 원화 + 환산 달러. 둘 다 없으면 null. */
  totalKrw: bigint | null;
  stale: boolean;
}

function wonOf(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const whole = BigInt(match[2]);
  const roundUp = (match[3] ?? "0")[0] >= "5" ? 1n : 0n;
  return match[1] ? -(whole + roundUp) : whole + roundUp;
}

/** 서버 연결 계좌(본인 + 공유에 동의한 가족) → 화면 행. 달러는 기준환율로 원화 환산한다. */
export function toHoldings(
  items: readonly ConnectedAccountHolding[] | undefined,
  fx: FxReference | undefined
): ConnectedHolding[] {
  return (items ?? []).map((item) => {
    const krw = item.krw === null ? null : wonOf(item.krw);
    const usdInKrw =
      item.usd !== null && fx?.rate ? convertToKrw(item.usd, fx.rate) : null;
    const totalKrw =
      krw === null && usdInKrw === null ? null : (krw ?? 0n) + (usdInKrw ?? 0n);
    return {
      id: item.id,
      kind: item.kind,
      provider: item.provider,
      label: item.label,
      ownerName: item.ownerName,
      own: item.own,
      observedAt: item.observedAt,
      krw: krw === null ? null : krw.toString(),
      usd: item.usd,
      usdInKrw,
      totalKrw,
      stale: item.stale,
    };
  });
}

export interface NetWorth {
  /** 입력된 자산 + 연결 계좌(원 단위). 아무것도 없으면 null. */
  assets: bigint | null;
  /** 입력된 대출 + 연결 대출(원 단위). 아무것도 없으면 null. */
  debt: bigint | null;
  /** 입력된 값만으로 계산한 순자산. 자산·대출이 모두 없으면 null. */
  net: bigint | null;
  /** 자산 칸 중 비어 있는 것이 있다(입력된 값만으로 계산했다는 뜻). */
  partial: boolean;
}

const add = (a: bigint | null, b: bigint | null) =>
  a === null ? b : b === null ? a : a + b;

/**
 * 순자산은 **입력된 값만으로** 계산한다(docs/ux-renewal-2026-11.md §8).
 * 비어 있는 칸은 계산에서 빠질 뿐 0으로 "입력"된 것이 아니다 — 화면은 `미입력`으로 계속 보여준다.
 */
export function computeNetWorth(
  summary: ManualAssetSummary | undefined,
  holdings: readonly ConnectedHolding[]
): NetWorth {
  const sum = (match: (h: ConnectedHolding) => boolean) =>
    holdings
      .filter(match)
      .reduce<bigint | null>((total, h) => add(total, h.totalKrw), null);
  const gross =
    summary?.grossAssets == null ? null : BigInt(summary.grossAssets);
  const debtManual = summary?.debt == null ? null : BigInt(summary.debt);
  const assets = add(
    gross,
    sum((h) => h.kind !== "loan")
  );
  const debt = add(
    debtManual,
    sum((h) => h.kind === "loan")
  );
  const net =
    assets === null && debt === null ? null : (assets ?? 0n) - (debt ?? 0n);
  const partial = Boolean(
    summary &&
      summary.completeness !== "complete" &&
      summary.completeness !== "empty"
  );
  return { assets, debt, net, partial };
}

export interface BreakdownPart {
  key: string;
  label: string;
  /** 원 단위 합. 이 묶음에 금액이 하나도 없으면 null. */
  amount: bigint | null;
  /** 금액이 비어 있어 합계에서 빠진 항목 수. */
  missing: number;
}

export interface AssetBreakdown {
  assets: BreakdownPart[];
  debts: BreakdownPart[];
  assetsTotal: bigint | null;
  debtsTotal: bigint | null;
}

const KIND_LABEL = {
  account: "통장",
  saving: "적금",
  stock: "주식",
} as const;

/**
 * 순자산이 어떻게 계산됐는지 보여주는 구성(§8 자산).
 * 자산은 종류별(연결 통장은 통장, 연결 증권은 주식에 포함), 대출은 항목별로 묶는다.
 * 합 규칙은 서버 요약과 같다: 금액이 비어 있는 항목은 0이 아니라 '빠진 항목'으로 센다.
 */
export function assetBreakdown(
  manualItems: ReadonlyArray<{
    id: string;
    kind: "account" | "saving" | "stock" | "loan";
    label: string;
    amount: string | null;
  }>,
  loanItems: ReadonlyArray<{
    id: string;
    label: string;
    outstandingPrincipalKrw: string;
    includedInTotals: boolean;
    totalMode?: string | null;
    replacesManualAssetId?: string | null;
  }>,
  holdings: readonly ConnectedHolding[]
): AssetBreakdown {
  const replaced = new Set(
    loanItems
      .filter(
        (loan) => loan.includedInTotals && loan.totalMode === "replacement"
      )
      .map((loan) => loan.replacesManualAssetId)
  );
  const assets = (["account", "saving", "stock"] as const)
    .map((kind): BreakdownPart => {
      const rows = manualItems.filter((item) => item.kind === kind);
      let amount = rows.reduce<bigint | null>(
        (sum, item) =>
          add(sum, item.amount === null ? null : BigInt(item.amount)),
        null
      );
      for (const holding of holdings)
        if (holding.kind === kind) amount = add(amount, holding.totalKrw);
      return {
        key: kind,
        label: KIND_LABEL[kind],
        amount,
        missing: rows.filter((item) => item.amount === null).length,
      };
    })
    .filter((part) => part.amount !== null || part.missing > 0);
  const debts: BreakdownPart[] = [
    ...manualItems
      .filter((item) => item.kind === "loan" && !replaced.has(item.id))
      .map((item) => ({
        key: item.id,
        label: item.label,
        amount: item.amount === null ? null : BigInt(item.amount),
        missing: item.amount === null ? 1 : 0,
      })),
    ...loanItems
      .filter((loan) => loan.includedInTotals)
      .map((loan) => ({
        key: loan.id,
        label: loan.label,
        amount: BigInt(loan.outstandingPrincipalKrw),
        missing: 0,
      })),
    ...holdings
      .filter((holding) => holding.kind === "loan")
      .map((holding) => ({
        key: holding.id,
        label: holding.own
          ? holding.label
          : `${holding.label} · ${holding.ownerName}`,
        amount: holding.totalKrw,
        missing: holding.totalKrw === null ? 1 : 0,
      })),
  ];
  const total = (parts: BreakdownPart[]) =>
    parts.reduce<bigint | null>((sum, part) => add(sum, part.amount), null);
  return {
    assets,
    debts,
    assetsTotal: total(assets),
    debtsTotal: total(debts),
  };
}
