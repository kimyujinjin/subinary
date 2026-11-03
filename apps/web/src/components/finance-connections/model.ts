import type { FinanceConnection, FinanceConnectionError, FinanceConnectionStatus } from "@family/contracts";

export const CONNECTION_STATUS: Record<FinanceConnectionStatus, string> = {
  connecting: "연결 확인 중", select_account: "계좌 선택 필요", ready: "조회 완료",
  refreshing: "새로 조회 중", error: "조회 실패", reauth_required: "다시 연결 필요", disconnected: "연결 해제됨",
};
export const CONNECTION_ERROR: Record<FinanceConnectionError, string> = {
  provider_unavailable: "토스증권에 연결하지 못했어요. 잠시 후 다시 확인해 주세요.",
  provider_denied: "토스증권에서 조회를 허용하지 않았어요. API 키와 허용 IP 설정을 확인해 주세요.",
  token_expired: "조회 인증이 만료됐어요. 연결을 해제한 뒤 다시 연결해 주세요.",
  rate_limited: "짧은 시간에 여러 번 조회했어요. 잠시 후 다시 확인해 주세요.",
  invalid_response: "받아온 정보를 확인하지 못했어요. 이전 조회 내역을 유지했어요.",
  token_uncertain: "인증 결과를 확인하지 못했어요. 자동으로 재시도하지 않아요. 연결을 해제한 뒤 다시 연결해 주세요.",
  account_unavailable: "선택한 계좌를 조회할 수 없어요. 연결 상태를 확인해 주세요.",
  operation_unknown: "조회 결과를 확인하지 못했어요. 연결 상태부터 다시 확인해 주세요.",
  configuration_unavailable: "운영자의 연결 설정이 필요해요. 설정을 마치면 다시 조회할 수 있어요.",
};

/** Exact provider decimals: formatting must never round large values through Number. */
export function connectionDecimal(value: string): string {
  const [whole = "0", fraction] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}
export function connectionTime(value: string | null): string {
  if (!value) return "아직 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}
export function canRefreshOnOpen(item: FinanceConnection): boolean {
  return item.refreshOnOpen && item.canRefresh && item.selectedAccountId !== null &&
    (item.status === "ready" || item.status === "error");
}
export function hasPreviousSnapshot(item: FinanceConnection): boolean {
  return item.snapshot !== null && (item.status !== "ready" || item.errorCode !== null);
}
export type ConnectionOperation = { kind: "register" | "account" | "refresh" | "disconnect"; id: string; version: number };
export function reconcileConnectionOperation(operation: ConnectionOperation | null, items: FinanceConnection[]): ConnectionOperation | null {
  if (!operation) return null;
  const item = items.find((entry) => entry.id === operation.id);
  return item && (operation.kind === "register" || item.version > operation.version || item.status === "disconnected") ? null : operation;
}
export function connectionFailureStatus(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
}
export function connectionFailureMessage(error: unknown): string {
  const status = connectionFailureStatus(error);
  if (status === 403 || status === 404) return "연결을 볼 권한이 바뀌었어요. 현재 계정과 가족을 확인해 주세요.";
  if (status === 409) return "연결 상태가 바뀌었어요. 현재 상태를 확인한 뒤 계속해 주세요.";
  if (status === 400 || status === 422) return "입력값과 동의 항목을 다시 확인해 주세요.";
  if (status === 429) return "잠시 후 연결 상태를 다시 확인해 주세요.";
  return "요청 결과를 확인하지 못했어요. 다시 요청하기 전에 연결 상태를 확인해 주세요.";
}

/** No timers/retries. One request at a time; navigation invalidates every late completion. */
export function createConnectionSession() {
  let epoch = 0;
  let active: AbortController | null = null;
  return {
    get pending() { return active !== null; },
    invalidate() { ++epoch; active?.abort(); active = null; },
    async run<T>(request: (signal: AbortSignal) => Promise<T>, publish: (result: T) => void, fail: (error: unknown) => void) {
      if (active) return "busy" as const;
      const controller = new AbortController();
      const revision = epoch;
      active = controller;
      try {
        const result = await request(controller.signal);
        if (epoch !== revision || active !== controller || controller.signal.aborted) return "stale" as const;
        active = null;
        publish(result);
        return "saved" as const;
      } catch (error) {
        if (epoch !== revision || active !== controller || controller.signal.aborted) return "stale" as const;
        active = null;
        fail(error);
        return "failed" as const;
      }
    },
  };
}
