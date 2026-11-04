"use client";
import { useQuery } from "@tanstack/react-query";
import { fxReferenceSchema, type FxReference } from "@family/contracts";

import { apiFetch } from "./api-client";
import { useAuth } from "./auth-context";

/** 최근 영업일 ECB 기준환율(USD→KRW). 화면 표시용이며 10분간 재사용한다. */
export function useUsdKrwReference() {
  const { status, authedFetch } = useAuth();
  return useQuery<FxReference>({
    queryKey: ["fx-reference", "USD"],
    enabled: status === "authenticated",
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      authedFetch(async (token) =>
        fxReferenceSchema.parse(await apiFetch("/v1/fx/reference?base=USD", { accessToken: token, signal }))
      ),
  });
}

/**
 * 외화 금액(10진 문자열) × 환율(10진 문자열) → 원 단위 정수(반올림). Number를 거치지 않는다.
 * 둘 중 하나라도 형식이 아니면 null — 0으로 바꾸지 않는다.
 */
export function convertToKrw(amount: string, rate: string): bigint | null {
  const re = /^(-?)(\d+)(?:\.(\d+))?$/;
  const a = re.exec(amount);
  const r = re.exec(rate);
  if (!a || !r || r[1]) return null;
  const aScale = (a[3] ?? "").length;
  const rScale = (r[3] ?? "").length;
  const units = BigInt(a[2] + (a[3] ?? "")) * BigInt(r[2] + (r[3] ?? ""));
  const scale = 10n ** BigInt(aScale + rScale);
  const rounded = (units * 2n + scale) / (scale * 2n);
  return a[1] ? -rounded : rounded;
}
