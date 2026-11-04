import type {
  FinanceConnectionList,
  FxReference,
  ManualAssetSummary,
} from "@family/contracts";

import { convertToKrw } from "./fx-client";

/** 자산 목록에 섞어 보여줄 연결 계좌 한 건(원화 환산 포함). */
export interface ConnectedHolding {
  id: string;
  label: string;
  /** 원화 평가액(원 단위). 값이 없으면 null. */
  krw: string | null;
  /** 달러 평가액(10진 문자열). 값이 없으면 null. */
  usd: string | null;
  /** 달러를 원화로 바꾼 값. 환율이 없으면 null — 합계에 넣지 않는다. */
  usdInKrw: bigint | null;
  /** 원화 + 환산 달러. 둘 다 없으면 null. */
  totalKrw: bigint | null;
  /** 마지막 성공 조회 이후 실패·불명·서비스 중지로 이전 값을 보여주는 중. */
  stale: boolean;
}

function wonOf(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const whole = BigInt(match[2]);
  const roundUp = (match[3] ?? "0")[0] >= "5" ? 1n : 0n;
  return match[1] ? -(whole + roundUp) : whole + roundUp;
}

/** 토스증권 연결을 자산 목록 행으로 바꾼다. 해제된 연결과 조회 전 연결은 뺀다. */
export function connectedHoldings(
  data: FinanceConnectionList | null,
  fx: FxReference | undefined,
  uncertainId: string | null = null
): ConnectedHolding[] {
  if (!data) return [];
  return data.items
    .filter((item) => item.status !== "disconnected" && item.snapshot)
    .map((item) => {
      const totals = item.snapshot!.totals;
      const krwValue =
        totals.find((total) => total.currency === "KRW")?.marketValue ?? null;
      const usdValue =
        totals.find((total) => total.currency === "USD")?.marketValue ?? null;
      const krw = krwValue === null ? null : wonOf(krwValue);
      const usdInKrw =
        usdValue !== null && fx?.rate ? convertToKrw(usdValue, fx.rate) : null;
      const totalKrw =
        krw === null && usdInKrw === null
          ? null
          : (krw ?? 0n) + (usdInKrw ?? 0n);
      const selected = item.accountOptions.find(
        (option) => option.id === item.selectedAccountId
      );
      return {
        id: item.id,
        label:
          selected?.label && selected.label !== "선택한 계좌"
            ? `토스증권 · ${selected.label}`
            : "토스증권",
        krw: krw === null ? null : krw.toString(),
        usd: usdValue,
        usdInKrw,
        totalKrw,
        stale:
          item.status !== "ready" || uncertainId === item.id || !data.enabled,
      };
    });
}

export interface NetWorth {
  /** 입력된 자산 + 연결 계좌(원 단위). 아무것도 없으면 null. */
  assets: bigint | null;
  /** 남은 대출(원 단위). 입력이 없으면 null. */
  debt: bigint | null;
  /** 입력된 값만으로 계산한 순자산. 자산·대출이 모두 없으면 null. */
  net: bigint | null;
  /** 자산 칸 중 비어 있는 것이 있다(입력된 값만으로 계산했다는 뜻). */
  partial: boolean;
}

/**
 * 순자산은 **입력된 값만으로** 계산한다(사용자 결정, docs/ux-renewal-2026-11.md §8).
 * 비어 있는 칸은 계산에서 빠질 뿐 0으로 "입력"된 것이 아니다 — 그래서 화면은 비어 있는
 * 칸을 `미입력`으로 계속 보여준다.
 */
export function computeNetWorth(
  summary: ManualAssetSummary | undefined,
  holdings: readonly ConnectedHolding[]
): NetWorth {
  const connected = holdings.reduce<bigint | null>(
    (sum, holding) =>
      holding.totalKrw === null ? sum : (sum ?? 0n) + holding.totalKrw,
    null
  );
  const gross =
    summary?.grossAssets == null ? null : BigInt(summary.grossAssets);
  const debt = summary?.debt == null ? null : BigInt(summary.debt);
  const assets =
    gross === null && connected === null
      ? null
      : (gross ?? 0n) + (connected ?? 0n);
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

const KIND_LABEL = { account: "통장·현금", saving: "적금", stock: "주식" } as const;

/**
 * 순자산이 어떻게 계산됐는지 보여주는 구성(§8 자산).
 * 자산은 종류별(통장·현금·적금·주식 — 연결 계좌는 주식에 포함), 대출은 항목별로 묶는다.
 * 합 규칙은 서버 요약과 같다: 금액이 비어 있는 항목은 0이 아니라 '빠진 항목'으로 센다.
 */
export function assetBreakdown(
  manualItems: ReadonlyArray<{ id: string; kind: "account" | "saving" | "stock" | "loan"; label: string; amount: string | null }>,
  loanItems: ReadonlyArray<{ id: string; label: string; outstandingPrincipalKrw: string; includedInTotals: boolean; totalMode?: string | null; replacesManualAssetId?: string | null }>,
  holdings: readonly ConnectedHolding[]
): AssetBreakdown {
  const replaced = new Set(
    loanItems.filter((loan) => loan.includedInTotals && loan.totalMode === "replacement").map((loan) => loan.replacesManualAssetId)
  );
  const add = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a + b);
  const assets = (["account", "saving", "stock"] as const)
    .map((kind): BreakdownPart => {
      const rows = manualItems.filter((item) => item.kind === kind);
      let amount = rows.reduce<bigint | null>((sum, item) => add(sum, item.amount === null ? null : BigInt(item.amount)), null);
      if (kind === "stock") for (const holding of holdings) amount = add(amount, holding.totalKrw);
      return { key: kind, label: KIND_LABEL[kind], amount, missing: rows.filter((item) => item.amount === null).length };
    })
    .filter((part) => part.amount !== null || part.missing > 0);
  const debts: BreakdownPart[] = [
    ...manualItems
      .filter((item) => item.kind === "loan" && !replaced.has(item.id))
      .map((item) => ({ key: item.id, label: item.label, amount: item.amount === null ? null : BigInt(item.amount), missing: item.amount === null ? 1 : 0 })),
    ...loanItems
      .filter((loan) => loan.includedInTotals)
      .map((loan) => ({ key: loan.id, label: loan.label, amount: BigInt(loan.outstandingPrincipalKrw), missing: 0 })),
  ];
  const total = (parts: BreakdownPart[]) => parts.reduce<bigint | null>((sum, part) => add(sum, part.amount), null);
  return { assets, debts, assetsTotal: total(assets), debtsTotal: total(debts) };
}
