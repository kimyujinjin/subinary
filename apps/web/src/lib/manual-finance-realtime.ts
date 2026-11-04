import type { QueryClient } from "@tanstack/react-query";

export function isManualFinanceHint(data: string): boolean {
  try {
    const value: unknown = JSON.parse(data);
    return value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "manual-finance.changed" &&
      (value as { v?: unknown }).v === 1;
  } catch { return false; }
}

/** Clear shared values and membership-bound connection views before authorization refetch. */
export function resetSharedManualFinanceQueries(qc: QueryClient, householdId: string) {
  return qc.resetQueries({
    queryKey: ["manual-finance", householdId],
    predicate: query => query.queryKey[3] === "household" ||
      (query.queryKey[3] === "owner" && query.queryKey[4] === "finance-connections"),
  });
}

/**
 * 앱 복귀: 가족 공유 기록은 보여 준 채로 다시 확인한다(지우지 않음). 예전에는 복귀할 때마다
 * resetSharedManualFinanceQueries로 비워 자산·주택 화면이 매번 로딩으로 번쩍였다(2026-11-05).
 * 복귀는 공유가 바뀌었다는 신호가 아니다 — 실제 변경 힌트(SSE)는 여전히 즉시 비우고, 다시 받은
 * 결과가 권한 오류면 화면이 오류를 먼저 그린다. 연결 계좌 화면(본인 소유)은 지금처럼 비운다.
 */
export function revalidateSharedManualFinanceQueries(qc: QueryClient, householdId: string) {
  const queryKey = ["manual-finance", householdId];
  const isConnection = (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[3] === "owner" && query.queryKey[4] === "finance-connections";
  return Promise.all([
    qc.resetQueries({ queryKey, predicate: isConnection }),
    qc.invalidateQueries({ queryKey, predicate: query => query.queryKey[3] === "household" }),
  ]).then(() => undefined);
}

/** Missed hints converge on the existing foreground safety interval. */
export function refreshManualFinanceQueries(qc: QueryClient, householdId: string) {
  const queryKey = ["manual-finance", householdId];
  // Provider connection views must also drop previously allowed data before a
  // missed-revocation authorization check. All other records keep their existing behavior.
  const isConnection = (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[3] === "owner" && query.queryKey[4] === "finance-connections";
  return Promise.all([
    qc.resetQueries({ queryKey, predicate: isConnection }),
    qc.invalidateQueries({ queryKey, predicate: query => !isConnection(query) }),
  ]).then(() => undefined);
}
