/**
 * 비밀번호 변경 오류를 칸별로 나눈다.
 *
 * 예전에는 모든 오류를 폼 맨 아래 한 줄에 모아, 어느 칸이 문제인지 다시 읽어야 했다(2026-11-05 HIG 검수).
 * 칸에 관한 오류는 그 칸 아래(`aria-invalid`와 함께), 칸과 무관한 오류(네트워크·서버)만 버튼 위 한 줄이다.
 */
import { ApiError } from "@/lib/api-client";

/** 계약(newPasswordSchema)과 같은 범위. 서버가 최종 판정하지만 미리 막아준다. */
export const MIN_LENGTH = 8;
export const MAX_LENGTH = 200;

export interface PasswordErrors {
  current?: string;
  next?: string;
  confirm?: string;
  /** 칸과 무관한 오류(버튼 위). */
  form?: string;
}

export function validatePasswordChange(values: {
  current: string;
  next: string;
  confirm: string;
}): PasswordErrors {
  if (values.current.length === 0) {
    return { current: "지금 비밀번호를 입력해 주세요." };
  }
  if (values.next.length < MIN_LENGTH) {
    return { next: `새 비밀번호는 ${MIN_LENGTH}자 이상 입력해 주세요.` };
  }
  if (values.next.length > MAX_LENGTH) {
    return { next: `새 비밀번호는 ${MAX_LENGTH}자 이하로 입력해 주세요.` };
  }
  if (values.next === values.current) {
    return { next: "지금 쓰는 비밀번호와 다른 것으로 바꿔 주세요." };
  }
  // 확인란은 서버가 모르는 클라이언트 전용 검사다(오타로 잠기는 것을 막는 유일한 방어).
  if (values.next !== values.confirm) {
    return { confirm: "새 비밀번호가 서로 달라요. 다시 확인해 주세요." };
  }
  return {};
}

/**
 * 서버 실패. 칸 검사를 통과한 뒤의 400은 '지금 비밀번호가 맞지 않아요.' 뿐이다(auth.service changePassword) —
 * 지금 비밀번호 칸 아래에 둔다. 나머지는 칸과 무관하다.
 */
export function serverPasswordError(err: unknown): PasswordErrors {
  if (err instanceof ApiError) {
    return err.status === 400 ? { current: err.message } : { form: err.message };
  }
  return { form: "비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요." };
}
