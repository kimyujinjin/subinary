"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  manualAssetListResponseSchema,
  manualAssetResponseSchema,
  manualFinanceDeleteResponseSchema,
  manualHousingPlanListResponseSchema,
  manualHousingPlanResponseSchema,
  type ManualAssetCreateRequest,
  type ManualAssetUpdateRequest,
  type ManualFinanceScope,
  type ManualHousingPlanCreateRequest,
  type ManualHousingPlanUpdateRequest,
} from "@family/contracts";
import { apiFetch, type AccessToken } from "./api-client";
import { useAuth } from "./auth-context";
import { useHousehold } from "./household-context";

const query = (householdId: string, scope?: ManualFinanceScope) => {
  const values = new URLSearchParams({ householdId });
  if (scope) values.set("scope", scope);
  return `?${values}`;
};
const base = "/v1/manual-finance";
function assertContext(
  items: Array<{
    householdId: string;
    visibility: "private" | "household";
    ownerUserId: string;
  }>,
  householdId: string,
  scope?: ManualFinanceScope,
  userId?: string
) {
  if (
    items.some(
      (item) =>
        item.householdId !== householdId ||
        (scope && item.visibility !== scope) ||
        (scope === "private" && userId && item.ownerUserId !== userId)
    )
  )
    throw new Error("manual finance response context mismatch");
}
function assertRecord(
  item: {
    id: string;
    householdId: string;
    visibility: "private" | "household";
    ownerUserId: string;
  },
  householdId: string,
  id: string
) {
  assertContext([item], householdId);
  if (item.id !== id)
    throw new Error("manual finance response record mismatch");
}

/** Scope is part of the server request and cache key, never a client-side privacy filter. */
export const manualFinanceKeys = {
  resource: (householdId: string | null, userId: string | null) =>
    ["manual-finance", householdId, userId] as const,
  assets: (
    householdId: string | null,
    userId: string | null,
    scope: ManualFinanceScope
  ) => ["manual-finance", householdId, userId, scope, "assets"] as const,
  plans: (
    householdId: string | null,
    userId: string | null,
    scope: ManualFinanceScope
  ) => ["manual-finance", householdId, userId, scope, "housing-plans"] as const,
};

export const manualFinanceApi = {
  async listAssets(
    token: AccessToken,
    householdId: string,
    scope: ManualFinanceScope,
    signal?: AbortSignal,
    userId?: string
  ) {
    const result = manualAssetListResponseSchema.parse(
      await apiFetch(`${base}/assets${query(householdId, scope)}`, {
        accessToken: token,
        signal,
      })
    );
    assertContext(result.items, householdId, scope, userId);
    return result;
  },
  async asset(
    token: AccessToken,
    householdId: string,
    id: string,
    signal?: AbortSignal
  ) {
    const result = manualAssetResponseSchema.parse(
      await apiFetch(
        `${base}/assets/${encodeURIComponent(id)}${query(householdId)}`,
        { accessToken: token, signal }
      )
    );
    assertRecord(result.item, householdId, id);
    return result;
  },
  async createAsset(token: AccessToken, body: ManualAssetCreateRequest) {
    const result = manualAssetResponseSchema.parse(
      await apiFetch(`${base}/assets`, {
        accessToken: token,
        method: "POST",
        body,
      })
    );
    assertRecord(result.item, body.householdId, body.id);
    return result;
  },
  async updateAsset(
    token: AccessToken,
    householdId: string,
    id: string,
    body: ManualAssetUpdateRequest
  ) {
    const result = manualAssetResponseSchema.parse(
      await apiFetch(
        `${base}/assets/${encodeURIComponent(id)}${query(householdId)}`,
        { accessToken: token, method: "PATCH", body }
      )
    );
    assertRecord(result.item, householdId, id);
    return result;
  },
  async removeAsset(
    token: AccessToken,
    householdId: string,
    id: string,
    expectedVersion: number
  ) {
    return manualFinanceDeleteResponseSchema.parse(
      await apiFetch(
        `${base}/assets/${encodeURIComponent(id)}${query(householdId)}`,
        { accessToken: token, method: "DELETE", body: { expectedVersion } }
      )
    );
  },
  async listPlans(
    token: AccessToken,
    householdId: string,
    scope: ManualFinanceScope,
    signal?: AbortSignal,
    userId?: string
  ) {
    const result = manualHousingPlanListResponseSchema.parse(
      await apiFetch(`${base}/housing-plans${query(householdId, scope)}`, {
        accessToken: token,
        signal,
      })
    );
    assertContext(result.items, householdId, scope, userId);
    const next = result.summary.nextPayment;
    if (
      next &&
      !result.items.some(
        (item) => item.id === next.planId && item.label === next.label
      )
    )
      throw new Error("manual finance payment summary context mismatch");
    return result;
  },
  async plan(
    token: AccessToken,
    householdId: string,
    id: string,
    signal?: AbortSignal
  ) {
    const result = manualHousingPlanResponseSchema.parse(
      await apiFetch(
        `${base}/housing-plans/${encodeURIComponent(id)}${query(householdId)}`,
        { accessToken: token, signal }
      )
    );
    assertRecord(result.item, householdId, id);
    if (result.payments.some((payment) => payment.planId !== id))
      throw new Error("manual finance payment context mismatch");
    return result;
  },
  async createPlan(token: AccessToken, body: ManualHousingPlanCreateRequest) {
    const result = manualHousingPlanResponseSchema.parse(
      await apiFetch(`${base}/housing-plans`, {
        accessToken: token,
        method: "POST",
        body,
      })
    );
    assertRecord(result.item, body.householdId, body.id);
    if (result.payments.some((payment) => payment.planId !== body.id))
      throw new Error("manual finance payment context mismatch");
    return result;
  },
  async updatePlan(
    token: AccessToken,
    householdId: string,
    id: string,
    body: ManualHousingPlanUpdateRequest
  ) {
    const result = manualHousingPlanResponseSchema.parse(
      await apiFetch(
        `${base}/housing-plans/${encodeURIComponent(id)}${query(householdId)}`,
        { accessToken: token, method: "PATCH", body }
      )
    );
    assertRecord(result.item, householdId, id);
    if (result.payments.some((payment) => payment.planId !== id))
      throw new Error("manual finance payment context mismatch");
    return result;
  },
  async removePlan(
    token: AccessToken,
    householdId: string,
    id: string,
    expectedVersion: number
  ) {
    return manualFinanceDeleteResponseSchema.parse(
      await apiFetch(
        `${base}/housing-plans/${encodeURIComponent(id)}${query(householdId)}`,
        { accessToken: token, method: "DELETE", body: { expectedVersion } }
      )
    );
  },
};

export function useManualAssets(scope: ManualFinanceScope = "household") {
  const { householdId } = useHousehold();
  const { user, status, authedFetch } = useAuth();
  return useQuery({
    queryKey: manualFinanceKeys.assets(householdId, user?.id ?? null, scope),
    enabled: Boolean(householdId && user && status === "authenticated"),
    queryFn: ({ signal }) =>
      authedFetch((token) =>
        manualFinanceApi.listAssets(
          token,
          householdId!,
          scope,
          signal,
          user!.id
        )
      ),
    staleTime: 0,
    retry: false,
  });
}

export function useManualHousingPlans(scope: ManualFinanceScope = "household") {
  const { householdId } = useHousehold();
  const { user, status, authedFetch } = useAuth();
  return useQuery({
    queryKey: manualFinanceKeys.plans(householdId, user?.id ?? null, scope),
    enabled: Boolean(householdId && user && status === "authenticated"),
    queryFn: ({ signal }) =>
      authedFetch((token) =>
        manualFinanceApi.listPlans(token, householdId!, scope, signal, user!.id)
      ),
    staleTime: 0,
    retry: false,
  });
}

/** Also invalidate the old scope after sharing changes; a stale response cannot move data between scopes. */
export function useManualFinanceRefresh() {
  const qc = useQueryClient();
  const { householdId } = useHousehold();
  const { user } = useAuth();
  return (clear = false) =>
    clear
      ? qc.resetQueries({
          queryKey: manualFinanceKeys.resource(householdId, user?.id ?? null),
        })
      : qc.invalidateQueries({
          queryKey: manualFinanceKeys.resource(householdId, user?.id ?? null),
        });
}
