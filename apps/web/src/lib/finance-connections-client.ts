"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  financeConnectionDisconnectSchema, financeConnectionListSchema, financeConnectionQuerySchema,
  financeConnectionRefreshSchema, financeConnectionRegisterSchema, financeConnectionResultSchema,
  financeConnectionSelectAccountSchema,
  type FinanceConnection, type FinanceConnectionDisconnect, type FinanceConnectionRefresh,
  type FinanceConnectionRegister, type FinanceConnectionSelectAccount,
} from "@family/contracts";
import { ApiError, apiFetch, type AccessToken } from "./api-client";
import { useAuth } from "./auth-context";

const base = "/v1/finance-connections";
function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
}
function assertContext(items: FinanceConnection[], householdId: string, userId: string, id?: string) {
  if (items.some((item) => item.householdId !== householdId || item.ownerUserId !== userId || (id && item.id !== id)))
    throw new Error("connection response context mismatch");
  if (new Set(items.map((item) => item.id)).size !== items.length || items.some((item) => {
    const accounts = item.accountOptions.map((account) => account.id);
    const currencies = item.snapshot?.totals.map((total) => total.currency) ?? [];
    return new Set(accounts).size !== accounts.length || new Set(currencies).size !== currencies.length ||
      (item.selectedAccountId !== null && !accounts.includes(item.selectedAccountId));
  })) throw new Error("connection response selection mismatch");
}
/** Never retain provider/server error bodies; keep only status for normal auth refresh. */
async function safeFetch(path: string, options: Parameters<typeof apiFetch>[1]) {
  try { return await apiFetch(path, options); }
  catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 0;
    throw new ApiError(status, "연결 요청을 완료하지 못했어요.");
  }
}
function result(raw: unknown, householdId: string, userId: string, id: string, signal?: AbortSignal) {
  checkSignal(signal);
  const parsed = financeConnectionResultSchema.parse(raw);
  assertContext([parsed.item], householdId, userId, id);
  return parsed;
}

/** Credential mutations bypass query/mutation caches and live only for their direct request. */
export const financeConnectionsApi = {
  async list(token: AccessToken, householdId: string, userId: string, signal?: AbortSignal) {
    checkSignal(signal);
    const query = new URLSearchParams(financeConnectionQuerySchema.parse({ householdId }));
    const parsed = financeConnectionListSchema.parse(await safeFetch(`${base}?${query}`, { accessToken: token, signal }));
    checkSignal(signal);
    assertContext(parsed.items, householdId, userId);
    return parsed;
  },
  async register(token: AccessToken, body: FinanceConnectionRegister, userId: string, signal?: AbortSignal) {
    checkSignal(signal);
    const request = financeConnectionRegisterSchema.parse(body);
    try {
      return result(await safeFetch(`${base}/toss`, { accessToken: token, method: "POST", body: request, signal }), body.householdId, userId, body.connectionId, signal);
    } finally {
      request.clientId = "";
      request.clientSecret = "";
    }
  },
  async selectAccount(token: AccessToken, id: string, body: FinanceConnectionSelectAccount, userId: string, signal?: AbortSignal) {
    checkSignal(signal);
    const request = financeConnectionSelectAccountSchema.parse(body);
    return result(await safeFetch(`${base}/${encodeURIComponent(id)}/account`, { accessToken: token, method: "POST", body: request, signal }), body.householdId, userId, id, signal);
  },
  async refresh(token: AccessToken, id: string, body: FinanceConnectionRefresh, userId: string, signal?: AbortSignal) {
    checkSignal(signal);
    const request = financeConnectionRefreshSchema.parse(body);
    return result(await safeFetch(`${base}/${encodeURIComponent(id)}/refresh`, { accessToken: token, method: "POST", body: request, signal }), body.householdId, userId, id, signal);
  },
  async disconnect(token: AccessToken, id: string, body: FinanceConnectionDisconnect, userId: string, signal?: AbortSignal) {
    checkSignal(signal);
    const request = financeConnectionDisconnectSchema.parse(body);
    return result(await safeFetch(`${base}/${encodeURIComponent(id)}`, { accessToken: token, method: "DELETE", body: request, signal }), body.householdId, userId, id, signal);
  },
};

export const financeConnectionKey = (householdId: string, userId: string) =>
  ["manual-finance", householdId, userId, "owner", "finance-connections"] as const;

export function financeConnectionReadOptions(householdId: string, userId: string,
  authedFetch: ReturnType<typeof useAuth>["authedFetch"], beforeRead: () => void) {
  return {
    queryKey: financeConnectionKey(householdId, userId),
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      beforeRead();
      return authedFetch((token) => financeConnectionsApi.list(token, householdId, userId, signal));
    },
    staleTime: 0, gcTime: 0, retry: false as const, refetchOnWindowFocus: false as const, refetchOnReconnect: false as const,
  };
}

/** Only validated, secret-free GET DTOs enter this short-lived scoped query. */
export function useOwnedFinanceConnections(householdId: string, userId: string, beforeRead: () => void) {
  const { authedFetch } = useAuth();
  const qc = useQueryClient();
  useEffect(() => () => {
    const queryKey = financeConnectionKey(householdId, userId);
    void qc.cancelQueries({ queryKey, exact: true });
    qc.removeQueries({ queryKey, exact: true });
  }, [householdId, qc, userId]);
  // Existing SSE/foreground/60-second authorization checks all enter this GET-only query.
  const query = useQuery(financeConnectionReadOptions(householdId, userId, authedFetch, beforeRead));
  const reread = useCallback(() => qc.resetQueries({ queryKey: financeConnectionKey(householdId, userId), exact: true }), [householdId, qc, userId]);
  return { ...query, reread };
}
