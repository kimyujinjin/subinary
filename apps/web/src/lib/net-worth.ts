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
