import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { FinanceConnectionRegister } from "@family/contracts";
import { connectionFixture as item } from "@/components/finance-connections/fixtures.test-support";
import { ApiError, apiFetch } from "./api-client";
import { financeConnectionsApi as api, financeConnectionKey, financeConnectionReadOptions } from "./finance-connections-client";
import { resetSharedManualFinanceQueries } from "./manual-finance-realtime";
import type { AccessToken } from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});
const otherId = "44444444-4444-4444-8444-444444444444";
const body: FinanceConnectionRegister = {
  householdId: item.householdId, connectionId: item.id,
  clientId: "synthetic-client", clientSecret: "synthetic-secret",
  consent: { ownAccount: true, storeCredentials: true, refreshOnOpen: true },
};
afterEach(() => vi.mocked(apiFetch).mockReset());

describe("financial connection direct client", () => {
  it("loads only the selected family/owner and rejects a foreign owner or family", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ enabled: true, disabledReason: null, items: [item] });
    await api.list(null, item.householdId, item.ownerUserId);
    expect(apiFetch).toHaveBeenCalledWith(`/v1/finance-connections?householdId=${item.householdId}`, { accessToken: null, signal: undefined });
    await expect(api.list(null, item.householdId, otherId)).rejects.toThrow("context mismatch");
    await expect(api.list(null, otherId, item.ownerUserId)).rejects.toThrow("context mismatch");
  });
  it("returns disabled configuration without pretending to have a connection", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ enabled: false, disabledReason: "not_configured", items: [] });
    expect(await api.list(null, item.householdId, item.ownerUserId)).toEqual({ enabled: false, disabledReason: "not_configured", items: [] });
  });
  it("rejects a mixed owner response before either asset or management presentation receives it", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ enabled: true, disabledReason: null, items: [item, { ...item, id: otherId, ownerUserId: otherId }] });
    await expect(api.list(null, item.householdId, item.ownerUserId)).rejects.toThrow("context mismatch");
  });
  it("sends explicit consent and secrets only in the registration body then clears its copy", async () => {
    let sent: unknown;
    vi.mocked(apiFetch).mockImplementation(async (_path, options) => { sent = structuredClone(options?.body); return { item }; });
    await api.register(null, body, item.ownerUserId);
    expect(sent).toEqual(body);
    const [path, options] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/v1/finance-connections/toss");
    expect(options?.body).toMatchObject({ clientId: "", clientSecret: "" });
    expect(body.clientSecret).toBe("synthetic-secret");
  });
  it("will not send credentials without all three explicit confirmations", async () => {
    for (const name of ["ownAccount", "storeCredentials", "refreshOnOpen"] as const)
      await expect(api.register(null, { ...body, consent: { ...body.consent, [name]: false } } as unknown as FinanceConnectionRegister, item.ownerUserId)).rejects.toThrow();
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("rejects secret-bearing or foreign-record response DTOs", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ item: { ...item, clientSecret: "unexpected" } });
    await expect(api.register(null, body, item.ownerUserId)).rejects.toThrow();
    vi.mocked(apiFetch).mockResolvedValue({ item: { ...item, id: otherId } });
    await expect(api.register(null, body, item.ownerUserId)).rejects.toThrow("context mismatch");
  });
  it("retains exact provider decimal strings", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ item: { ...item, snapshot: { ...item.snapshot!, totals: [{ currency: "KRW", marketValue: "99999999999999999999.0001", afterCostValue: "0" }] } } });
    const response = await api.refresh(null, item.id, { householdId: item.householdId, expectedVersion: 1, requestId: otherId }, item.ownerUserId);
    expect(response.item.snapshot?.totals[0]?.marketValue).toBe("99999999999999999999.0001");
  });
  it("rejects ambiguous currencies and a selection outside the provider account options", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ item: { ...item, snapshot: { ...item.snapshot!, totals: [item.snapshot!.totals[0], item.snapshot!.totals[0]] } } });
    await expect(api.refresh(null, item.id, { householdId: item.householdId, expectedVersion: 1, requestId: otherId }, item.ownerUserId)).rejects.toMatchObject({
      name: "ZodError", issues: [{ code: "custom", path: ["item", "snapshot", "totals"] }],
    });
    vi.mocked(apiFetch).mockResolvedValue({ item: { ...item, selectedAccountId: "b".repeat(64) } });
    await expect(api.register(null, body, item.ownerUserId)).rejects.toThrow("selection mismatch");
  });
  it("sends opaque verified account selection and versioned disconnect bodies", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ item });
    const select = { householdId: item.householdId, expectedVersion: 1, accountId: "a".repeat(64) };
    await api.selectAccount(null, item.id, select, item.ownerUserId);
    expect(apiFetch).toHaveBeenLastCalledWith(`/v1/finance-connections/${item.id}/account`, { accessToken: null, method: "POST", body: select, signal: undefined });
    const disconnect = { householdId: item.householdId, expectedVersion: 1 };
    await api.disconnect(null, item.id, disconnect, item.ownerUserId);
    expect(apiFetch).toHaveBeenLastCalledWith(`/v1/finance-connections/${item.id}`, { accessToken: null, method: "DELETE", body: disconnect, signal: undefined });
    await expect(api.selectAccount(null, item.id, { ...select, accountId: "raw-account" }, item.ownerUserId)).rejects.toThrow();
  });
  it("drops unsafe server error bodies while keeping status for auth refresh", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(401, "synthetic-secret", { clientSecret: "synthetic-secret" }, "synthetic-secret"));
    const error = await api.list(null, item.householdId, item.ownerUserId).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, body: undefined, serverMessage: null });
    expect(JSON.stringify(error)).not.toContain("synthetic-secret");
  });
  it("never sends after abort or exposes a response arriving after navigation", async () => {
    const aborted = new AbortController(); aborted.abort();
    await expect(api.register(null, body, item.ownerUserId, aborted.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(apiFetch).not.toHaveBeenCalled();
    const late = new AbortController();
    vi.mocked(apiFetch).mockImplementation(async () => { late.abort(); return { item }; });
    await expect(api.register(null, body, item.ownerUserId, late.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

const authed = <T,>(request: (token: AccessToken) => Promise<T>) => request(null);
describe("membership revalidation GET", () => {
  it("deduplicates simultaneous asset/management reads and keeps subsequent invalidation GET-only", async () => {
    const qc = new QueryClient();
    let resolve!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const firstOptions = financeConnectionReadOptions(item.householdId, item.ownerUserId, authed, () => {});
    const secondOptions = financeConnectionReadOptions(item.householdId, item.ownerUserId, authed, () => {});
    const first = qc.fetchQuery(firstOptions);
    const second = qc.fetchQuery(secondOptions);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    resolve({ enabled: true, disabledReason: null, items: [item] });
    await Promise.all([first, second]);
    vi.mocked(apiFetch).mockResolvedValue({ enabled: true, disabledReason: null, items: [item] });
    await resetSharedManualFinanceQueries(qc, item.householdId);
    await qc.fetchQuery(secondOptions);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiFetch).mock.calls.every(([path, request]) => path.startsWith("/v1/finance-connections?") && !request?.method && !request?.body)).toBe(true);
    qc.clear();
  });
  it.each([401, 403])("clears local snapshot/input before an initial or repeated %i response", async (status) => {
    let visible = true;
    let inputPresent = true;
    vi.mocked(apiFetch).mockImplementation(async () => {
      expect(visible).toBe(false);
      expect(inputPresent).toBe(false);
      throw new ApiError(status, "synthetic rejection");
    });
    const options = financeConnectionReadOptions(item.householdId, item.ownerUserId, authed, () => { visible = false; inputPresent = false; });
    await expect(options.queryFn({ signal: new AbortController().signal })).rejects.toMatchObject({ status });
    expect(visible).toBe(false);
  });
  it("separates identity caches and uses GET only for every existing refresh trigger", async () => {
    expect(financeConnectionKey(item.householdId, item.ownerUserId)).not.toEqual(financeConnectionKey(item.householdId, otherId));
    vi.mocked(apiFetch).mockResolvedValue({ enabled: true, disabledReason: null, items: [item] });
    const beforeRead = vi.fn();
    const options = financeConnectionReadOptions(item.householdId, item.ownerUserId, authed, beforeRead);
    await options.queryFn({ signal: new AbortController().signal });
    await options.queryFn({ signal: new AbortController().signal });
    expect(beforeRead).toHaveBeenCalledTimes(2);
    expect(options.gcTime).toBe(0);
    expect(options.retry).toBe(false);
    expect(vi.mocked(apiFetch).mock.calls.every(([path, request]) => path.startsWith("/v1/finance-connections?") && !request?.method && !request?.body)).toBe(true);
  });
  it("does not restore a late scoped GET after membership invalidation", async () => {
    const qc = new QueryClient();
    let resolve!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const options = financeConnectionReadOptions(item.householdId, item.ownerUserId, authed, () => {});
    const pending = qc.fetchQuery(options).catch(() => undefined);
    await resetSharedManualFinanceQueries(qc, item.householdId);
    resolve({ enabled: true, disabledReason: null, items: [item] });
    await pending;
    expect(qc.getQueryData(options.queryKey)).toBeUndefined();
    qc.clear();
  });
});
