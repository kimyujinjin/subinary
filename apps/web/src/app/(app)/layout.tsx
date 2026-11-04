"use client";
/** 하단 탭 4개(홈·가계부·자산·전체). 설정은 '전체' 탭이다 — ADR-0037. */
import { Bell, Home, Landmark, LayoutGrid, Receipt, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

import { AppReadinessBoundary } from "@/components/app-readiness-boundary";
import {
  ActivityProvider,
  useActivityStore,
} from "@/components/activity-provider";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { HouseholdSwitcher } from "@/components/household-switcher";
import { activeTabFor, PRIMARY_TABS, type TabKey } from "@/lib/nav-tabs";
import { useUnreadCount } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface NavItem {
  key: TabKey;
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ICONS: Readonly<Record<TabKey, LucideIcon>> = {
  home: Home,
  assets: Landmark,
  ledger: Receipt,
  all: LayoutGrid,
};
const NAV_ITEMS: ReadonlyArray<NavItem> = PRIMARY_TABS.map((tab) => ({
  ...tab,
  icon: NAV_ICONS[tab.key],
}));

function BrandMark() {
  return (
    <Link
      href="/dashboard"
      aria-label="모아 홈"
      className="text-primary flex min-h-11 min-w-11 shrink-0 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="text-title font-extrabold tracking-[-0.07em]">
        모아
      </span>
    </Link>
  );
}

/** 헤더 알림 벨 + 안읽음 뱃지. 탭 → /notifications. */
function NotificationBell() {
  const { data } = useUnreadCount();
  const count = data?.count ?? 0;
  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `알림 ${count}건` : "알림"}
      // 헤더 아이콘은 배경 없이 아이콘 24 + 터치 44(docs/ux-renewal-2026-11.md §3.3).
      className="text-foreground/80 hover:text-foreground relative -mr-2 flex size-11 items-center justify-center transition-colors"
    >
      <Bell className="size-6" strokeWidth={1.8} aria-hidden="true" />
      {count > 0 ? (
        <span className="bg-destructive text-destructive-foreground text-micro absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-semibold">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}

function NavigationItem({
  item,
  active,
  dot = false,
}: {
  item: NavItem;
  active: boolean;
  dot?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-micro flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-control px-1 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-12 lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:py-3 lg:text-sm",
        active
          ? "text-foreground font-semibold lg:bg-muted"
          : "text-muted-foreground/80 hover:text-foreground lg:hover:bg-muted"
      )}
    >
      <span className="relative flex h-8 w-11 shrink-0 items-center justify-center lg:h-auto lg:w-auto">
        <Icon
          className="size-6"
          strokeWidth={active ? 2.2 : 1.7}
          aria-hidden="true"
        />
        {dot ? (
          <span
            aria-label="새 거래가 있어요"
            className="bg-accent-foreground ring-background absolute top-0 right-2 size-2 rounded-full ring-2 lg:-top-0.5 lg:-right-1"
          />
        ) : null}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

/** Mobile bottom tabs and a desktop rail share labels, destinations and order. */
function PrimaryNav({ pathname }: { pathname: string }) {
  const activeTab = activeTabFor(pathname);
  const unseenCount = useActivityStore((s) => s.unseenCount);
  return (
    <nav
      aria-label="주 메뉴"
      data-bottom-nav
      className="bg-card/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[var(--safe-bottom)] backdrop-blur lg:inset-x-auto lg:top-[var(--app-header-h)] lg:bottom-0 lg:left-0 lg:w-52 lg:border-r lg:border-t-0 lg:bg-card lg:p-4"
    >
      <div className="mx-auto grid h-16 w-full max-w-lg grid-cols-4 items-center lg:h-auto lg:grid-cols-1 lg:gap-2">
        {NAV_ITEMS.map((item) => (
          <NavigationItem
            key={item.href}
            item={item}
            active={activeTab === item.key}
            dot={item.key === "ledger" && unseenCount > 0}
          />
        ))}
      </div>
    </nav>
  );
}

function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#app-main"
        className="sr-only z-50 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-lg focus:bg-background focus:p-3 focus:shadow-lg"
      >
        본문으로 건너뛰기
      </a>
      {/* 웹과 Android가 제공하는 안전 영역을 셸 치수와 동일하게 반영한다. */}
      <header className="bg-background/95 sticky top-0 z-30 pt-[var(--safe-top)] backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-2 px-4 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <BrandMark />
            <HouseholdSwitcher />
          </div>
          <div className="flex shrink-0 items-center">
            <NotificationBell />
          </div>
        </div>
      </header>

      <PrimaryNav pathname={pathname} />

      {/* 하단 탭바 높이(safe-area 포함)만큼 pb 확보 + 여유 1.5rem.
          고정값(pb-28=112px)은 iPhone(inset 34px)에서 탭바 총높이(114px)보다 작아
          마지막 콘텐츠가 탭바 밑에 깔렸다 — 변수 참조로 기기별 편차를 흡수한다. */}
      {/* 당겨서 새로고침 — 화면의 활성 쿼리만 다시 가져온다(전역 1회 배선). */}
      {/* 본문 폭은 **화면이 아니라 콘텐츠 종류**가 정한다. 여기 `max-w-6xl`은 바깥
          한계일 뿐이고, 화면마다 아래 둘 중 하나를 직접 선언한다:
            · `max-w-2xl` — 목록·폼·상세(기본). 한 줄을 눈으로 훑을 수 있는 폭이다.
            · `max-w-4xl` — 2열 그리드를 가진 요약 대시보드(`/dashboard`)만.
          선언을 빠뜨리면 이 6xl이 적용돼 **탭을 옮길 때 본문 폭이 점프한다** —
          실제로 6개 화면이 그 상태였다. 새 화면은 반드시 하나를 고를 것. */}
      <main
        id="app-main"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 pt-5 pb-[calc(var(--app-tabbar-h)+1.5rem)] focus:outline-none lg:ml-52 lg:px-8 lg:pt-6 lg:pb-8"
      >
        <PullToRefresh>
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </PullToRefresh>
      </main>

      {/* 전역 결제 활동 레이어 — SSE/폴링으로 새 거래를 감지해 무효화+토스트+배지. */}
      <ActivityProvider />
    </div>
  );
}

/** 금융 셸은 인증·가구 준비가 끝난 뒤에만 마운트한다. */
export default function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <AppReadinessBoundary>
      <AppShell>{children}</AppShell>
    </AppReadinessBoundary>
  );
}
