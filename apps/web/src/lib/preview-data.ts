import type { TransactionSummary } from "@family/contracts";

/** Read-only fixtures for rendering the real dashboard without a local API. */
export const PREVIEW_HOUSEHOLD_ID = "11111111-1111-4111-8111-111111111111";
export const PREVIEW_USER_ID = "22222222-2222-4222-8222-222222222222";
export const PREVIEW_MEMBER_ID = "33333333-3333-4333-8333-333333333333";
export const PREVIEW_PARTNER_ID = "44444444-4444-4444-8444-444444444444";
export const PREVIEW_CARD_ID = "66666666-6666-4666-8666-666666666666";
export const PREVIEW_CARD_ID_2 = "77777777-7777-4777-8777-777777777777";
export const PREVIEW_CATEGORY_IDS = {
  food: "88888888-8888-4888-8888-888888888888",
  cafe: "99999999-9999-4999-8999-999999999999",
  life: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  transport: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  health: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  shopping: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  income: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
};

const from = "2026-11-01T00:00:00.000Z";
const to = "2026-12-01T00:00:00.000Z";
const meta = {
  period: { from, to, timezone: "Asia/Seoul" },
  cancellationApplied: true,
  includedMemberIds: [PREVIEW_MEMBER_ID, PREVIEW_PARTNER_ID],
  excludedByPermission: 0,
  excludedManual: { count: 0, net: 0 },
  excludedTransfer: { count: 0, net: 0 },
};

const monthly = {
  meta,
  totalNet: 2_486_300,
  totalApproved: 2_510_300,
  totalCancelled: 24_000,
  transactionCount: 42,
  previousNet: 2_820_000,
  deltaNet: -333_700,
  deltaRate: -0.1183,
};

const categories = {
  meta,
  items: [
    { categoryId: "food", categorySlug: "food", categoryName: "식비", net: 684_200, ratio: 0.275, count: 16 },
    { categoryId: "life", categorySlug: "life", categoryName: "생활", net: 412_500, ratio: 0.166, count: 9 },
    { categoryId: "transport", categorySlug: "transport", categoryName: "교통", net: 198_000, ratio: 0.08, count: 5 },
  ],
};

const memberBreakdown = {
  meta,
  items: [
    { memberId: PREVIEW_MEMBER_ID, name: "나", net: 1_382_000, ratio: 0.556, count: 24 },
    { memberId: PREVIEW_PARTNER_ID, name: "배우자", net: 1_104_300, ratio: 0.444, count: 18 },
  ],
};

const householdMembers = [
  { memberId: PREVIEW_MEMBER_ID, userId: PREVIEW_USER_ID, name: "나", email: "preview@example.test", role: "owner", status: "active", color: "sky", joinedAt: from },
  { memberId: PREVIEW_PARTNER_ID, userId: "55555555-5555-4555-8555-555555555555", name: "배우자", email: "partner@example.test", role: "member", status: "active", color: "emerald", joinedAt: from },
];

const cards = [
  { id: PREVIEW_CARD_ID, householdId: PREVIEW_HOUSEHOLD_ID, ownerMemberId: PREVIEW_MEMBER_ID, issuer: "신한카드", alias: "신한 Deep Dream", maskedNumber: "4821", visibility: "household", isShared: false, status: "active", billingDay: 14, createdAt: from },
  { id: PREVIEW_CARD_ID_2, householdId: PREVIEW_HOUSEHOLD_ID, ownerMemberId: PREVIEW_PARTNER_ID, issuer: "현대카드", alias: "현대카드 M", maskedNumber: "1904", visibility: "household", isShared: false, status: "active", billingDay: 22, createdAt: from },
];

const categoriesList = [
  { id: PREVIEW_CATEGORY_IDS.food, slug: "food", name: "식비", isSystem: true },
  { id: PREVIEW_CATEGORY_IDS.cafe, slug: "cafe", name: "카페", isSystem: true },
  { id: PREVIEW_CATEGORY_IDS.life, slug: "life", name: "생활", isSystem: true },
  { id: PREVIEW_CATEGORY_IDS.transport, slug: "transport", name: "교통", isSystem: true },
  { id: PREVIEW_CATEGORY_IDS.health, slug: "health", name: "건강", isSystem: true },
  { id: PREVIEW_CATEGORY_IDS.shopping, slug: "shopping", name: "쇼핑", isSystem: true },
  { id: PREVIEW_CATEGORY_IDS.income, slug: "income", name: "수입", isSystem: true },
];

const transactionSeed = [
  ["2026-11-07T03:24:00.000Z", "마켓컬리", 42800, "food", PREVIEW_MEMBER_ID, PREVIEW_CARD_ID],
  ["2026-11-06T11:40:00.000Z", "스타벅스 강남R점", 12500, "cafe", PREVIEW_PARTNER_ID, PREVIEW_CARD_ID_2],
  ["2026-11-06T02:15:00.000Z", "우리동네마트", 36700, "food", PREVIEW_MEMBER_ID, PREVIEW_CARD_ID],
  ["2026-11-05T08:20:00.000Z", "서울교통공사", 1550, "transport", PREVIEW_PARTNER_ID, PREVIEW_CARD_ID_2],
  ["2026-11-04T04:12:00.000Z", "올리브영", 28900, "life", PREVIEW_MEMBER_ID, PREVIEW_CARD_ID],
  ["2026-11-03T10:50:00.000Z", "배달의민족", 32600, "food", PREVIEW_PARTNER_ID, PREVIEW_CARD_ID_2],
  ["2026-11-02T01:06:00.000Z", "동네소아과", 18000, "health", PREVIEW_MEMBER_ID, PREVIEW_CARD_ID],
  ["2026-11-01T06:40:00.000Z", "쿠팡", 54300, "shopping", PREVIEW_PARTNER_ID, PREVIEW_CARD_ID_2],
  ["2026-10-31T09:30:00.000Z", "파리바게뜨", 8900, "food", PREVIEW_MEMBER_ID, PREVIEW_CARD_ID],
  ["2026-10-30T03:15:00.000Z", "GS25 역삼점", 7200, "food", PREVIEW_PARTNER_ID, PREVIEW_CARD_ID_2],
  ["2026-10-29T00:00:00.000Z", "급여", 3_800_000, "income", PREVIEW_MEMBER_ID, null],
  ["2026-10-28T11:10:00.000Z", "메가커피", 4300, "cafe", PREVIEW_PARTNER_ID, PREVIEW_CARD_ID_2],
  ["2026-10-27T04:45:00.000Z", "이마트", 86700, "food", PREVIEW_MEMBER_ID, PREVIEW_CARD_ID],
  ["2026-10-26T02:30:00.000Z", "다이소", 12000, "life", PREVIEW_PARTNER_ID, PREVIEW_CARD_ID_2],
] as const;

const transactions: TransactionSummary[] = transactionSeed.map(([approvedAt, merchant, amount, category, memberId, cardId], index) => ({
  id: `f0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  householdId: PREVIEW_HOUSEHOLD_ID,
  memberId,
  cardId,
  transactionType: "approval",
  status: "approved",
  amount,
  cancelledAmount: 0,
  netAmount: amount,
  currency: "KRW",
  originalAmount: null,
  originalCurrency: null,
  exchangeRate: null,
  fx: null,
  merchantRaw: merchant,
  merchantNormalized: merchant,
  categoryId: PREVIEW_CATEGORY_IDS[category],
  categorySlug: category,
  approvedAt,
  cancelledAt: null,
  installmentMonths: null,
  parentTransactionId: null,
  visibility: "household",
  memo: null,
  masked: false,
  excludedAt: null,
  createdAt: approvedAt,
}));

transactions.push(
  {
    ...transactions[0],
    id: "f0000000-0000-4000-8000-000000000015",
    status: "pending_review",
    merchantRaw: "온라인 결제",
    merchantNormalized: "온라인 결제",
    approvedAt: "2026-11-07T04:05:00.000Z",
    createdAt: "2026-11-07T04:05:00.000Z",
    amount: 24900,
    netAmount: 24900,
    categoryId: null,
    categorySlug: null,
  },
  {
    ...transactions[1],
    id: "f0000000-0000-4000-8000-000000000016",
    status: "duplicate_suspected",
    merchantRaw: "스타벅스 강남R점",
    merchantNormalized: "스타벅스 강남R점",
    approvedAt: "2026-11-06T11:42:00.000Z",
    createdAt: "2026-11-06T11:42:00.000Z",
  },
  {
    ...transactions[2],
    id: "f0000000-0000-4000-8000-000000000017",
    status: "partially_cancelled",
    amount: 36700,
    cancelledAmount: 6700,
    netAmount: 30000,
  },
  {
    ...transactions[2],
    id: "f0000000-0000-4000-8000-000000000018",
    transactionType: "cancellation",
    amount: 6700,
    cancelledAmount: 0,
    netAmount: 0,
    approvedAt: null,
    cancelledAt: "2026-11-06T05:30:00.000Z",
    parentTransactionId: transactions[2].id,
  },
);

const manualAssets = [
  { id: "a0000000-0000-4000-8000-000000000001", householdId: PREVIEW_HOUSEHOLD_ID, ownerUserId: PREVIEW_USER_ID, version: 1, createdAt: from, updatedAt: from, canEdit: true, kind: "account", label: "생활비 통장", visibility: "household", amount: "8000000", asOfDate: "2026-11-07", source: "manual", legalOwnerLabel: null, note: null, currency: "KRW" },
  { id: "a0000000-0000-4000-8000-000000000002", householdId: PREVIEW_HOUSEHOLD_ID, ownerUserId: PREVIEW_USER_ID, version: 1, createdAt: from, updatedAt: from, canEdit: true, kind: "saving", label: "주택청약", visibility: "household", amount: "10000000", asOfDate: "2026-11-01", source: "manual", legalOwnerLabel: null, note: null, currency: "KRW" },
  { id: "a0000000-0000-4000-8000-000000000003", householdId: PREVIEW_HOUSEHOLD_ID, ownerUserId: PREVIEW_USER_ID, version: 1, createdAt: from, updatedAt: from, canEdit: true, kind: "saving", label: "가족 적금", visibility: "household", amount: "20000000", asOfDate: "2026-11-01", source: "manual", legalOwnerLabel: null, note: null, currency: "KRW" },
  { id: "a0000000-0000-4000-8000-000000000004", householdId: PREVIEW_HOUSEHOLD_ID, ownerUserId: PREVIEW_USER_ID, version: 1, createdAt: from, updatedAt: from, canEdit: true, kind: "account", label: "비상금 통장", visibility: "household", amount: "5000000", asOfDate: "2026-11-07", source: "manual", legalOwnerLabel: null, note: null, currency: "KRW" },
  { id: "a0000000-0000-4000-8000-000000000005", householdId: PREVIEW_HOUSEHOLD_ID, ownerUserId: PREVIEW_PARTNER_ID, version: 1, createdAt: from, updatedAt: from, canEdit: true, kind: "stock", label: "투자 계좌", visibility: "household", amount: "6000000", asOfDate: "2026-11-07", source: "manual", legalOwnerLabel: null, note: null, currency: "KRW" },
  { id: "a0000000-0000-4000-8000-000000000006", householdId: PREVIEW_HOUSEHOLD_ID, ownerUserId: PREVIEW_USER_ID, version: 1, createdAt: from, updatedAt: from, canEdit: true, kind: "loan", label: "주택 대출", visibility: "household", amount: "128000000", asOfDate: "2026-11-01", source: "manual", legalOwnerLabel: null, note: null, currency: "KRW" },
];
const assetSummary = { currency: "KRW", grossAssets: "49000000", debt: "128000000", netAssets: "-79000000", assetsCompleteness: "complete", debtCompleteness: "complete", completeness: "complete", asOfDate: "2026-11-07", oldestAsOfDate: "2026-11-01", newestAsOfDate: "2026-11-07", mixedAsOfDates: true };

function responseFor(path: string): unknown {
  const url = new URL(path, "http://preview.local");
  const route = url.pathname;
  if (route === "/v1/analytics/monthly") return monthly;
  if (route === "/v1/analytics/categories") return categories;
  if (route === "/v1/analytics/members") return memberBreakdown;
  if (route === "/v1/analytics/months") return { timezone: "Asia/Seoul", items: [{ month: "2026-11", net: 2_486_300, count: 42 }, { month: "2026-10", net: 2_820_000, count: 49 }] };
  if (route === "/v1/analytics/cards") return { meta, items: [{ cardId: PREVIEW_CARD_ID, alias: "신한 Deep Dream", issuer: "신한카드", net: 1_240_000, ratio: 0.5, count: 20 }, { cardId: PREVIEW_CARD_ID_2, alias: "현대카드 M", issuer: "현대카드", net: 1_246_300, ratio: 0.5, count: 22 }] };
  if (route === "/v1/budgets") return {
    month: url.searchParams.get("month") ?? "2026-11",
    items: [
      { id: "budget-food", householdId: PREVIEW_HOUSEHOLD_ID, name: "식비", scopeType: "category", scopeRefId: "food", cardIds: [], scopeLabel: "식비", effectiveMonth: "2026-11", amount: 900_000, spent: 684_200, threeMonthAverageSpent: 710_000, remaining: 215_800, usageRate: 0.7602, period: "monthly", currency: "KRW" },
      { id: "budget-life", householdId: PREVIEW_HOUSEHOLD_ID, name: "생활", scopeType: "category", scopeRefId: "life", cardIds: [], scopeLabel: "생활", effectiveMonth: "2026-11", amount: 500_000, spent: 312_500, threeMonthAverageSpent: 325_000, remaining: 187_500, usageRate: 0.625, period: "monthly", currency: "KRW" },
    ],
  };
  if (route === `/v1/households/${PREVIEW_HOUSEHOLD_ID}/members`) return householdMembers;
  if (route === "/v1/cards") return cards;
  if (route === "/v1/categories") return categoriesList;
  if (route === "/v1/fx/reference") return { baseCurrency: "USD", quoteCurrency: "KRW", rate: "1425.5", asOfDate: "2026-11-06", source: "ecb-reference" };
  if (route === "/v1/connected-accounts") return { sharing: { shared: true, consentedAt: from }, holdings: [] };
  if (route === "/v1/manual-finance/assets") return { items: manualAssets, summary: assetSummary };
  if (route === "/v1/financial-overview") return { manualItems: manualAssets, loanItems: [], summary: assetSummary, unresolvedLoans: 0 };
  if (route === "/v1/transactions/summary") return { period: { from, to, timezone: "Asia/Seoul" }, currency: "KRW", totalNet: 2_486_300, totalApproved: 2_510_300, totalCancelled: 24_000, includedMembers: [PREVIEW_MEMBER_ID, PREVIEW_PARTNER_ID], count: transactions.length };
  if (route === "/v1/card-sms-events/declines") return { items: [], unresolvedCount: 0 };
  if (route === "/v1/card-sms-events") return [];
  if (route === "/v1/transactions") {
    let items = [...transactions];
    const review = url.searchParams.get("review");
    const statuses = url.searchParams.get("status")?.split(",");
    const type = url.searchParams.get("type");
    const categoryId = url.searchParams.get("categoryId");
    const memberId = url.searchParams.get("memberId");
    const cardId = url.searchParams.get("cardId");
    const q = url.searchParams.get("q")?.trim().toLocaleLowerCase("ko");
    if (review === "1") items = items.filter((item) => item.status === "pending_review" || item.status === "duplicate_suspected");
    if (statuses?.length) items = items.filter((item) => statuses.includes(item.status));
    if (type) items = items.filter((item) => item.transactionType === type);
    if (categoryId) items = items.filter((item) => item.categoryId === categoryId);
    if (memberId) items = items.filter((item) => item.memberId === memberId);
    if (cardId) items = items.filter((item) => item.cardId === cardId);
    if (q) items = items.filter((item) => item.merchantNormalized?.toLocaleLowerCase("ko").includes(q));
    const fromDate = url.searchParams.get("from");
    const toDate = url.searchParams.get("to");
    if (fromDate) items = items.filter((item) => (item.approvedAt ?? "") >= fromDate);
    if (toDate) items = items.filter((item) => (item.approvedAt ?? "") < toDate);
    const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 30));
    return { items: items.slice(0, limit), nextCursor: null };
  }
  if (route === "/v1/transactions/merchant-label-candidates") return { items: [], hasMore: false, trainingReadiness: { humanConfirmedLabels: 0, requiredLabels: 100, distinctClasses: 0, requiredClasses: 2, minimumClassLabels: 0, requiredLabelsPerClass: 10, missingLineage: 0, status: "collect_labels" } };
  if (/^\/v1\/transactions\/[^/]+\/cancellation-candidates$/.test(route)) return { items: [], nextCursor: null };
  const transactionMatch = route.match(/^\/v1\/transactions\/([^/]+)$/);
  if (transactionMatch) {
    const transaction = transactions.find((item) => item.id === transactionMatch[1]);
    if (transaction) return transaction;
  }
  if (route === "/v1/review-requests") return { items: [] };
  if (route === "/v1/notifications/unread-count") return { count: 0 };
  if (route === `/v1/households/${PREVIEW_HOUSEHOLD_ID}`) return { id: PREVIEW_HOUSEHOLD_ID, name: "우리 가족", createdAt: from, myRole: "owner", sharedColor: null };
  if (route === "/v1/manual-finance/housing-plans") return { items: [], summary: { nextPayment: null, hasIncompletePayments: false } };
  if (route === "/v1/recurring/upcoming") return { enabled: false, until: url.searchParams.get("until") ?? to, items: [], totalAmount: 0, totalCurrency: "KRW", forecastableCount: 0, excludedCount: 0, otherCurrencyCount: 0 };
  throw new Error(`미리보기에서 지원하지 않는 API 요청이에요: ${route}`);
}

export function isDashboardPreview(): boolean {
  if (typeof window === "undefined") return false;
  const flag = new URLSearchParams(window.location.search).get("preview");
  try {
    if (flag === "1") window.sessionStorage.setItem("moa-dashboard-preview", "1");
    if (flag === "0") window.sessionStorage.removeItem("moa-dashboard-preview");
    return flag === "1" || (flag !== "0" && window.sessionStorage.getItem("moa-dashboard-preview") === "1");
  } catch {
    return flag === "1";
  }
}

export function getPreviewResponse<T>(path: string, method = "GET"): T {
  if (method !== "GET") throw new Error("미리보기는 읽기 전용이에요.");
  return responseFor(path) as T;
}
