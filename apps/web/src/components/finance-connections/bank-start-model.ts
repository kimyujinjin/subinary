export type BankStartRequest = Readonly<{ text: string; href: string }>;

const requestText = [
  "모아(https://app.subinary.cloud)의 신한은행 계좌 연동을 준비해 주세요.",
  "지원되는 Computer Use(CUA) 환경인지 먼저 확인하고, 지원되지 않으면 중단해 주세요.",
  "모아의 인증된 저장 경로가 지원되는지 먼저 확인하고, 지원되지 않으면 중단해 주세요.",
  "신한은행 공식 화면(https://bank.shinhan.com)에서 정상 로그인 절차를 이용하고, 은행 아이디·비밀번호와 추가 인증은 사용자가 은행 화면에 직접 입력하도록 해 주세요.",
  "사용자가 선택한 통장 또는 대출만 확인하고 읽기만 수행한 뒤 정상 로그아웃을 확인해 주세요.",
  "실제 조회·저장과 모아 화면의 재확인까지 검증하지 않았다면 저장 성공이나 연동 완료라고 말하지 마세요.",
  "과거 채팅이나 메모리에서 인증정보를 찾거나 재사용하지 마세요. 쿠키·세션 추출, 보안 우회, 이체·상환은 하지 마세요.",
].join("\n");

const request: BankStartRequest = Object.freeze({
  text: requestText,
  href: `codex://new?prompt=${encodeURIComponent(requestText)}`,
});

/** 사용자 정보나 현재 채팅을 받지 않는 고정 요청문과 Codex 초안 링크를 반환한다. */
export function bankStartRequest(): BankStartRequest {
  return request;
}
