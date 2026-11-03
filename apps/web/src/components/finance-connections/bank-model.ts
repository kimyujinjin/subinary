import type { BankConnection, BankConnectionError } from "@family/contracts";
export const BANK_ERROR: Record<BankConnectionError, string> = {
  credentials_invalid: "아이디나 비밀번호를 확인해 주세요. 계정 보호를 위해 자동 로그인을 멈췄어요.",
  authentication_required: "은행에서 추가 확인이 필요해요. 자동 로그인을 멈췄어요.",
  network_error: "은행에 접속하지 못했어요. 이전 조회 내역을 유지해요.",
  unsupported_layout: "은행 화면을 정확히 읽지 못해 갱신을 멈췄어요. 이전 금액은 바뀌지 않았어요.",
  account_not_found: "선택한 계좌를 찾지 못했어요. 다른 계좌로 바꾸지 않았어요.",
  account_ambiguous: "끝자리와 종류가 같은 계좌가 여러 개라 가져오지 않았어요.",
  account_changed: "처음 연결한 계좌와 달라 갱신을 멈췄어요.",
  runtime_unavailable: "은행 조회 기능을 준비하고 있어요. 로그인 정보를 다시 입력하지 않아도 돼요.",
  operation_unknown: "조회 결과를 확인하지 못했어요. 다시 로그인하지 않고 연결 상태부터 확인해 주세요.",
};
export function bankAccountLabel(selector: BankConnection['selector']) {
  return 'accountType' in selector ? '신한 통장' : `신한 ${selector.loanType === 'interim' ? '중도금' : '전세'} 대출`;
}
export const BANK_STATUS: Record<BankConnection["status"], string> = {
  stored: "로그인 정보 저장됨", refreshing: "은행 조회 중", ready: "조회 완료", error: "확인 필요", reauth_required: "로그인 확인 필요", disconnected: "연결 해제됨",
};
export interface PendingBankOperation { id: string; kind: "register" | "refresh" | "disconnect"; version: number }
export function reconcileBankOperation(pending: PendingBankOperation | null, items: BankConnection[]) {
  if (!pending) return null;
  const found = items.find(item => item.id === pending.id);
  if (!found) return pending.kind === "disconnect" ? null : pending;
  if (pending.kind === "register") return null;
  if (pending.kind === "disconnect") return found.status === "disconnected" ? null : pending;
  return found.status !== "refreshing" && found.version > pending.version ? null : pending;
}
