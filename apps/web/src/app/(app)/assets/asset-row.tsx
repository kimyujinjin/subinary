import type { ManualAssetKind } from "@family/contracts";
import { HandCoins, PiggyBank, TrendingUp, Wallet } from "lucide-react";

import { displayManualKrw } from "@/components/manual-finance/model";
import { ListRow } from "@/components/widgets/list-row";
import { StatusChip } from "@/components/widgets/status-chip";

import type { RowChip } from "./asset-rows";

export interface AssetRowData {
  key: string;
  title: string;
  subtitle: string;
  amount: bigint | null;
  /** 합계에 들어가는 행인지(소계 계산용). */
  counted: boolean;
  /** 금액이 없을 때 글자. 기본은 `미입력`(직접 입력), 연결 계좌는 값을 기다리는 중이다. */
  emptyText?: string;
  chip: RowChip | null;
  /** 창을 여는 줄(직접 입력 자산). */
  onClick?: () => void;
  /** 다른 화면으로 가는 줄(내 연결 계좌·수정할 수 있는 가져온 대출). */
  href?: string;
}

const KIND_ICON: Record<ManualAssetKind, { icon: typeof Wallet; tone: string }> = {
  account: { icon: Wallet, tone: "bg-chart-1/12 text-chart-1" },
  saving: { icon: PiggyBank, tone: "bg-chart-2/12 text-chart-2" },
  stock: { icon: TrendingUp, tone: "bg-chart-5/12 text-chart-5" },
  loan: { icon: HandCoins, tone: "bg-chart-4/12 text-chart-4" },
};

/**
 * 자산 목록 한 줄(§8): 종류 아이콘 · 이름 · 주인 · 금액. 문제 있을 때만 칩을 붙인다.
 * 창을 여는 줄과 다른 화면으로 가는 줄은 ›를 달고, 누를 수 없는 줄(가족 연결 계좌·수정할 수 없는 대출)은
 * ›도 눌림도 없다 — 예전에는 모양이 같아 눌러도 아무 일 없는 줄을 구분할 수 없었다(2026-11-05 HIG 검수).
 */
export function AssetRow({ kind, row }: { kind: ManualAssetKind; row: AssetRowData }) {
  const { icon: Icon, tone } = KIND_ICON[kind];
  const amount =
    row.amount === null
      ? row.emptyText ?? "미입력"
      : displayManualKrw(row.amount.toString());
  return (
    <ListRow
      icon={<Icon aria-hidden="true" />}
      iconClassName={tone}
      title={row.title}
      subtitle={row.subtitle || undefined}
      // 합계에 들어가지 않는 금액·빈 값은 회색으로 낮춘다(이유는 칩이 글자로 말한다).
      value={
        row.counted && row.amount !== null ? (
          amount
        ) : (
          <span className="text-muted-foreground font-normal">{amount}</span>
        )
      }
      valueSub={
        row.chip ? (
          <StatusChip tone={row.chip[0]} className="whitespace-normal">
            {row.chip[1]}
          </StatusChip>
        ) : undefined
      }
      href={row.href}
      onClick={row.href ? undefined : row.onClick}
      chevron={Boolean(row.href ?? row.onClick)}
      className="-mx-2 w-[calc(100%+1rem)] px-2"
    />
  );
}
