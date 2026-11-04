"use client";

import type { ReactNode } from "react";

import { LedgerNav } from "@/components/ledger-nav";
import type { LedgerSection } from "@/lib/ledger-nav";

/**
 * 가계부 네 화면(거래·분석·예산·할 일)의 공통 머리(§5 가계부).
 * 화면마다 제목·설명·버튼 모양이 달라 같은 탭 안에서도 다른 앱처럼 보였다 —
 * 제목은 `가계부` 하나, 화면별 행동은 오른쪽 아이콘 버튼 하나만 둔다.
 */
export function LedgerHeader({
  active,
  month,
  action,
}: {
  active: LedgerSection;
  month?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex min-h-11 items-center justify-between gap-3">
        <h1 className="text-title">가계부</h1>
        {action}
      </header>
      <LedgerNav active={active} month={month} />
    </div>
  );
}
