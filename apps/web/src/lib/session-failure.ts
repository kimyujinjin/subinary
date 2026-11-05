import { ApiError } from "./api-client";

/**
 * 부트스트랩·사용 중 토큰 갱신 실패를 "재시도하면 복구될 수 있음"과 "세션이 죽었음"으로 가른다.
 *
 * ApiError가 아니면 HTTP 응답 자체가 없었던 것(오프라인·DNS·타임아웃·CORS)이다 —
 * status가 없는 실패를 인증 실패로 뭉개면, 지하철에서 앱을 연 것만으로 1년 세션이
 * 날아간다. 5xx/429는 서버·프록시 사정이라 세션과 무관하다(터널 재연결 중 502).
 * 그 밖의 4xx는 예상 못 한 계약 위반이므로 보수적으로 세션을 파기해 기존 동작
 * (로그인 화면)을 유지한다 — 무한 재시도 화면에 갇히는 것보다 낫다.
 */
export function isRetriableFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500 || error.status === 429;
}

/**
 * 401이면 토큰을 한 번 갱신하고 재시도한다. **갱신이 실패했을 때만** 세션 종료(onSessionDead)로
 * 본다 — 갱신이 성공한 뒤의 재시도 실패는 그 요청 자체의 거절이다(예: 비밀번호 변경의 틀린 현재
 * 비밀번호). 예전에는 둘을 같은 catch로 묶어, 비밀번호를 한 번 틀리면 로그아웃됐다(2026-11-05).
 */
export async function retryWithRefresh<T, Token>(
  run: (token: Token) => Promise<T>,
  current: Token,
  refresh: () => Promise<Token>,
  onSessionDead: () => void,
): Promise<T> {
  try {
    return await run(current);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    let next: Token;
    try {
      next = await refresh();
    } catch (refreshError) {
      // 세션이 정말 끝난 응답(401 등)만 로그아웃한다. 네트워크·5xx·시간 초과는 이 요청만 실패시킨다.
      if (!isRetriableFailure(refreshError)) onSessionDead();
      throw refreshError;
    }
    return run(next);
  }
}
