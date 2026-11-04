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
