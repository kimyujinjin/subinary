import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManualAsset } from "@family/contracts";
import { apiFetch } from "./api-client";
import { manualFinanceApi, manualFinanceKeys } from "./manual-finance-client";

vi.mock("./api-client", () => ({ apiFetch: vi.fn() }));
vi.mock("./auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("./household-context", () => ({ useHousehold: vi.fn() }));
const householdId = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const item: ManualAsset = {
  id,
  householdId,
  ownerUserId: "33333333-3333-4333-8333-333333333333",
  version: 1,
  createdAt: "2020-01-01T00:00:00Z",
  updatedAt: "2020-01-01T00:00:00Z",
  canEdit: true,
  kind: "account",
  visibility: "private",
  label: "합성 통장",
  amount: "99999999999999999999",
  currency: "KRW",
  asOfDate: "2020-01-01",
  source: "manual",
  legalOwnerLabel: null,
  note: null,
};
afterEach(() => vi.mocked(apiFetch).mockReset());
describe("manual finance isolated request keys", () => {
  it("separates account, family, visibility scope and resource caches", () => {
    const keys = [
      manualFinanceKeys.assets("family-a", "actor-a", "private"),
      manualFinanceKeys.assets("family-a", "actor-b", "private"),
      manualFinanceKeys.assets("family-b", "actor-a", "private"),
      manualFinanceKeys.assets("family-a", "actor-a", "household"),
      manualFinanceKeys.plans("family-a", "actor-a", "private"),
    ];
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(
      keys.length
    );
    expect(manualFinanceKeys.resource("family-a", "actor-a")).toEqual([
      "manual-finance",
      "family-a",
      "actor-a",
    ]);
  });
  it("sends a server scope and AbortSignal and never substitutes previous-family data", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [],
      summary: {
        currency: "KRW",
        grossAssets: null,
        debt: null,
        netAssets: null,
        assetsCompleteness: "empty",
        debtCompleteness: "empty",
        completeness: "empty",
        asOfDate: null,
        oldestAsOfDate: null,
        newestAsOfDate: null,
        mixedAsOfDates: false,
      },
    });
    const signal = new AbortController().signal;
    const result = await manualFinanceApi.listAssets(
      null,
      householdId,
      "household",
      signal
    );
    expect(apiFetch).toHaveBeenCalledWith(
      `/v1/manual-finance/assets?householdId=${householdId}&scope=household`,
      { accessToken: null, signal }
    );
    expect(result.items).toEqual([]);
    expect(result.summary.grossAssets).toBeNull();
  });
  it("preserves UUID, exact amount and version and makes only an explicit mutation request", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ item });
    const body = {
      id,
      householdId,
      kind: item.kind,
      visibility: item.visibility,
      label: item.label,
      amount: item.amount,
      asOfDate: item.asOfDate,
      source: item.source,
      legalOwnerLabel: null,
      note: null,
    };
    const result = await manualFinanceApi.createAsset(null, body);
    expect(result.item.amount).toBe("99999999999999999999");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/v1/manual-finance/assets", {
      accessToken: null,
      method: "POST",
      body,
    });
    const { id: _id, householdId: _householdId, ...fields } = body;
    await manualFinanceApi.updateAsset(null, householdId, id, {
      ...fields,
      expectedVersion: 1,
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      `/v1/manual-finance/assets/${id}?householdId=${householdId}`,
      {
        accessToken: null,
        method: "PATCH",
        body: { ...fields, expectedVersion: 1 },
      }
    );
  });
  it("uses only the manual-record endpoint for CAS deletion and current-read", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ deleted: true })
      .mockResolvedValueOnce({ item });
    expect(
      await manualFinanceApi.removeAsset(null, householdId, id, 2)
    ).toEqual({ deleted: true });
    expect(apiFetch).toHaveBeenLastCalledWith(
      `/v1/manual-finance/assets/${id}?householdId=${householdId}`,
      { accessToken: null, method: "DELETE", body: { expectedVersion: 2 } }
    );
    await manualFinanceApi.asset(null, householdId, id);
    expect(apiFetch).toHaveBeenLastCalledWith(
      `/v1/manual-finance/assets/${id}?householdId=${householdId}`,
      { accessToken: null, signal: undefined }
    );
  });
  it("rejects foreign-household, visibility or private-actor response rows before display", async () => {
    const summary = {
      currency: "KRW",
      grossAssets: null,
      debt: null,
      netAssets: null,
      assetsCompleteness: "empty",
      debtCompleteness: "empty",
      completeness: "empty",
      asOfDate: null,
      oldestAsOfDate: null,
      newestAsOfDate: null,
      mixedAsOfDates: false,
    };
    vi.mocked(apiFetch).mockResolvedValue({
      items: [{ ...item, householdId: id }],
      summary,
    });
    await expect(
      manualFinanceApi.listAssets(null, householdId, "private")
    ).rejects.toThrow("context mismatch");
    vi.mocked(apiFetch).mockResolvedValue({ items: [item], summary });
    await expect(
      manualFinanceApi.listAssets(null, householdId, "household")
    ).rejects.toThrow("context mismatch");
    await expect(
      manualFinanceApi.listAssets(null, householdId, "private", undefined, id)
    ).rejects.toThrow("context mismatch");
    vi.mocked(apiFetch).mockResolvedValue({
      item: { ...item, id: householdId },
    });
    await expect(manualFinanceApi.asset(null, householdId, id)).rejects.toThrow(
      "record mismatch"
    );
  });
});
