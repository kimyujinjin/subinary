"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 거래 내역 페이지
 *
 * 기간·검색 + 접는 상세 필터 + 무한 스크롤(useInfiniteQuery).
 * 목록은 날짜별 그룹("7월 17일" 헤더) + ListRow(카테고리 아이콘 · 가맹점 ·
 * 카드/구성원/카테고리 · 금액 · 상태 배지). 행 클릭 → 상세 Dialog에서
 * 카테고리 변경(applyRule)/공개 범위/메모/정상·중복 표시/취소연결을 처리한다.
 *
 * - 모든 계산/집계는 서버(SQL)에서 끝났다고 가정 — 여기선 표시/편집만 담당한다.
 * - 타인 summary_only(masked) 항목은 가맹점을 '(비공개)'로 표기하고 편집을 막는다.
 * - 권한은 서버(서비스 계층)가 강제하며, 실패 시 배너로 메시지를 노출한다.
 * ------------------------------------------------------------------------- */
import {
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CardSummary,
  CardVisibility,
  MemberColor,
  TransactionSummary,
  TransactionUpdateRequest,
} from "@family/contracts";
import { DEFAULT_TIMEZONE } from "@family/shared";
import { Plus, Search, X } from "lucide-react";

import { ReviewRequestAction } from "@/components/review-request-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Fab,
  ListRow,
  Money,
  StatusBadge,
  StatusChip,
  type ChipTone,
} from "@/components/widgets";
import {
  OverflowMenu,
  type OverflowAction,
} from "@/components/widgets/overflow-menu";
import { toast } from "sonner";
import {
  merchantLabel,
  merchantSearchTerm,
  transactionOccurredAt as occurredAt,
} from "@/lib/transaction-display";
import { FieldList, FieldRow, PickerSheet } from "./detail-fields";
import { MerchantHistory } from "./merchant-history";
import { LedgerHeader } from "@/components/ledger-header";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { categoryIcon } from "@/lib/category-icon";
import { cardIdentityLabel } from "@/lib/card-identity-label";
import {
  formatDate,
  formatMoney,
  formatMonth,
  currentMonth,
} from "@/lib/format";
import { monthRange, recentMonths } from "@/lib/month";
import { memberColorClass, sharedColorClass } from "@/lib/member-color";
import {
  attributedMemberId,
  attributedMemberName,
  sharedCardIdSet,
} from "@/lib/transaction-attribution";
import { useHousehold } from "@/lib/household-context";
import {
  invalidateTransactionScope,
  useCardList,
  useCategoryList,
  useCreateCategory,
  useHouseholdMembers,
  useHouseholdSummary,
  useInfiniteTransactions,
} from "@/lib/queries";
import {
  detailFallbackCopy,
  detailFallbackReason,
} from "@/lib/transaction-detail-fallback";
import { cn } from "@/lib/utils";
import {
  createTransactionEditSession,
  validateTransactionEdit,
  type TransactionEditErrors,
  type TransactionEditPatch,
} from "@/lib/transaction-edit";
import {
  cancelTransactionReads,
  transactionDetailKey,
  writeTransactionResult,
} from "@/lib/transaction-detail-cache";
import {
  registerTransactionDetailBack,
  type TransactionDetailBackSource,
} from "@/lib/transaction-detail-back";
import { AddTransactionDialog } from "./add-transaction-dialog";
import { TransactionFxDetails } from "@/components/transaction-fx-details";
import { TransactionFilters } from "./transaction-filters";
import type {
  ActiveTransactionFilter,
  TransactionFilterKey,
} from "./filter-summary";
import {
  initialTransactionMonth,
  transactionReviewPeriodQuery,
} from "@/lib/transaction-review-filter";
import { matchesCandidateSearch, retainSelection } from "./candidate-search";

/* -------------------------------------------------------------------------- */
/* Local types                                                                */
/* -------------------------------------------------------------------------- */

/** select 옵션(값/라벨). */
type Option = { value: string; label: string };

/** 날짜별 그룹(헤더 라벨 + 해당 날짜 거래 + 승인 순지출 합계). */
type DayGroup = {
  key: string;
  label: string;
  total: number;
  items: TransactionSummary[];
};

/* -------------------------------------------------------------------------- */
/* Constants / labels                                                         */
/* -------------------------------------------------------------------------- */

const PAGE_SIZE = 20;

/** 검색 입력 → 쿼리 반영 지연(ms). 타이핑마다 요청하면 한 단어에 대여섯 번 나간다. */
const SEARCH_DEBOUNCE_MS = 300;

/** 검색어 최대 길이(서버 절삭 기준과 동일). */
const SEARCH_MAX_LENGTH = 100;

/** 상세에서 카드 연결을 해제('카드 미연결')하기 위한 Select sentinel(빈 값 금지). */
const CARD_NONE = "__none__";

/** 거래 유형 라벨(승인/취소). */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  approval: "승인",
  cancellation: "취소",
};

/** 공개범위 라벨. */
const VISIBILITY_LABELS: Readonly<Record<CardVisibility, string>> = {
  private: "비공개",
  household: "가족 공개",
  summary_only: "요약만",
};

/** 유형 필터 옵션. */
const TYPE_OPTIONS: ReadonlyArray<Option> = [
  { value: "approval", label: "승인" },
  { value: "cancellation", label: "취소" },
];

/** 상태 필터 옵션(DB txnStatus 5종). */
const STATUS_OPTIONS: ReadonlyArray<Option> = [
  { value: "approved", label: "승인" },
  { value: "partially_cancelled", label: "부분취소" },
  { value: "cancelled", label: "취소" },
  { value: "pending_review", label: "확인필요" },
  { value: "duplicate_suspected", label: "중복의심" },
];

/** 공개범위 편집 옵션. */
const VISIBILITY_OPTIONS: ReadonlyArray<Option> = (
  ["private", "household", "summary_only"] as const
).map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }));

/* -------------------------------------------------------------------------- */
/* Row mutation dispatch                                                      */
/* -------------------------------------------------------------------------- */

/** 행 단위 뮤테이션 액션(단일 useMutation으로 분기 처리). */
type RowAction =
  | { kind: "update"; id: string; body: TransactionUpdateRequest }
  | { kind: "markDuplicate"; id: string }
  | { kind: "markValid"; id: string }
  | { kind: "exclude"; id: string }
  | { kind: "include"; id: string }
  | { kind: "linkCancellation"; id: string; approvalTransactionId: string };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// monthRange/recentMonths는 `@/lib/month`로 승격했다(홈·예산 월 스위처가 같은 규칙을
// 써야 하므로 — ADR-0026). 동작은 동일하다.

/** ApiError면 서버 메시지를, 아니면 일반 메시지를 반환한다. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "작업에 실패했어요. 잠시 후 다시 시도해 주세요.";
}

/** 거래 발생 시각(승인 → 취소 → 수신 순 fallback). */
const TXN_STATUS_CHIP: Record<string, [ChipTone, string]> = {
  partially_cancelled: ["attention", "부분취소"],
  cancelled: ["neutral", "취소"],
  pending_review: ["attention", "확인 필요"],
  duplicate_suspected: ["error", "중복 의심"],
};

function TxnStatusChip({ status }: { status: string }) {
  const [tone, label] = TXN_STATUS_CHIP[status] ?? ["neutral", status];
  return <StatusChip tone={tone}>{label}</StatusChip>;
}

/** ISO 인스턴트 → `<input type="datetime-local">` 로컬 값(`YYYY-MM-DDTHH:mm`). */
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** Asia/Seoul 기준 날짜 키(YYYY-MM-DD) 포맷터. */
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "7월 17일" 형태의 그룹 헤더 포맷터. */
const dayLabelFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: DEFAULT_TIMEZONE,
  month: "long",
  day: "numeric",
});

/** 올해가 아닌 날짜용 "2025년 12월 3일" 포맷터. */
const dayLabelWithYearFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `useSearchParams`는 Suspense 경계를 요구한다(정적 export 포함) — 거래 화면의
 * 달·필터는 URL이 소유하므로 여기서 경계를 친다. `/login`·`/join`·`/register`가
 * 쓰던 것과 같은 형태로 맞춰, 어떤 화면은 감싸고 어떤 화면은 아닌 상태를 없앤다.
 */
export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransactionsView />
    </Suspense>
  );
}

function TransactionsView() {
  const { authedFetch } = useAuth();
  const { householdId } = useHousehold();
  const queryClient = useQueryClient();

  // --- 필터 상태 ---
  // 초기값을 URL에서 읽는다(mount 1회). 이전에는 로컬 state만 써서 알림이 만든
  // `?status=pending_review` 딥링크(packages/shared notificationDeepLink)가 그냥
  // 버려졌다 — 탭하면 필터 없는 전체 목록이 열렸다. 변경 시에는 아래 effect가 URL을
  // 되써서 새로고침·공유·뒤로가기가 같은 화면을 재현한다.
  const searchParams = useSearchParams();
  const router = useRouter();
  const initial = (key: string): string => searchParams.get(key) ?? "";

  const [month, setMonth] = useState<string>(() =>
    initialTransactionMonth(searchParams, currentMonth())
  );
  const [memberId, setMemberId] = useState<string>(() => initial("memberId"));
  const [cardId, setCardId] = useState<string>(() => initial("cardId"));
  const [categoryId, setCategoryId] = useState<string>(() =>
    initial("categoryId")
  );
  const [type, setType] = useState<string>(() => initial("type"));
  const [status, setStatus] = useState<string>(() => initial("status"));
  const [reviewOnly, setReviewOnly] = useState(() => initial("review") === "1");
  /** 검색 입력값(즉시 반영) — 실제 쿼리는 아래 디바운스된 `q`를 쓴다. */
  const [qInput, setQInput] = useState<string>(() => initial("q"));
  const [q, setQ] = useState<string>(qInput);
  /**
   * 합계에서 빼놓은 거래만 보기. 대시보드 공시 문구의 '빼놓은 거래 보기'가
   * `?excluded=only`로 여기로 들어온다.
   *
   * 필터 Select에 넣지 않고 URL 전용 + 해제 칩으로 둔 이유: 평소 목록은 제외분을
   * **함께** 보여주고 배지로 구분하는 것이 기본 동작이다(그게 옳다). 여기에 상시
   * 노출되는 3상 Select를 더하면 "제외 포함/제외만/제외 없음" 중 어디에 있는지를
   * 사용자가 늘 확인해야 한다. 이 필터는 특정 질문("내가 뭘 빼놨지")에 답하는
   * 일회성 진입이므로 들어온 사실만 분명히 보여주고 한 번에 풀 수 있게 한다.
   */
  const [excludedOnly, setExcludedOnly] = useState<boolean>(
    () => searchParams.get("excluded") === "only"
  );
  /**
   * 공용 카드 결제만 보기. 홈의 '공용' 행이 `?attribution=shared`로 들어온다.
   *
   * 구성원 Select에 '공용' 항목을 더하지 않는 이유: 공용은 `memberId` 값이 아니라
   * **귀속을 보류한 묶음**이라 같은 Select에 넣으면 성격이 다른 두 값이 한 축에
   * 섞인다(선택 후 상태를 URL로 표현할 때도 memberId가 아니어서 어긋난다).
   * `excludedOnly`와 같은 이유로 URL 전용 + 해제 칩으로 둔다.
   */
  const [sharedOnly, setSharedOnly] = useState<boolean>(
    () => searchParams.get("attribution") === "shared"
  );
  // 필터는 닫아도 유지한다. 표시 조건만 지울 때 기간·검색은 바꾸지 않는다.
  const filterSetters = {
    categoryId: setCategoryId,
    cardId: setCardId,
    memberId: setMemberId,
    type: setType,
    status: setStatus,
  };
  const changeFilter = (key: TransactionFilterKey, value: string) =>
    filterSetters[key](value);
  const clearFilter = (key: ActiveTransactionFilter["key"]) => {
    if (key === "reviewOnly") setReviewOnly(false);
    else if (key === "excludedOnly") setExcludedOnly(false);
    else if (key === "sharedOnly") setSharedOnly(false);
    else changeFilter(key, "");
  };
  const clearConditions = () => {
    for (const setter of Object.values(filterSetters)) setter("");
    setReviewOnly(false);
    setExcludedOnly(false);
    setSharedOnly(false);
  };

  /** 모든 필터를 기본값(이번 달·전체)으로 되돌린다(빈 상태 CTA). */
  const resetFilters = () => {
    setMonth(currentMonth());
    setMemberId("");
    setCardId("");
    setCategoryId("");
    setType("");
    setStatus("");
    setReviewOnly(false);
    setQInput("");
    setQ("");
    setExcludedOnly(false);
    setSharedOnly(false);
  };

  const hasActiveFilter =
    memberId !== "" ||
    cardId !== "" ||
    categoryId !== "" ||
    type !== "" ||
    status !== "" ||
    reviewOnly ||
    q !== "" ||
    excludedOnly ||
    sharedOnly ||
    month !== currentMonth();

  // 타이핑마다 요청하면 한 단어에 대여섯 번 쿼리가 나간다 → 300ms 디바운스.
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput]);

  // 필터 상태 → URL. 기본값은 파라미터에서 빼 링크를 짧게 유지한다.
  // `txn`(알림 딥링크)은 아래 상세 열기 effect가 소유하므로 여기서 건드리지 않는다.
  useEffect(() => {
    const params = transactionReviewPeriodQuery(
      month,
      reviewOnly,
      currentMonth()
    );
    if (memberId) params.set("memberId", memberId);
    if (cardId) params.set("cardId", cardId);
    if (categoryId) params.set("categoryId", categoryId);
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (excludedOnly) params.set("excluded", "only");
    if (sharedOnly) params.set("attribution", "shared");
    const selectedTransaction = new URLSearchParams(window.location.search).get(
      "txn"
    );
    if (selectedTransaction) params.set("txn", selectedTransaction);
    const qs = params.toString();
    // replace: 필터를 다섯 번 바꿨다고 뒤로가기를 다섯 번 눌러야 하면 안 된다.
    router.replace(qs ? `/transactions?${qs}` : "/transactions", {
      scroll: false,
    });
  }, [
    month,
    memberId,
    cardId,
    categoryId,
    type,
    status,
    reviewOnly,
    q,
    excludedOnly,
    sharedOnly,
    router,
  ]);

  // --- 참조 목록(필터/표시용) ---
  const membersQuery = useHouseholdMembers();
  const cardsQuery = useCardList();
  const categoriesQuery = useCategoryList();

  const members = membersQuery.data ?? [];
  const cards = cardsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.memberId, m.name);
    return map;
  }, [members]);

  // 공용 카드 결제의 표시 색(가구 설정). null이면 중립 회색.
  const sharedColor = useHouseholdSummary().data?.sharedColor ?? null;

  // 구성원이 직접 고른 색(memberId → 팔레트 키). 없으면 해시 색 폴백.
  const memberColorById = useMemo(() => {
    const map = new Map<string, MemberColor | null>();
    for (const m of members) map.set(m.memberId, m.color);
    return map;
  }, [members]);

  // 귀속 규칙은 `lib/transaction-attribution`이 단일 출처다 — 홈과 이 화면이 각자
  // 구현했다가 갈렸다(공용 카드 88건이 홈에서 소유자 이름으로 보였다).
  const sharedCardIds = useMemo(() => sharedCardIdSet(cards), [cards]);
  const attributedMemberIdOf = (txn: TransactionSummary): string | null =>
    attributedMemberId(txn, sharedCardIds);

  const cardById = useMemo(() => {
    const map = new Map<string, CardSummary>();
    for (const c of cards) map.set(c.id, c);
    return map;
  }, [cards]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const memberOptions: Option[] = members
    .filter((m) => m.status === "active")
    .map((m) => ({ value: m.memberId, label: m.name }));
  const cardOptions: Option[] = cards.map((c) => ({
    value: c.id,
    label: cardIdentityLabel(c, memberNameById),
  }));
  const categoryFilterOptions: Option[] = categories.map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const monthOptions: Option[] = recentMonths(12).map((m) => ({
    value: m,
    label: formatMonth(m),
  }));
  // 오래된 기간의 딥링크도 현재 선택값이 빈칸으로 보이지 않도록 유지한다.
  if (month && !monthOptions.some((option) => option.value === month)) {
    monthOptions.unshift({ value: month, label: formatMonth(month) });
  }

  // --- 목록 쿼리 ---
  const { from, to } = useMemo(() => monthRange(month), [month]);
  const filters = useMemo(
    () => ({
      memberId: memberId || undefined,
      cardId: cardId || undefined,
      categoryId: categoryId || undefined,
      type: type || undefined,
      status: status || undefined,
      review: reviewOnly ? ("1" as const) : undefined,
      q: q || undefined,
      excluded: excludedOnly ? ("only" as const) : undefined,
      attribution: sharedOnly ? ("shared" as const) : undefined,
      from,
      to,
      limit: PAGE_SIZE,
    }),
    [
      memberId,
      cardId,
      categoryId,
      type,
      status,
      reviewOnly,
      q,
      excludedOnly,
      sharedOnly,
      from,
      to,
    ]
  );
  const listQuery = useInfiniteTransactions(filters);

  // 무한 스크롤: 모든 페이지의 items를 평탄화한다.
  const items = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [listQuery.data]
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = listQuery;

  // 리스트 하단 sentinel이 뷰포트에 들어오면 다음 페이지를 당겨온다(200px 선로딩).
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // --- 날짜별 그룹(발생일 기준, 서버 정렬 순서 유지) ---
  const groups = useMemo<DayGroup[]>(() => {
    const currentYear = currentMonth().slice(0, 4);
    const map = new Map<string, DayGroup>();
    for (const txn of items) {
      const date = new Date(occurredAt(txn));
      const valid = !Number.isNaN(date.getTime());
      const key = valid ? dayKeyFormatter.format(date) : "unknown";
      let group = map.get(key);
      if (!group) {
        const label = !valid
          ? "날짜 미확인"
          : key.startsWith(currentYear)
          ? dayLabelFormatter.format(date)
          : dayLabelWithYearFormatter.format(date);
        group = { key, label, total: 0, items: [] };
        map.set(key, group);
      }
      group.items.push(txn);
      // 합계 제외(excludedAt) 거래는 서버 집계(summary/budget/analytics)와 동일하게
      // 날짜 소계에서도 뺀다 — 같은 행을 '제외됨'으로 표시하면서 소계엔 더하면 모순.
      // amount는 minor units라 통화가 섞이면 소계가 무의미하므로 KRW만 합산한다
      // (외화 건은 개별 행에 자기 통화로 표시됨; 서버 KRW 집계 원칙과 동일).
      if (
        txn.transactionType === "approval" &&
        txn.excludedAt == null &&
        (txn.currency ?? "KRW") === "KRW"
      ) {
        group.total += txn.netAmount;
      }
    }
    // 서버 정렬 키와 화면의 날짜(approvedAt ?? cancelledAt ?? createdAt)가 다를 수 있어
    // 첫 등장 순서를 그대로 쓰면 11월 4일 → 2일 → 3일처럼 섞였다. 날짜 키로 다시 정렬한다.
    return [...map.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) =>
          occurredAt(b).localeCompare(occurredAt(a))
        ),
      }))
      .sort((a, b) =>
        a.key === "unknown"
          ? 1
          : b.key === "unknown"
          ? -1
          : b.key.localeCompare(a.key)
      );
  }, [items]);

  // --- 뮤테이션(행 작업) ---
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [memoTarget, setMemoTarget] = useState<TransactionSummary | null>(null);
  const [linkTarget, setLinkTarget] = useState<TransactionSummary | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // 푸시 알림 딥링크(?txn=<id>) → 해당 거래 상세 열기. 목록에 없을 수 있어
  // (다른 월/필터) 단건 조회로 폴백한다. 조회가 실패하면 **조용히 리스트에 머물지
  // 않고** 이유를 말한다(아래 detailFallback) — 예전에는 아무 일도 일어나지 않아
  // 사용자가 앱이 멈춘 줄 알았다. 상세를 연 뒤 URL에서 ?txn을 제거해, 같은 알림을
  // 다시 탭하면(같은 경로 push) effect가 재실행되어 다시 열리게 한다.
  useEffect(() => {
    const txnParam = searchParams.get("txn");
    if (!txnParam) return;
    setDetailId(txnParam);
    if (typeof window !== "undefined") {
      // `txn`만 지운다. 예전엔 pathname으로 통째로 replace해서, 같은 링크에 실려 온
      // 다른 필터(`?status=`)까지 함께 날아갔다.
      const url = new URL(window.location.href);
      url.searchParams.delete("txn");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
  }, [searchParams]);

  const inList = detailId != null && items.some((t) => t.id === detailId);
  const detailFallbackQuery = useQuery({
    queryKey: transactionDetailKey(householdId, detailId),
    enabled: detailId != null && !inList,
    retry: false,
    queryFn: () =>
      authedFetch((token) => api.transactions.get(token, detailId as string)),
  });

  // 상세 Dialog는 항상 최신 목록의 행을 바라본다(뮤테이션 후 refetch 반영).
  // 목록에 없으면 단건 조회 결과로 폴백.
  const detailTxn = detailId
    ? items.find((t) => t.id === detailId) ?? detailFallbackQuery.data ?? null
    : null;
  const detailCard = detailTxn?.cardId
    ? cardById.get(detailTxn.cardId)
    : undefined;

  // 폴백까지 실패한 경우 = 열 수 없는 딥링크. 이유(없음/막힘/오류)를 구분해 알린다.
  const detailFallbackError =
    detailId != null && !inList && detailFallbackQuery.isError
      ? detailFallbackCopy(detailFallbackReason(detailFallbackQuery.error))
      : null;

  const mutation = useMutation({
    onMutate: (action: RowAction) =>
      cancelTransactionReads(queryClient, householdId, action.id),
    mutationFn: (action: RowAction): Promise<TransactionSummary> =>
      authedFetch((token) => {
        switch (action.kind) {
          case "update":
            return api.transactions.update(token, action.id, action.body);
          case "markDuplicate":
            return api.transactions.markDuplicate(token, action.id);
          case "markValid":
            return api.transactions.markValid(token, action.id);
          case "exclude":
            return api.transactions.exclude(token, action.id);
          case "include":
            return api.transactions.include(token, action.id);
          case "linkCancellation":
            return api.transactions.linkCancellation(token, action.id, {
              approvalTransactionId: action.approvalTransactionId,
            });
          default: {
            const exhaustive: never = action;
            throw new Error(`unknown action: ${JSON.stringify(exhaustive)}`);
          }
        }
      }),
    onSuccess: (updated) => {
      setActionError(null);
      // PATCH's response is authoritative immediately, including off-list deep links.
      writeTransactionResult(queryClient, updated);
      // 거래·집계·예산·인사이트·가맹점후보를 단일 헬퍼로 일괄 무효화(실시간 힌트
      // 경로와 동일 범위 — 조합 불일치/누락 방지).
      invalidateTransactionScope(queryClient);
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const busyId = mutation.isPending ? mutation.variables?.id ?? null : null;

  const changeCategory = (txn: TransactionSummary, nextCategoryId: string) => {
    if (nextCategoryId === "" || nextCategoryId === txn.categoryId) return;
    mutation.mutate({
      kind: "update",
      id: txn.id,
      body: { categoryId: nextCategoryId },
    });
  };

  // 카테고리를 바꾼 뒤 '앞으로도 이렇게 분류'를 고르면 같은 분류로 가맹점 규칙만 저장한다
  // (서버가 merchant_category_rules를 upsert, 지난 거래는 그대로). 예전 체크박스는 분류를
  // 고르기 **전에** 켜야만 적용돼, 고른 뒤 켜면 아무 일도 없었다.
  const applyCategoryRule = (txn: TransactionSummary, categoryId: string) =>
    mutation.mutateAsync({
      kind: "update",
      id: txn.id,
      body: { categoryId, applyRule: true },
    });

  // 금액·날짜 수정(변경된 필드만 PATCH). 빈 body면 no-op.
  const editFields = async (
    txn: TransactionSummary,
    body: TransactionEditPatch
  ): Promise<TransactionSummary> => {
    if (body.amount === undefined && body.occurredAt === undefined) return txn;
    return mutation.mutateAsync({ kind: "update", id: txn.id, body });
  };

  // 하드 삭제(되돌리기 불가). 성공 시 상세 닫기 + 목록/집계 무효화.
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      authedFetch((token) => api.transactions.remove(token, id)),
    onMutate: (id: string) => ({ householdId, id }),
    onSuccess: (_result, id, context) => {
      setActionError(null);
      toast.success("거래를 삭제했어요");
      queryClient.removeQueries({
        queryKey: transactionDetailKey(context?.householdId ?? householdId, id),
      });
      setDetailId((current) => (current === id ? null : current));
      invalidateTransactionScope(queryClient);
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  // 알맞은 카테고리가 없을 때: 새 커스텀 카테고리를 만들고 곧바로 이 거래에 지정한다.
  const createCategoryMut = useCreateCategory();
  const handleCreateCategory = async (
    txn: TransactionSummary,
    name: string
  ): Promise<string> => {
    const created = await createCategoryMut.mutateAsync(name);
    changeCategory(txn, created.id);
    return created.id;
  };

  const changeVisibility = (
    txn: TransactionSummary,
    nextVisibility: string
  ) => {
    if (nextVisibility === txn.visibility) return;
    mutation.mutate({
      kind: "update",
      id: txn.id,
      body: { visibility: nextVisibility as CardVisibility },
    });
  };

  // 카드 수동 연결/재지정. 서버는 cardId 설정 시 카드 visibility를 재상속하고,
  // null이면 'household'로 되돌린다(자동연결 미매칭·모호(pending_review) 거래를
  // 사람이 직접 해소하는 경로). 승격의 소급 미적용을 보완한다.
  const changeCard = (txn: TransactionSummary, next: string) => {
    const nextCardId = next === CARD_NONE ? null : next;
    if (nextCardId === (txn.cardId ?? null)) return;
    mutation.mutate({
      kind: "update",
      id: txn.id,
      body: { cardId: nextCardId },
    });
  };

  const saveMemo = (txn: TransactionSummary, memo: string) => {
    mutation.mutate(
      { kind: "update", id: txn.id, body: { memo } },
      {
        onSuccess: () =>
          setMemoTarget((current) => (current?.id === txn.id ? null : current)),
      }
    );
  };

  const confirmLink = (txn: TransactionSummary, approvalId: string) => {
    mutation.mutate(
      {
        kind: "linkCancellation",
        id: txn.id,
        approvalTransactionId: approvalId,
      },
      {
        onSuccess: () =>
          setLinkTarget((current) => (current?.id === txn.id ? null : current)),
      }
    );
  };

  // --- 행 표시용 파생 ---
  const categoryNameOf = (txn: TransactionSummary): string | null =>
    txn.categoryId ? categoryNameById.get(txn.categoryId) ?? null : null;

  const cardLabelOf = (txn: TransactionSummary): string => {
    if (!txn.cardId) return "카드 미연결";
    return cardById.get(txn.cardId)?.alias ?? "카드";
  };

  // 이름과 색은 거래 구성원 기준이다. 연결된 카드 소유자와 혼동하지 않는다.
  /**
   * 아이콘 색. 공용 카드는 사람 색을 쓰지 않는다 — 색이 곧 "누구"를 뜻하므로, 귀속을
   * 보류한 거래에 특정 색을 주면 화면이 이름(공용)과 다른 답을 말한다.
   */
  const sharedIconClass = (txn: TransactionSummary): string => {
    const id = attributedMemberIdOf(txn);
    // 공용은 사람 팔레트에서 **자동 배정하지 않는다** — 자동이면 색을 보고 사람을
    // 떠올린 사용자가 이름에서 '공용'을 읽고 어긋난다. 사용자가 직접 고른 색만
    // 쓰고(가구 설정), 고르지 않았으면 종전 회색 그대로다.
    if (id === null) return sharedColorClass(sharedColor);
    return memberColorClass(id, memberColorById.get(id));
  };

  const memberNameOf = (txn: TransactionSummary): string =>
    attributedMemberName(attributedMemberIdOf(txn), memberNameById);

  const subtitleOf = (txn: TransactionSummary): string => {
    const parts = [
      cardLabelOf(txn),
      memberNameOf(txn),
      categoryNameOf(txn) ?? "미분류",
    ];
    // 1개월은 일시불이다 — `1개월 할부`로 쓰면 할부로 오해한다.
    if (txn.installmentMonths && txn.installmentMonths > 1)
      parts.push(`${txn.installmentMonths}개월 할부`);
    return parts.join(" · ");
  };

  const showLoading = householdId != null && listQuery.isLoading;
  const showError = listQuery.isError;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6">
      <LedgerHeader active="transactions" month={month} />
      <Fab label="거래 추가" onClick={() => setAddOpen(true)}>
        <Plus />
      </Fab>

      <TransactionFilters
        month={month}
        monthOptions={monthOptions}
        values={{
          categoryId,
          cardId,
          memberId,
          type,
          status,
          reviewOnly,
          excludedOnly,
          sharedOnly,
        }}
        choices={{
          categoryId: categoryFilterOptions,
          cardId: cardOptions,
          memberId: memberOptions,
          type: TYPE_OPTIONS,
          status: STATUS_OPTIONS,
        }}
        onMonthChange={setMonth}
        onChange={changeFilter}
        onClear={clearFilter}
        onClearAll={clearConditions}
        onToggleReview={() => {
          setReviewOnly(!reviewOnly);
          if (!reviewOnly) {
            setMonth("");
            setStatus("");
            setExcludedOnly(false);
          }
        }}
      >
        {/* 검색은 기존 가맹점·메모 조건을 그대로 사용한다. */}
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            inputMode="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="가맹점이나 메모로 찾기"
            aria-label="거래 검색"
            className="min-h-12 rounded-control border-transparent bg-card pl-11 pr-12 shadow-none"
          />
          {qInput ? (
            <button
              type="button"
              onClick={() => setQInput("")}
              aria-label="검색어 지우기"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-ring absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </TransactionFilters>

      {actionError ? (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {actionError}
        </div>
      ) : null}

      {/* 목록 — 날짜별 그룹 + ListRow */}
      <section aria-label="거래 내역" className="min-w-0">
        <div className="flex min-w-0 flex-col gap-6">
          {showLoading ? (
            <div
              className="flex flex-col gap-1"
              role="status"
              aria-live="polite"
            >
              <span className="sr-only">거래를 불러오고 있어요</span>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="flex min-w-0 items-center gap-2.5 px-1 py-3.5 sm:gap-3 sm:px-2"
                >
                  <Skeleton className="size-9 shrink-0 rounded-full sm:size-10" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-3/4 max-w-32" />
                    <Skeleton className="h-3 w-full max-w-44" />
                  </div>
                  <Skeleton className="h-4 w-16 shrink-0" />
                </div>
              ))}
            </div>
          ) : showError ? (
            <p
              className="text-destructive py-6 text-center text-sm"
              role="alert"
            >
              거래를 불러오지 못했어요: {errorMessage(listQuery.error)}
            </p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="text-4xl" aria-hidden>
                🧾
              </span>
              {hasActiveFilter ? (
                <>
                  <p className="pt-1 text-[15px] font-semibold">
                    {reviewOnly
                      ? "조건에 맞는 확인할 거래가 없어요"
                      : "조건에 맞는 거래가 없어요"}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    필터를 바꿔서 다시 찾아볼까요?
                  </p>
                  <Button
                    variant="tint"
                    className="mt-3 min-h-11"
                    onClick={resetFilters}
                  >
                    필터 초기화하기
                  </Button>
                </>
              ) : (
                <>
                  <p className="pt-1 text-[15px] font-semibold">
                    아직 거래가 없어요
                  </p>
                  <p className="text-muted-foreground text-sm">
                    카드 문자가 도착하면 자동으로 정리해 드려요
                  </p>
                  <Button variant="tint" className="mt-3 min-h-11" asChild>
                    <Link href="/devices">장치 연결하러 가기</Link>
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* 날짜마다 상자를 나누지 않고 한 섹션 안에 날짜 머리로 구분한다(§8). */}
              <div className="finance-panel flex min-w-0 flex-col px-3 pb-2 sm:px-5">
                {groups.map((group) => (
                  <section
                    key={group.key}
                    className="flex min-w-0 flex-col pt-2"
                  >
                    <div className="flex min-w-0 items-baseline justify-between gap-3 px-1 pt-3 pb-1 sm:px-2">
                      <h2 className="text-caption text-muted-foreground font-semibold">
                        {group.label}
                      </h2>
                      <p
                        className="text-caption text-muted-foreground min-w-0 text-right"
                        title="원화 승인 소계(외화·제외 거래 빼고)"
                      >
                        <span className="sr-only">원화 승인 소계 </span>
                        <Money amount={group.total} />
                      </p>
                    </div>
                    <div className="flex flex-col">
                      {group.items.map((txn) => {
                        const Icon = categoryIcon(categoryNameOf(txn));
                        const isCancellation =
                          txn.transactionType === "cancellation";
                        const excluded = txn.excludedAt != null;
                        return (
                          <ListRow
                            key={txn.id}
                            icon={<Icon aria-hidden="true" />}
                            iconClassName={cn(
                              "rounded-xl",
                              txn.masked || excluded
                                ? "bg-muted text-muted-foreground"
                                : sharedIconClass(txn)
                            )}
                            title={
                              txn.masked ? (
                                <span className="text-muted-foreground">
                                  {merchantLabel(txn)}
                                </span>
                              ) : (
                                merchantLabel(txn)
                              )
                            }
                            subtitle={subtitleOf(txn)}
                            value={
                              <span
                                className={cn(
                                  "flex min-w-0 max-w-full flex-col items-end",
                                  excluded && "line-through opacity-60"
                                )}
                              >
                                {isCancellation ? (
                                  <Money
                                    amount={-txn.amount}
                                    currency={txn.currency}
                                    muted
                                  />
                                ) : (
                                  <Money
                                    amount={txn.netAmount}
                                    currency={txn.currency}
                                  />
                                )}
                                {txn.originalCurrency &&
                                txn.originalAmount != null ? (
                                  <span className="text-muted-foreground max-w-full text-[11px]">
                                    {formatMoney(
                                      txn.originalAmount,
                                      txn.originalCurrency
                                    )}
                                  </span>
                                ) : null}
                              </span>
                            }
                            valueSub={
                              <span className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
                                {isCancellation ? (
                                  <span className="text-xs">
                                    {TYPE_LABELS[txn.transactionType]}
                                  </span>
                                ) : null}
                                {excluded ? (
                                  <StatusChip>제외됨</StatusChip>
                                ) : txn.status !== "approved" ? (
                                  // 승인은 기본 상태라 표시하지 않는다(§5 가계부) — 취소·확인 필요만 칩으로.
                                  <TxnStatusChip status={txn.status} />
                                ) : null}
                              </span>
                            }
                            onClick={
                              txn.masked ? undefined : () => setDetailId(txn.id)
                            }
                            className={cn(
                              "rounded-control py-3 hover:bg-muted/60",
                              busyId === txn.id
                                ? "pointer-events-none opacity-60"
                                : undefined
                            )}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              {/* 무한 스크롤 sentinel: 뷰포트 진입 시 자동 로드(관찰 실패 대비 버튼 폴백) */}
              <div
                ref={loadMoreRef}
                className="flex flex-col items-center gap-2 py-2"
              >
                {isFetchingNextPage ? (
                  <span className="text-muted-foreground text-[13px]">
                    불러오는 중…
                  </span>
                ) : hasNextPage ? (
                  <button
                    type="button"
                    onClick={() => void fetchNextPage()}
                    className="text-accent-foreground hover:bg-muted focus-visible:outline-ring min-h-11 rounded-xl px-5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    더 보기
                  </button>
                ) : (
                  <span className="text-muted-foreground text-[13px]">
                    {items.length}건 · 마지막이에요
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {detailTxn ? (
        <TransactionDetailDialog
          key={`${householdId}:${detailTxn.id}`}
          txn={detailTxn}
          busy={mutation.isPending || deleteMutation.isPending}
          actionStatus={
            mutation.variables?.id === detailTxn.id ? mutation.status : "idle"
          }
          actionError={
            mutation.variables?.id === detailTxn.id && mutation.isError
              ? errorMessage(mutation.error)
              : null
          }
          cardLabel={
            detailCard
              ? cardIdentityLabel(detailCard, memberNameById)
              : detailTxn.cardId
              ? "카드 정보 확인 불가"
              : "카드 미연결"
          }
          memberName={memberNameOf(detailTxn)}
          ownershipMismatch={
            detailCard != null &&
            !detailCard.isShared &&
            detailCard.ownerMemberId !== detailTxn.memberId
          }
          cardOptions={cardOptions}
          categoryOptions={categoryFilterOptions}
          onApplyCategoryRule={(categoryId) =>
            applyCategoryRule(detailTxn, categoryId)
          }
          onOpenTransaction={(id) => setDetailId(id)}
          onChangeCard={(v) => changeCard(detailTxn, v)}
          onChangeCategory={(v) => changeCategory(detailTxn, v)}
          onCreateCategory={(name) => handleCreateCategory(detailTxn, name)}
          onChangeVisibility={(v) => changeVisibility(detailTxn, v)}
          onEditFields={(body) => editFields(detailTxn, body)}
          onOpenMemo={() => setMemoTarget(detailTxn)}
          onOpenLink={() => setLinkTarget(detailTxn)}
          onMarkValid={() =>
            mutation.mutate({ kind: "markValid", id: detailTxn.id })
          }
          onExclude={() =>
            mutation.mutate({ kind: "exclude", id: detailTxn.id })
          }
          onInclude={() =>
            mutation.mutate({ kind: "include", id: detailTxn.id })
          }
          onDelete={() => deleteMutation.mutate(detailTxn.id)}
          onClose={() => setDetailId(null)}
        />
      ) : null}

      {/* 열 수 없는 딥링크 — 상세가 열렸어야 할 자리에 이유를 띄운다.
          모달인 이유: 사용자가 방금 "이 거래를 보여줘"를 눌렀고, 그 자리에 답이
          없으면 목록 어딘가의 토스트로는 못 알아챈다. */}
      <AlertDialog
        open={detailFallbackError !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{detailFallbackError?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {detailFallbackError?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            {detailFallbackError?.retryable ? (
              // 일시적 오류만 재시도를 권한다. 없는/막힌 거래는 다시 눌러도 같다.
              <AlertDialogAction
                disabled={detailFallbackQuery.isFetching}
                onClick={(e) => {
                  // preventDefault: 재시도는 다이얼로그를 닫지 않는다(또 실패할 수 있다).
                  e.preventDefault();
                  void detailFallbackQuery.refetch();
                }}
              >
                {detailFallbackQuery.isFetching ? "불러오는 중…" : "다시 시도"}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {memoTarget ? (
        <MemoModal
          txn={memoTarget}
          busy={mutation.isPending}
          onClose={() => setMemoTarget(null)}
          onSave={(memo) => saveMemo(memoTarget, memo)}
        />
      ) : null}

      {linkTarget ? (
        <LinkCancellationModal
          cancellation={linkTarget}
          busy={mutation.isPending}
          onClose={() => setLinkTarget(null)}
          onConfirm={(approvalId) => confirmLink(linkTarget, approvalId)}
        />
      ) : null}

      <AddTransactionDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Transaction detail dialog                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 거래 상세 Dialog — 행 클릭 시 열리며 편집 액션(카테고리/공개 범위/메모/
 * 정상·중복 표시/취소연결)을 점진 공개로 모아 보여준다. masked 행은 열리지 않는다.
 */
function TransactionDetailDialog({
  txn,
  busy: actionBusy,
  actionStatus,
  actionError,
  cardLabel,
  memberName,
  ownershipMismatch,
  cardOptions,
  categoryOptions,
  onApplyCategoryRule,
  onOpenTransaction,
  onChangeCard,
  onChangeCategory,
  onCreateCategory,
  onChangeVisibility,
  onEditFields,
  onOpenMemo,
  onOpenLink,
  onMarkValid,
  onExclude,
  onInclude,
  onDelete,
  onClose,
}: Readonly<{
  txn: TransactionSummary;
  busy: boolean;
  actionStatus: "idle" | "pending" | "success" | "error";
  actionError: string | null;
  cardLabel: string;
  memberName: string;
  ownershipMismatch: boolean;
  cardOptions: ReadonlyArray<Option>;
  categoryOptions: ReadonlyArray<Option>;
  onApplyCategoryRule: (categoryId: string) => Promise<unknown>;
  onOpenTransaction: (id: string) => void;
  onChangeCard: (cardId: string) => void;
  onChangeCategory: (categoryId: string) => void;
  onCreateCategory: (name: string) => Promise<string>;
  onChangeVisibility: (visibility: string) => void;
  onEditFields: (body: TransactionEditPatch) => Promise<TransactionSummary>;
  onOpenMemo: () => void;
  onOpenLink: () => void;
  onMarkValid: () => void;
  onExclude: () => void;
  onInclude: () => void;
  onDelete: () => void;
  onClose: () => void;
}>) {
  const [editSaving, setEditSaving] = useState(false);
  const busy = actionBusy || editSaving;
  const isCancellation = txn.transactionType === "cancellation";
  const excluded = txn.excludedAt != null;
  const isPending =
    !excluded &&
    (txn.status === "pending_review" || txn.status === "duplicate_suspected");
  const canLink = isCancellation && txn.parentTransactionId == null;
  // 금액 수정은 취소 연결이 없는 단순 거래만(서버 규칙과 일치). 날짜는 항상 가능.
  const canEditAmount =
    txn.cancelledAmount === 0 && txn.parentTransactionId == null;

  // 금액·날짜 인라인 편집 상태(평소엔 읽기, '수정' 탭 시 편집 모드).
  const [editing, setEditing] = useState(false);
  const initialDate = toDateTimeLocal(occurredAt(txn));
  const [editAmount, setEditAmount] = useState(String(txn.amount));
  const [editDate, setEditDate] = useState(initialDate);
  const [editErrors, setEditErrors] = useState<TransactionEditErrors>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const editSession = useRef(createTransactionEditSession());
  const amountInput = useRef<HTMLInputElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const backHandler = useRef<(source: TransactionDetailBackSource) => void>(
    () => undefined
  );
  useEffect(() => {
    const unregister = registerTransactionDetailBack(window, (source) =>
      backHandler.current(source)
    );
    return () => {
      unregister();
      editSession.current.invalidate();
    };
  }, []);
  const editDirty =
    (canEditAmount && editAmount.trim() !== String(txn.amount)) ||
    editDate !== initialDate;
  const cancelEdit = () => {
    if (editSession.current.pending || busy) return;
    editSession.current.invalidate();
    setEditAmount(String(txn.amount));
    setEditDate(initialDate);
    setEditErrors({});
    setEditError(null);
    setEditNotice(null);
    setEditing(false);
  };
  const startEdit = () => {
    setEditAmount(String(txn.amount));
    setEditDate(initialDate);
    setEditErrors({});
    setEditError(null);
    setEditNotice(null);
    setEditing(true);
  };
  const requestClose = () => {
    if (discardOpen) {
      setDiscardOpen(false);
      return;
    }
    if (deleteConfirmOpen) {
      setDeleteConfirmOpen(false);
      return;
    }
    if (editSession.current.pending || busy) {
      setEditNotice("저장 중이에요. 완료될 때까지 잠시 기다려 주세요.");
      return;
    }
    if (editing && editDirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };
  backHandler.current = (source) => {
    if (source === "browser") {
      // popstate already navigated: do not restore a URL or claim an in-flight
      // write was cancelled. Only discard this dialog's response callbacks.
      editSession.current.invalidate();
      onClose();
      return;
    }
    requestClose();
  };
  const saveEdits = async () => {
    if (editSession.current.pending || busy) return;
    const validation = validateTransactionEdit({
      amount: editAmount,
      date: editDate,
      initialAmount: txn.amount,
      initialDate,
      canEditAmount,
    });
    setEditNotice(null);
    setEditError(null);
    if (!validation.ok) {
      setEditErrors(validation.errors);
      (validation.errors.amount ? amountInput : dateInput).current?.focus();
      return;
    }
    setEditErrors({});
    if (Object.keys(validation.patch).length === 0) {
      setEditing(false);
      return;
    }
    setEditSaving(true);
    await editSession.current.save(
      () => onEditFields(validation.patch),
      () => {
        setEditSaving(false);
        setEditing(false);
      },
      (error) => {
        setEditSaving(false);
        setEditNotice(null);
        setEditError(errorMessage(error));
        // Keep both inputs and focusable actions available for a correction/retry.
        (canEditAmount ? amountInput : dateInput).current?.focus();
      }
    );
  };

  // 카테고리를 이 시트에서 바꾼 뒤에만 '앞으로도 이렇게 분류'를 묻는다.
  const [ruleFor, setRuleFor] = useState<{ id: string; name: string } | null>(
    null
  );
  const [ruleState, setRuleState] = useState<"offered" | "saving" | "applied">(
    "offered"
  );
  // 분류 변경이 저장된 뒤(txn.categoryId가 바뀐 뒤)에만 규칙을 저장할 수 있다.
  const ruleReady = ruleFor != null && txn.categoryId === ruleFor.id;
  const applyRuleForMerchant = async () => {
    if (!ruleFor || !ruleReady || busy || ruleState === "saving") return;
    setRuleState("saving");
    try {
      await onApplyCategoryRule(ruleFor.id);
      setRuleState("applied");
    } catch {
      // 오류 문구는 위쪽 인라인(actionError)이 말한다.
      setRuleState("offered");
    }
  };
  // 저장 성공은 시트 어디에서 바꿨든 보이게 토스트로 알린다(오류는 위쪽 인라인).
  const lastStatus = useRef(actionStatus);
  useEffect(() => {
    if (lastStatus.current !== "success" && actionStatus === "success")
      toast.success("저장했어요");
    lastStatus.current = actionStatus;
  }, [actionStatus]);

  // 인라인 '새 카테고리 만들기' 상태.
  const [creatingCategory, setCreatingCategory] = useState(false);
  /** 열려 있는 선택 시트(카테고리·카드·공개 범위). 한 번에 하나만 연다. */
  const [picker, setPicker] = useState<
    "category" | "card" | "visibility" | null
  >(null);
  const categoryLabel = categoryOptions.find(
    (o) => o.value === txn.categoryId
  )?.label;
  const visibilityLabel =
    VISIBILITY_OPTIONS.find((o) => o.value === txn.visibility)?.label ??
    txn.visibility;
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const submitNewCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || categorySaving) return;
    setCategorySaving(true);
    setCategoryError(null);
    try {
      const createdId = await onCreateCategory(name);
      setCreatingCategory(false);
      setNewCategoryName("");
      if (merchantSearchTerm(txn)) {
        setRuleFor({ id: createdId, name });
        setRuleState("offered");
      }
    } catch (err) {
      setCategoryError(
        err instanceof Error ? err.message : "카테고리를 만들지 못했어요."
      );
    } finally {
      setCategorySaving(false);
    }
  };

  const merchant = merchantLabel(txn);
  const searchTerm = merchantSearchTerm(txn);
  const installment =
    txn.installmentMonths && txn.installmentMonths > 1
      ? txn.installmentMonths
      : null;
  const foreign = txn.originalCurrency != null && txn.originalAmount != null;
  const partiallyCancelled = !isCancellation && txn.netAmount !== txn.amount;
  // 자주 쓰지 않거나 되돌리기 어려운 행동은 ⋯ 메뉴에만 둔다(리뉴얼 §3.3 — 위험 행동은 메뉴 안).
  const overflowActions: OverflowAction[] = [
    { label: "금액·날짜 수정", onSelect: startEdit, disabled: busy },
    ...(!isCancellation && !excluded
      ? [
          {
            label: "중복이에요 · 합계에서 빼기",
            onSelect: onExclude,
            disabled: busy,
          },
        ]
      : []),
    {
      label: "거래 삭제",
      onSelect: () => setDeleteConfirmOpen(true),
      destructive: true,
      disabled: busy,
    },
  ];

  return (
    <Dialog open onOpenChange={(v) => !v && requestClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-5 [&>*]:min-w-0">
        <DialogHeader className="gap-1 text-left">
          <div className="flex min-w-0 items-start gap-1 pr-8">
            <DialogTitle className="text-heading min-w-0 flex-1 break-words">
              {merchant}
            </DialogTitle>
            {!editing ? (
              <OverflowMenu
                label="거래 메뉴"
                actions={overflowActions}
                className="-my-2 shrink-0"
              />
            ) : null}
          </div>
          <DialogDescription className="text-caption break-words">
            {formatDate(occurredAt(txn))}
          </DialogDescription>
        </DialogHeader>

        {/* 금액이 먼저 — 무엇을 얼마에 결제했나. 확인이 필요한 거래는 할 일을 바로 아래에 둔다. */}
        {editing ? (
          <section
            aria-labelledby={`${inputId}-heading`}
            className="bg-muted flex min-w-0 flex-col gap-2 rounded-card p-4"
          >
            <h3
              className="text-caption text-muted-foreground"
              id={`${inputId}-heading`}
            >
              금액·날짜 수정 · 저장을 눌러야 반영돼요
            </h3>
            <Label htmlFor={`${inputId}-amount`}>금액</Label>
            <Input
              id={`${inputId}-amount`}
              ref={amountInput}
              inputMode="numeric"
              aria-invalid={Boolean(editErrors.amount)}
              aria-describedby={
                editErrors.amount ? `${inputId}-amount-error` : undefined
              }
              value={editAmount}
              disabled={busy || !canEditAmount}
              className="min-h-11 bg-background"
              onChange={(e) => {
                setEditAmount(e.target.value);
                setEditErrors((errors) => ({ ...errors, amount: undefined }));
                setEditError(null);
              }}
            />
            {editErrors.amount ? (
              <p
                id={`${inputId}-amount-error`}
                role="alert"
                className="text-destructive text-caption"
              >
                {editErrors.amount}
              </p>
            ) : null}
            <Label htmlFor={`${inputId}-date`}>
              날짜/시각 (이 기기의 시간)
            </Label>
            <Input
              id={`${inputId}-date`}
              ref={dateInput}
              type="datetime-local"
              aria-invalid={Boolean(editErrors.occurredAt)}
              aria-describedby={
                editErrors.occurredAt ? `${inputId}-date-error` : undefined
              }
              value={editDate}
              disabled={busy}
              className="min-h-11 min-w-0 w-full bg-background"
              onChange={(e) => {
                setEditDate(e.target.value);
                setEditErrors((errors) => ({
                  ...errors,
                  occurredAt: undefined,
                }));
                setEditError(null);
              }}
            />
            {editErrors.occurredAt ? (
              <p
                id={`${inputId}-date-error`}
                role="alert"
                className="text-destructive text-caption"
              >
                {editErrors.occurredAt}
              </p>
            ) : null}
            {editError ? (
              <p role="alert" className="text-destructive text-caption">
                {editError}
              </p>
            ) : null}
            {!canEditAmount ? (
              <p className="text-muted-foreground text-caption">
                취소가 연결된 거래는 금액을 바꿀 수 없어요. 날짜만 수정돼요.
              </p>
            ) : null}
            <div
              className="sticky bottom-0 flex justify-end gap-2 bg-muted py-2"
              aria-busy={editSaving}
            >
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11 min-w-20"
                disabled={busy}
                onClick={cancelEdit}
              >
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                className="min-h-11 min-w-20"
                disabled={busy || !editDirty}
                onClick={() => void saveEdits()}
              >
                {editSaving ? "저장 중…" : "저장"}
              </Button>
            </div>
          </section>
        ) : (
          <section
            aria-label={isCancellation ? "취소 금액" : "결제 금액"}
            className="flex min-w-0 flex-col gap-3"
          >
            <p
              className={cn(
                "text-display break-all tabular-nums",
                excluded && "text-muted-foreground line-through"
              )}
            >
              {isCancellation ? (
                <Money amount={-txn.amount} currency={txn.currency} />
              ) : (
                <Money amount={txn.netAmount} currency={txn.currency} />
              )}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {isCancellation ? (
                <StatusChip tone="neutral">
                  {TYPE_LABELS[txn.transactionType]} 거래
                </StatusChip>
              ) : null}
              <StatusBadge status={txn.status} />
              {installment ? (
                <StatusChip tone="neutral">{installment}개월 할부</StatusChip>
              ) : null}
              {foreign ? (
                <StatusChip tone="neutral">해외 결제</StatusChip>
              ) : null}
              {excluded ? (
                <StatusChip tone="neutral">합계에서 제외됨</StatusChip>
              ) : null}
            </div>
            {isPending ? (
              <Button
                className="h-11 w-full"
                disabled={busy}
                onClick={onMarkValid}
              >
                정상 거래로 확인하기
              </Button>
            ) : null}
            {canLink ? (
              <Button
                variant="tint"
                className="h-11 w-full"
                disabled={busy}
                onClick={onOpenLink}
              >
                원래 결제와 연결하기
              </Button>
            ) : null}
            {!isCancellation && excluded ? (
              <Button
                variant="tint"
                className="h-11 w-full"
                disabled={busy}
                onClick={onInclude}
              >
                다시 합계에 포함하기
              </Button>
            ) : null}
          </section>
        )}

        {editNotice ? (
          <p
            role="status"
            aria-live="polite"
            className="text-muted-foreground text-caption"
          >
            {editNotice}
          </p>
        ) : null}
        {actionBusy ? (
          <p role="status" className="text-muted-foreground text-caption">
            변경 내용을 처리하고 있어요.
          </p>
        ) : actionError && !editing ? (
          <p role="alert" className="text-destructive text-caption">
            {actionError}
          </p>
        ) : null}

        {/* 결제 정보 — 문장 대신 훑어보는 키-값 */}
        {/*
          정보·설정 한 목록(2026-11-05 사용자 지적으로 '분류' 칸 묶음을 합쳤다). 바꾸는 줄은 눌러서
          선택 시트를 열고, 고르면 바로 저장된다. 가장 자주 바꾸는 카테고리를 결제자 바로 아래에 둔다.
        */}
        <FieldList>
          <FieldRow label="결제자" value={memberName} />
          <FieldRow
            label="카테고리"
            value={categoryLabel ?? "미분류"}
            muted={categoryLabel == null}
            disabled={busy}
            onClick={() => setPicker("category")}
          />
          <FieldRow
            label="카드"
            value={cardLabel}
            muted={txn.cardId == null}
            disabled={busy}
            onClick={() => setPicker("card")}
          >
            {ownershipMismatch ? (
              <span role="status" className="text-warning-strong">
                거래 구성원과 카드 소유자가 달라요. 올바른 카드인지 확인해 주세요.
              </span>
            ) : txn.cardId == null || txn.status === "pending_review" ? (
              "카드에 연결하면 공개 범위가 카드 설정을 따라가요."
            ) : null}
          </FieldRow>
          <FieldRow
            label="공개 범위"
            value={visibilityLabel}
            disabled={busy}
            onClick={() => setPicker("visibility")}
          />
          <FieldRow
            label="메모"
            value={
              txn.memo ? (
                <span className="line-clamp-2">{txn.memo}</span>
              ) : (
                "남기기"
              )
            }
            muted={!txn.memo}
            disabled={busy}
            onClick={onOpenMemo}
          />
          {installment ? (
            <FieldRow label="할부" value={`${installment}개월`}>
              {/*
                할부는 **승인월에 전액** 계상된다. `installmentMonths`는 보관만 되고
                집계·예산·정기지출 어디에서도 월 분할에 쓰이지 않는다
                (`transaction-money.service.ts`의 metadata pass-through).

                실측(2026-07): 표시 총액 752,721원 중 198,290원(26.3%)이 3개월 할부
                전액이었다. 그 사실을 말하지 않으면 카드 명세서와 대조할 때 어느 달도
                맞지 않고, 사용자는 앱이 틀렸다고 판단한다. 실제 월 분할은 금액 계약
                (ADR-0027)을 건드리므로 별건이고, 여기서는 **정직하게 말하는 것**만 한다.
              */}
              이 달 합계에는 전액 {formatMoney(txn.netAmount, txn.currency)}이
              들어가 있어요 (월{" "}
              {formatMoney(
                Math.round(txn.netAmount / installment),
                txn.currency
              )}
              씩).
            </FieldRow>
          ) : null}
          {foreign ? (
            <FieldRow
              label="해외 결제"
              value={formatMoney(
                txn.originalAmount as number,
                txn.originalCurrency as string
              )}
            >
              <TransactionFxDetails
                currency={txn.originalCurrency as string}
                exchangeRate={txn.exchangeRate}
                fx={txn.fx}
              />
            </FieldRow>
          ) : null}
          {partiallyCancelled ? (
            <FieldRow
              label="취소"
              value={
                <>
                  원래 {formatMoney(txn.amount, txn.currency)} 중{" "}
                  {formatMoney(txn.cancelledAmount, txn.currency)} 취소
                </>
              }
            />
          ) : null}
        </FieldList>

        {/* 분류 변경이 저장 중이거나 저장됐을 때만 — 실패하면 묻지 않는다(오류는 위에서 말한다). */}
        {ruleFor && (ruleReady || busy) ? (
          <div
            className="bg-muted flex flex-col gap-2 rounded-control p-3"
            role="status"
          >
            {ruleState === "applied" ? (
              <p className="text-caption">
                앞으로 들어오는 {merchant} 결제는 &lsquo;{ruleFor.name}
                &rsquo;(으)로 분류해요.
              </p>
            ) : (
              <>
                <p className="text-caption">
                  앞으로 들어오는 {merchant} 결제도 &lsquo;{ruleFor.name}
                  &rsquo;(으)로 분류할까요? 지난 거래는 그대로예요.
                </p>
                <Button
                  type="button"
                  variant="tint"
                  size="sm"
                  className="min-h-10 self-start"
                  disabled={!ruleReady || busy || ruleState === "saving"}
                  onClick={() => void applyRuleForMerchant()}
                >
                  {ruleState === "saving"
                    ? "저장 중…"
                    : "앞으로도 이렇게 분류"}
                </Button>
              </>
            )}
          </div>
        ) : null}

        {/* 알맞은 카테고리가 없으면 카테고리 시트의 '새 카테고리 만들기'로 여기서 바로 만들어 지정한다. */}
        {creatingCategory ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-2">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitNewCategory();
                  }
                }}
                placeholder="새 카테고리 이름"
                maxLength={20}
                autoFocus
                disabled={categorySaving}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => void submitNewCategory()}
                disabled={categorySaving || newCategoryName.trim() === ""}
              >
                저장
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreatingCategory(false);
                  setNewCategoryName("");
                  setCategoryError(null);
                }}
                disabled={categorySaving}
              >
                취소
              </Button>
            </div>
            {categoryError ? (
              <p className="text-destructive text-caption">
                {categoryError}
              </p>
            ) : null}
          </div>
        ) : null}

        <PickerSheet
          open={picker === "category"}
          onClose={() => setPicker(null)}
          title="카테고리"
          options={categoryOptions}
          value={txn.categoryId}
          onSelect={(value) => {
            onChangeCategory(value);
            if (searchTerm) {
              setRuleFor({
                id: value,
                name:
                  categoryOptions.find((o) => o.value === value)?.label ??
                  "선택한 분류",
              });
              setRuleState("offered");
            }
          }}
          footer={
            <button
              type="button"
              onClick={() => {
                setPicker(null);
                setCreatingCategory(true);
              }}
              className="text-primary text-body -mx-2 flex min-h-12 items-center rounded-control px-2 text-left font-medium hover:bg-muted active:bg-muted"
            >
              + 새 카테고리 만들기
            </button>
          }
        />
        <PickerSheet
          open={picker === "card"}
          onClose={() => setPicker(null)}
          title="카드"
          options={[{ value: CARD_NONE, label: "카드 미연결" }, ...cardOptions]}
          value={txn.cardId ?? CARD_NONE}
          onSelect={onChangeCard}
        />
        <PickerSheet
          open={picker === "visibility"}
          onClose={() => setPicker(null)}
          title="공개 범위"
          options={VISIBILITY_OPTIONS}
          value={txn.visibility}
          onSelect={onChangeVisibility}
        />

        {/* 가족에게 물어보기(확인 요청) — 자기 훅을 쓰는 독립 컴포넌트 */}
        <ReviewRequestAction txn={txn} disabled={busy} />

        {searchTerm ? (
          <MerchantHistory
            txn={txn}
            searchTerm={searchTerm}
            disabled={busy || editing}
            onOpen={onOpenTransaction}
          />
        ) : null}

        {/* 하드 삭제(되돌리기 불가) — ⋯ 메뉴에서 열고 확인을 한 번 더 받는다 */}
        <AlertDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>거래를 삭제할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                {merchant} · {formatMoney(txn.amount, txn.currency)} 거래가 영구
                삭제됩니다. 되돌릴 수 없어요. (합계에서만 빼려면 ⋯ 메뉴의
                &lsquo;합계에서 빼기&rsquo;를 쓰세요.)
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onDelete}
              >
                삭제하기
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="ghost"
            className="h-11 w-full"
            disabled={busy}
            onClick={requestClose}
          >
            닫기
          </Button>
        </DialogFooter>
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              (canEditAmount ? amountInput : dateInput).current?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>수정 내용을 버릴까요?</AlertDialogTitle>
              <AlertDialogDescription>
                아직 저장하지 않은 금액과 날짜가 있어요.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>계속 수정하기</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  editSession.current.invalidate();
                  setDiscardOpen(false);
                  onClose();
                }}
              >
                버리고 닫기
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** 상세 시트의 결제 정보 한 줄(키-값). */
/* -------------------------------------------------------------------------- */
/* Memo modal                                                                 */
/* -------------------------------------------------------------------------- */

/** Nested transaction dialogs take native back before the detail behind them. */
function useTransactionModalBack(onClose: () => void, busy: boolean) {
  const handler = useRef<(source: TransactionDetailBackSource) => void>(
    () => undefined
  );
  handler.current = (source) => {
    if (source === "browser" || !busy) onClose();
  };
  useEffect(
    () =>
      registerTransactionDetailBack(window, (source) =>
        handler.current(source)
      ),
    []
  );
}

function MemoModal({
  txn,
  busy,
  onClose,
  onSave,
}: Readonly<{
  txn: TransactionSummary;
  busy: boolean;
  onClose: () => void;
  onSave: (memo: string) => void;
}>) {
  useTransactionModalBack(onClose, busy);
  const [memo, setMemo] = useState(txn.memo ?? "");
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>메모 남기기</DialogTitle>
          <DialogDescription>
            {merchantLabel(txn)} 거래에 기억할 내용을 적어 주세요
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="memo-input" className="sr-only">
            메모
          </Label>
          <textarea
            id="memo-input"
            rows={4}
            maxLength={1000}
            value={memo}
            placeholder="예: 아이 생일 케이크, 부모님 선물이었어요"
            onChange={(e) => setMemo(e.target.value)}
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {busy ? (
            <p role="status" className="text-muted-foreground text-sm">
              저장 중이에요. 완료될 때까지 잠시 기다려 주세요.
            </p>
          ) : null}
          <Button
            variant="default"
            className="h-11 w-full"
            onClick={() => onSave(memo)}
            disabled={busy}
          >
            저장하기
          </Button>
          <Button
            variant="ghost"
            className="h-11 w-full"
            onClick={onClose}
            disabled={busy}
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Link-cancellation modal                                                    */
/* -------------------------------------------------------------------------- */

function LinkCancellationModal({
  cancellation,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  cancellation: TransactionSummary;
  busy: boolean;
  onClose: () => void;
  onConfirm: (approvalTransactionId: string) => void;
}>) {
  useTransactionModalBack(onClose, busy);
  const { authedFetch } = useAuth();
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");

  /*
   * 후보는 **서버가 좁혀 준다**(통화 · 잔액 ≥ 취소액 · 취소보다 앞선 승인 · 공개범위).
   *
   * 이전에는 `list({ type:"approval", limit:100 })`로 최근 100건을 받아 여기서 걸렀다.
   * 서버의 `MAX_LIMIT=100`이 상한이라 limit을 올려 우회할 수도 없어서, **승인이 100건을
   * 넘긴 뒤로는 오래된 결제에 연결할 방법이 아예 없었다**(실측 136건). 자격 조건을
   * 클라이언트에 다시 두지 않는 이유도 같다 — 규칙이 두 벌이면 "보이는데 저장하면
   * 거부되는" 후보가 생긴다.
   */
  const candidatesQuery = useQuery({
    queryKey: ["cancellation-candidates", cancellation.id],
    queryFn: () =>
      authedFetch((token) =>
        api.transactions.cancellationCandidates(token, cancellation.id)
      ),
  });

  const candidates = candidatesQuery.data?.items ?? [];

  // 표시용 좁히기(자격 판정이 아니다). 후보가 많아도 사용자가 금액·가맹점·날짜로 찾을
  // 수 있어야 한다 — 목록만 길게 뿌리면 100건 상한과 실질적으로 같아진다.
  const visible = candidates.filter((a) =>
    matchesCandidateSearch(
      {
        merchant: merchantLabel(a),
        amount: a.amount,
        remaining: a.amount - a.cancelledAmount,
        dateLabel: formatDate(a.approvedAt ?? a.createdAt, { dateOnly: true }),
      },
      search
    )
  );

  const options: Option[] = visible.map((a) => ({
    value: a.id,
    label: `${merchantLabel(a)} · 남은 금액 ${formatMoney(
      a.amount - a.cancelledAmount,
      a.currency
    )} · ${formatDate(a.approvedAt ?? a.createdAt, { dateOnly: true })}${
      a.excludedAt ? " · 합계 제외됨" : ""
    }`,
  }));

  // 고른 뒤 검색어를 바꿔 그 후보가 사라지면 선택을 버린다 — 안 그러면 화면에 보이지
  // 않는 승인에 연결 버튼이 살아 있어 엉뚱한 결제에 취소가 붙는다.
  const effectiveSelected = retainSelection(
    selected,
    visible.map((a) => a.id)
  );

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>어떤 결제를 취소한 건가요?</DialogTitle>
          <DialogDescription>
            이 취소 금액{" "}
            {formatMoney(cancellation.amount, cancellation.currency)}을 원래
            결제와 연결해 주세요. 연결하면 순지출이 자동으로 다시 계산돼요.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {candidatesQuery.isLoading ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              결제 내역을 불러오고 있어요…
            </p>
          ) : candidatesQuery.isError ? (
            /* "불러오지 못했어요"와 "연결할 결제가 없어요"는 다른 사실이다 —
               실패를 빈 목록으로 보여 주면 사용자가 없는 것으로 오해한다. */
            <p className="text-destructive text-sm" role="alert">
              결제 내역을 불러오지 못했어요:{" "}
              {errorMessage(candidatesQuery.error)}
            </p>
          ) : candidates.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-muted-foreground text-sm">
                연결할 수 있는 결제가 없어요
              </p>
              {/* 왜 없는지까지 알려 준다 — 조건을 모르면 사용자가 할 수 있는 일이 없다. */}
              <p className="text-muted-foreground mt-1 text-xs">
                이 취소 금액{" "}
                {formatMoney(cancellation.amount, cancellation.currency)} 이상이
                남은 같은 통화 결제가 아직 없어요. 원래 결제 문자가 아직
                수집되지 않았을 수도 있어요.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="link-approval-search">결제 찾기</Label>
              {/* 후보가 많을 때 훑지 않고 찾을 수 있어야 한다. 서버가 상한 없이 전량을
                  주므로 이 입력은 왕복 없이 즉시 좁힌다(자격 판정이 아니다). */}
              <div className="relative">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  id="link-approval-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="가맹점 · 금액 · 날짜로 좁히기"
                  className="h-11 pr-9 pl-9"
                />
                {search !== "" ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="검색어 지우기"
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>

              {options.length === 0 ? (
                /* 후보는 있는데 검색어가 걸러 낸 상태. 위의 "후보 0건"과 다른 사실이다. */
                <p className="text-muted-foreground py-4 text-center text-sm">
                  검색어와 맞는 결제가 없어요. 검색어를 지우면 후보{" "}
                  {candidates.length}건을 모두 볼 수 있어요.
                </p>
              ) : (
                <>
                  <Label htmlFor="link-approval">원래 결제</Label>
                  <Select value={effectiveSelected} onValueChange={setSelected}>
                    <SelectTrigger id="link-approval" className="w-full">
                      <SelectValue placeholder="결제를 골라 주세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    후보 {options.length}건
                    {options.length !== candidates.length
                      ? ` (전체 ${candidates.length}건 중)`
                      : ""}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {busy ? (
            <p role="status" className="text-muted-foreground text-sm">
              연결 중이에요. 완료될 때까지 잠시 기다려 주세요.
            </p>
          ) : null}
          <Button
            variant="default"
            className="h-11 w-full"
            onClick={() => onConfirm(effectiveSelected)}
            disabled={busy || effectiveSelected === ""}
          >
            연결하기
          </Button>
          <Button
            variant="ghost"
            className="h-11 w-full"
            onClick={onClose}
            disabled={busy}
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
