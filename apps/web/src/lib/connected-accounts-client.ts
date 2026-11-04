"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CONNECTED_ACCOUNT_SHARING_CONSENT_VERSION,
  connectedAccountsResponseSchema,
  type ConnectedAccountsResponse,
} from "@family/contracts";

import { apiFetch } from "./api-client";
import { useAuth } from "./auth-context";
import { useHousehold } from "./household-context";

export function connectedAccountsKey(householdId: string | null, userId: string | null) {
  return ["connected-accounts", householdId, userId] as const;
}

/** 가족 합산용 연결 계좌(본인 것 + 공유에 동의한 가족 것). 읽기만 하고 새 조회를 일으키지 않는다. */
export function useConnectedAccounts() {
  const { householdId } = useHousehold();
  const { user, status, authedFetch } = useAuth();
  const active = Boolean(householdId && user && status === "authenticated");
  return useQuery<ConnectedAccountsResponse>({
    queryKey: connectedAccountsKey(active ? householdId : null, active ? user!.id : null),
    enabled: active,
    queryFn: ({ signal }) =>
      authedFetch(async (token) =>
        connectedAccountsResponseSchema.parse(
          await apiFetch(`/v1/connected-accounts?${new URLSearchParams({ householdId: householdId! })}`, { accessToken: token, signal })
        )
      ),
  });
}

/** 내 연결 계좌 전체의 가족 공유를 켜고 끈다. 켤 때는 현재 동의 버전을 함께 보낸다. */
export function useSetConnectedAccountSharing() {
  const { householdId } = useHousehold();
  const { user, authedFetch } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (share: boolean) =>
      authedFetch(async (token) =>
        connectedAccountsResponseSchema.parse(
          await apiFetch("/v1/connected-accounts/sharing", {
            accessToken: token,
            method: "POST",
            body: { householdId, share, ...(share ? { consentVersion: CONNECTED_ACCOUNT_SHARING_CONSENT_VERSION } : {}) },
          })
        )
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(connectedAccountsKey(householdId, user?.id ?? null), data);
    },
  });
}
