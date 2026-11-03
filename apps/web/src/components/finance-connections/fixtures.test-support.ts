import type { FinanceConnection } from "@family/contracts";

/** Synthetic fixtures only; no provider credentials/account identifiers are used. */
export const connectionFixture: FinanceConnection = {
  id: "11111111-1111-4111-8111-111111111111",
  householdId: "22222222-2222-4222-8222-222222222222",
  ownerUserId: "33333333-3333-4333-8333-333333333333",
  provider: "toss_securities", version: 1, status: "ready",
  visibility: "owner_only", includedInTotals: false, refreshOnOpen: true,
  consentedAt: "2020-01-01T00:00:00Z",
  accountOptions: [{ id: "a".repeat(64), type: "BROKERAGE", label: "합성 종합매매 계좌" }],
  selectedAccountId: "a".repeat(64),
  lastSuccessAt: "2020-01-01T00:00:00Z", lastAttemptAt: "2020-01-01T00:00:00Z",
  canRefresh: true, nextRefreshAt: null, errorCode: null,
  snapshot: {
    observedAt: "2020-01-01T00:00:00Z", valuationAt: null,
    totals: [{ currency: "KRW", marketValue: "123456.75", afterCostValue: "120000" }, { currency: "USD", marketValue: "98.001", afterCostValue: "90" }],
    items: [{ symbol: "SYNTH", name: "합성 주식", currency: "USD", quantity: "0.125", marketValue: "98.001", afterCostValue: "90" }],
  },
  createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
};
