/**
 * 로그인 실패를 어디에 보일지 정한다.
 *
 * 예전에는 모든 실패를 비밀번호 칸 아래 빨간 글자로 붙였다. 그래서 요청 과다(429)나 네트워크 오류도
 * 비밀번호가 틀린 것처럼 읽혔다(2026-11-05 HIG 검수). 서버는 이메일·비밀번호가 틀리면 401만 준다
 * (auth.service login 'invalid credentials') — 그때만 칸 아래, 나머지는 폼 위 한 줄이다.
 */
import { ApiError } from "@/lib/api-client";

export interface LoginFailure {
  /** true면 비밀번호 칸 아래, false면 폼 위 알림. */
  field: boolean;
  message: string;
}

export function loginFailure(err: unknown): LoginFailure {
  if (err instanceof ApiError) {
    return { field: err.status === 401, message: err.message };
  }
  // fetch가 서버에 닿지 못하면 TypeError다(오프라인·DNS·연결 끊김).
  if (err instanceof TypeError) {
    return {
      field: false,
      message: "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
    };
  }
  return {
    field: false,
    message: "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  };
}
