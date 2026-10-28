import { meResponseSchema } from '@family/contracts';

import { ApiError, FamilyApiClient } from './api-client';
import { OAuthError, type AuthenticatedGrant, type RemoteAuthStore } from './remote-auth';

/** 사용자 조회·연결 해제와 동일한 연결별 큐를 공유해 API refresh의 중복 소비를 막는다. */
export interface RemoteSessionMaintenanceQueue {
  run<T>(grantId: string, operation: () => Promise<T>): Promise<T>;
}

/** 서버 내부 세션 유지 설정이다. 종료 요청 뒤에는 다음 연결의 API 요청을 시작하지 않는다. */
export interface RemoteSessionMaintenanceOptions {
  store: RemoteAuthStore;
  apiUrl: string;
  queue: RemoteSessionMaintenanceQueue;
  shouldStop?: () => boolean;
}

/** 비밀정보·계정 식별자 없이 기록할 수 있는 한 차례 유지 작업의 처리 건수다. */
export interface RemoteSessionMaintenanceResult {
  checked: number;
  revoked: number;
  failed: number;
  skipped: number;
}

type MaintenanceOutcome = keyof RemoteSessionMaintenanceResult;

/**
 * 무기한 연결의 API 세션을 순차 확인하고 필요하면 회전한 세션을 암호화 저장한다.
 * 인증 실패·계정 불일치는 철회하고 일시 장애는 유지한다. 사용자 활동 시각·MCP 토큰은 바꾸지 않는다.
 */
export async function maintainRemoteSessions(options: RemoteSessionMaintenanceOptions): Promise<RemoteSessionMaintenanceResult> {
  const { store, apiUrl, queue } = options;
  const result: RemoteSessionMaintenanceResult = { checked: 0, revoked: 0, failed: 0, skipped: 0 };
  if (options.shouldStop?.()) return result;
  const grantIds = store.listActivePersistentGrantIds();
  for (const grantId of grantIds) {
    if (options.shouldStop?.()) break;
    try {
      const outcome = await queue.run(grantId, async (): Promise<MaintenanceOutcome> => {
        if (options.shouldStop?.()) return 'skipped';
        let grant: AuthenticatedGrant;
        try {
          grant = store.getGrantForMaintenance(grantId);
        } catch (error: unknown) {
          if (error instanceof OAuthError && error.error === 'invalid_grant') return 'skipped';
          throw error;
        }
        const client = FamilyApiClient.fromSession({ apiUrl, ...grant.session, timeoutMs: 15_000 });
        let outcome: MaintenanceOutcome = 'failed';
        let revoke = false;
        try {
          const me = meResponseSchema.parse(await client.me());
          revoke = me.user.id !== grant.profile.id;
          outcome = revoke ? 'revoked' : 'checked';
        } catch (error: unknown) {
          revoke = error instanceof ApiError && error.status === 401;
          outcome = revoke ? 'revoked' : 'failed';
        } finally {
          if (revoke) {
            outcome = store.revokeGrantForUser(grantId, grant.profile.id) === null ? 'skipped' : 'revoked';
          } else {
            // refresh 성공 뒤 조회가 실패해도 새 쿠키를 보존하며, 이미 해제된 연결은 되살리지 않는다.
            try {
              store.updateSession(grantId, client.getSessionSnapshot());
            } catch (error: unknown) {
              outcome = error instanceof OAuthError && error.error === 'invalid_grant' ? 'skipped' : 'failed';
            }
          }
        }
        return outcome;
      });
      result[outcome] += 1;
    } catch {
      // 한 연결의 손상·저장·큐 오류가 나머지 연결의 유지 작업을 막지 않는다.
      result.failed += 1;
    }
  }
  return result;
}
