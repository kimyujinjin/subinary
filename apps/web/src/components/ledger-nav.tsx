"use client";
/**
 * 가계부 섹션 내비 — 거래 · 분석 · 예산 · 할 일.
 *
 * '할 일'이 여기 있는 이유: 하단 탭이 5개에서 3개로 줄면서 ADR-0031이 정한 '할 일'
 * 숫자 배지가 사라졌고, `/todo`는 홈 카드 링크와 설정 목록으로만 닿을 수 있게 됐다.
 * 그런데 `lib/nav-tabs.ts`는 여전히 `/todo`를 가계부 탭 소속으로 판정하므로, 사용자는
 * 그 화면에 있는 동안 자기 위치를 확인할 수 없었다. 탭 구조를 다시 바꾸면 같은 사람이
 * 탭을 두 번 배운다(ADR-0031) — 그래서 상단 섹션 내비에 넣는다.
 *
 * 배지 값은 `/todo` 화면과 같은 `useTodoCounts().total`을 쓴다. 세는 규칙을 화면마다
 * 다시 구현하면 배지와 목록의 숫자가 갈린다.
 */
import Link from "next/link";

import { useTodoCounts } from "@/components/widgets";
import { ledgerNavItems, type LedgerSection } from "@/lib/ledger-nav";
import { cn } from "@/lib/utils";

export function LedgerNav({
  active,
  month,
}: {
  active: LedgerSection;
  month?: string;
}) {
  // 폴링은 주지 않는다 — 홈이 이미 저빈도로 돌리고 있고 같은 queryKey를 공유한다.
  const todo = useTodoCounts();
  // 아직 다 못 읽었거나 읽기에 실패한 축이 있으면 숫자를 쓰지 않는다. 0이나 축소된
  // 숫자를 보여주면 사용자는 처리할 게 없다고 믿는다.
  const countKnown =
    !todo.declinesLoading &&
    !todo.reviewsLoading &&
    !todo.smsLoading &&
    !todo.unpostedLoading &&
    !todo.declinesError &&
    !todo.reviewsError &&
    !todo.smsError &&
    !todo.unpostedError;
  const pending = countKnown ? todo.total : 0;
  return (
    <nav
      aria-label="가계부 메뉴"
      className="grid min-w-0 grid-cols-4 gap-1 rounded-control bg-muted p-1"
    >
      {ledgerNavItems(month).map((item) => {
        const badge = item.key === "todo" && pending > 0;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            aria-label={
              badge
                ? `${item.label} ${pending.toLocaleString("ko-KR")}건`
                : undefined
            }
            className={cn(
              "text-body flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-sm px-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-2",
              active === item.key
                ? "bg-card text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50 font-medium"
            )}
          >
            <span className="min-w-0 truncate">{item.label}</span>
            {badge ? (
              <span
                aria-hidden="true"
                className="bg-destructive text-destructive-foreground flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-micro font-semibold tabular-nums"
              >
                {pending > 99 ? "99+" : pending}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
