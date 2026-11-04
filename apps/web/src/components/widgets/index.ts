/** 도메인 표시 위젯(Tailwind + shadcn 기반). 페이지에서 `@/components/widgets`로 사용. */
export { Money } from "./money";
export { StatCard, type TrendDirection } from "./stat-card";
export { StatusBadge, type BadgeTone } from "./status-badge";
export { BarList, type BarListItem } from "./bar-list";
export { UsageBar } from "./usage-bar";
export { ListRow } from "./list-row";
export { EmptyState } from "./empty-state";
export { ListLoading } from "./list-loading";
export { PageBackHeader } from "./page-back-header";
export { MonthSwitcher } from "./month-switcher";
export { ReviewInboxDialog } from "./review-inbox-dialog";
export { declineGroupKey, declineReasonHint } from "./decline-hint";
// 할 일(Inbox) 건수 — 홈 카드·/todo·(다음 웨이브의) 탭 배지가 같은 정의를 쓴다.
export {
  HOME_SMS_WINDOW_MS,
  partitionSmsByWindow,
  pendingCountText,
  pendingReviewTransactions,
  todoTotal,
  unresolvedDeclines,
  type TodoCountBreakdown,
} from "./todo-counts";
export { useTodoCounts, type TodoCounts } from "./use-todo-counts";
// 리뉴얼 공용 컴포넌트(docs/ux-renewal-2026-11.md §3.4)
export { StatusChip, type ChipTone } from "./status-chip";
export { SectionHeader } from "./section-header";
export { BottomSheet, SheetOption } from "./bottom-sheet";
export { OverflowMenu, type OverflowAction } from "./overflow-menu";
