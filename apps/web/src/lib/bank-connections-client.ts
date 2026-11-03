"use client";
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assetConnectionCatalogSchema, bankConnectionDisconnectSchema, bankConnectionListSchema, bankConnectionRefreshSchema,
  bankConnectionRegisterSchema, bankConnectionResultSchema, bankCaptureMatchesSelector, type BankConnection, type BankConnectionDisconnect,
  type BankConnectionRefresh, type BankConnectionRegister,
} from "@family/contracts";
import { ApiError, apiFetch, type AccessToken } from "./api-client";
import { useAuth } from "./auth-context";

const base = "/v1/bank-connections";
const checkSignal = (signal?: AbortSignal) => signal?.throwIfAborted();
function context(items: BankConnection[], householdId: string, userId: string, id?: string) {
  if (new Set(items.map(item => item.id)).size !== items.length || items.some(item => item.householdId !== householdId
    || item.ownerUserId !== userId || (id && item.id !== id) || (item.snapshot && !bankCaptureMatchesSelector(item.selector, item.snapshot)))) {
    throw new Error("bank connection response context mismatch");
  }
}
async function safeFetch(path: string, options: Parameters<typeof apiFetch>[1]) {
  try { return await apiFetch(path, options); }
  catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 0;
    throw new ApiError(status, "은행 연결 요청을 완료하지 못했어요.");
  }
}
function result(raw: unknown, householdId: string, userId: string, id: string, signal?: AbortSignal) {
  checkSignal(signal);
  const parsed = bankConnectionResultSchema.parse(raw);
  context([parsed.item], householdId, userId, id);
  return parsed;
}
export const bankConnectionsApi = {
  async catalog(token: AccessToken, householdId: string, signal?: AbortSignal) {
    const parsed = assetConnectionCatalogSchema.parse(await safeFetch(`${base}/catalog?${new URLSearchParams({ householdId })}`, { accessToken: token, signal }));
    checkSignal(signal);
    if (new Set(parsed.items.map(item => item.provider)).size !== 4) throw new Error("bank capability mismatch");
    return parsed;
  },
  async list(token: AccessToken, householdId: string, userId: string, signal?: AbortSignal) {
    const parsed = bankConnectionListSchema.parse(await safeFetch(`${base}?${new URLSearchParams({ householdId })}`, { accessToken: token, signal }));
    checkSignal(signal); context(parsed.items, householdId, userId); return parsed;
  },
  async register(token: AccessToken, body: BankConnectionRegister, userId: string, signal?: AbortSignal) {
    checkSignal(signal);
    const request = bankConnectionRegisterSchema.parse(body);
    try { return result(await safeFetch(`${base}/shinhan`, { accessToken: token, method: "POST", body: request, signal }), body.householdId, userId, body.connectionId, signal); }
    finally { request.loginId = ""; request.password = ""; }
  },
  async refresh(token: AccessToken, id: string, body: BankConnectionRefresh, userId: string, signal?: AbortSignal) {
    const request = bankConnectionRefreshSchema.parse(body); checkSignal(signal);
    return result(await safeFetch(`${base}/${encodeURIComponent(id)}/refresh`, { accessToken: token, method: "POST", body: request, signal }), body.householdId, userId, id, signal);
  },
  async disconnect(token: AccessToken, id: string, body: BankConnectionDisconnect, userId: string, signal?: AbortSignal) {
    const request = bankConnectionDisconnectSchema.parse(body); checkSignal(signal);
    return result(await safeFetch(`${base}/${encodeURIComponent(id)}`, { accessToken: token, method: "DELETE", body: request, signal }), body.householdId, userId, id, signal);
  },
};
const bankConnectionKey = (householdId: string, userId: string) => ["manual-finance", householdId, userId, "owner", "bank-connections"] as const;
export function useOwnedBankConnections(householdId: string, userId: string, beforeRead: () => void) {
  const { authedFetch } = useAuth(); const qc = useQueryClient(); const key = bankConnectionKey(householdId, userId);
  useEffect(() => () => { const queryKey = bankConnectionKey(householdId, userId); void qc.cancelQueries({ queryKey, exact: true }); qc.removeQueries({ queryKey, exact: true }); }, [householdId, userId, qc]);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => { beforeRead(); return authedFetch(token => bankConnectionsApi.list(token, householdId, userId, signal)); },
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const reread = useCallback(() => qc.resetQueries({ queryKey: bankConnectionKey(householdId, userId), exact: true }), [householdId, userId, qc]);
  return { ...query, reread };
}
