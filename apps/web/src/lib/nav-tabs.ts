/** Primary destinations share one route map with native back navigation. */
export type TabKey = "home" | "assets" | "ledger" | "all";

export const PRIMARY_TABS = [
  { key: "home", href: "/dashboard", label: "홈" },
  { key: "ledger", href: "/transactions", label: "가계부" },
  { key: "assets", href: "/assets", label: "자산" },
  // ADR-0037: 설정은 헤더 아이콘이 아니라 하단 '전체' 탭이다.
  { key: "all", href: "/more", label: "전체" },
] as const satisfies ReadonlyArray<{ key: TabKey; href: string; label: string }>;

/** Existing task and management URLs remain available under 전체. */
const TODO_PATHS: ReadonlyArray<string> = ["/todo", "/declines"];
const ACCOUNT_PATHS: ReadonlyArray<string> = [
  "/more", "/household", "/devices", "/categories", "/ai-operations", "/ai",
];

/** Only these four destinations use Android's double-back exit behavior. */
export const TAB_ROOTS: ReadonlyArray<string> = PRIMARY_TABS.map((tab) => tab.href);

/** Capacitor exports may add trailing slashes. */
export function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function isUnder(pathname: string, base: string): boolean {
  const path = normalizePath(pathname);
  const root = normalizePath(base);
  return path === root || path.startsWith(`${root}/`);
}

export function isTabRoot(pathname: string): boolean {
  return TAB_ROOTS.includes(normalizePath(pathname));
}

export function activeTabFor(pathname: string): TabKey | null {
  if (isUnder(pathname, "/dashboard")) return "home";
  if (isUnder(pathname, "/assets") || isUnder(pathname, "/cards") || isUnder(pathname, "/plan")) return "assets";
  if (["/transactions", "/ledger", "/budgets", ...TODO_PATHS, "/more/recurring"].some((p) => isUnder(pathname, p))) return "ledger";
  if (ACCOUNT_PATHS.some((p) => isUnder(pathname, p))) return "all";
  return null;
}

/**
 * No in-app history: return a deep link to its containing destination.
 * Normal in-app back still returns to the actual previous list/detail screen.
 */
export function parentTabHref(pathname: string): string {
  if (isUnder(pathname, "/declines")) return "/todo";
  if (isUnder(pathname, "/notifications")) return "/dashboard";
  const tab = activeTabFor(pathname);
  return PRIMARY_TABS.find((item) => item.key === tab)?.href ?? "/dashboard";
}
