import { writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FinanceQuality } from '@family/contracts';

import { ApiError, FamilyApiClient, type ApiNetworkCode } from './api-client';
import { loadConfig, type McpConfig } from './config';

const API_URL = 'https://app.subinary.cloud';
const TIMEOUT_MS = 15_000;

/** 연결된 PC에서 실행할 품질 조회 명령의 입력이다. 외부 CLI 인자는 받지 않는다. */
export interface FinanceCheckOptions {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** 실패를 0건으로 바꾸지 않는 조회 결과와 프로세스 종료 코드다. */
export interface FinanceCheckResult {
  exitCode: number;
  output:
    | { ok: true; source: 'family-memory-ai-http-api'; fetchedAt: string; quality: FinanceQuality }
    | ({ ok: false; code: string; message: string } & FinanceCheckDiagnostics);
}

/** 실패 시각·단계와 설정 유무만 담고 경로·프록시 주소·원시 오류는 담지 않는다. */
export interface FinanceCheckDiagnostics {
  attemptedAt: string;
  stage: 'arguments' | 'credentials' | 'login' | 'household' | 'quality';
  proxyConfigured: boolean;
  networkCode?: ApiNetworkCode;
}

class CheckTimeoutError extends Error {}

/** 원시 응답·URL·인증 정보 없이 고정된 오류만 반환한다. */
function failed(exitCode: number, code: string, message: string, diagnostics: FinanceCheckDiagnostics): FinanceCheckResult {
  return { exitCode, output: { ok: false, code, message, ...diagnostics } };
}

/** 표준 프록시 환경변수의 값은 공개하지 않고 설정 존재만 확인한다. 사용 성공을 뜻하지 않는다. */
function hasProxyConfiguration(env: NodeJS.ProcessEnv): boolean {
  return ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
    .some((key) => (env[key]?.trim().length ?? 0) > 0);
}

/**
 * 기존 API 클라이언트로 로그인 계정의 품질 집계만 조회한다.
 * 운영 주소는 고정하고, 기존 소유자 전용 인증 파일만 내부에서 읽는다.
 * MCP 등록 성공이나 Dot 연결 성공을 검사하는 명령은 아니다.
 */
export async function runFinanceCheck(options: FinanceCheckOptions = {}): Promise<FinanceCheckResult> {
  const env = options.env ?? process.env;
  const attemptedAt = new Date().toISOString();
  const proxyConfigured = hasProxyConfiguration(env);
  let stage: FinanceCheckDiagnostics['stage'] = 'arguments';
  const failure = (exitCode: number, code: string, message: string, networkCode?: ApiNetworkCode): FinanceCheckResult =>
    failed(exitCode, code, message, { attemptedAt, stage, proxyConfigured, ...(networkCode === undefined ? {} : { networkCode }) });
  if ((options.args ?? []).length > 0) {
    return failure(2, 'INVALID_ARGUMENTS', '인자 없이 실행하세요. 이 명령은 품질 집계만 조회합니다.');
  }

  stage = 'credentials';
  let config: McpConfig;
  try {
    config = loadConfig({
      FAMILY_API_URL: API_URL,
      FAMILY_CREDENTIALS_FILE: env.FAMILY_CREDENTIALS_FILE ?? join(homedir(), '.config/family-memory-ai/mcp-credentials.json'),
      FAMILY_TOOL_MODE: 'finance-readonly',
    });
  } catch {
    return failure(2, 'CREDENTIALS_UNAVAILABLE', '소유자 전용 인증 파일을 사용할 수 없습니다. 이 PC의 로그인 설정과 파일 권한 600을 확인하세요.');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = async (): Promise<FinanceQuality> => {
      const client = new FamilyApiClient(config);
      stage = 'login';
      await client.login();
      stage = 'household';
      const householdId = await client.resolveHouseholdId();
      stage = 'quality';
      return client.financeQuality(householdId);
    };
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CheckTimeoutError()), options.timeoutMs ?? TIMEOUT_MS);
    });
    const quality = await Promise.race([request(), timeout]);
    return {
      exitCode: 0,
      output: { ok: true, source: 'family-memory-ai-http-api', fetchedAt: new Date().toISOString(), quality },
    };
  } catch (error: unknown) {
    if (error instanceof CheckTimeoutError) {
      return failure(124, 'TIMEOUT', '제한 시간 안에 조회를 완료하지 못했습니다. 결과는 미확인입니다.', 'TIMEOUT');
    }
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        return failure(1, 'ACCESS_DENIED', '로그인 또는 조회 권한을 확인하지 못했습니다. 이 PC에서 다시 로그인해 주세요.');
      }
      if (error.reason === 'HOUSEHOLD_NOT_FOUND') {
        return failure(1, 'HOUSEHOLD_NOT_FOUND', '로그인은 성공했지만 이 계정에 연결된 가구가 없습니다. 가구 등록을 확인해 주세요.');
      }
      if (error.status === 0) {
        return failure(1, 'API_UNAVAILABLE', 'API에 연결하지 못했습니다. 결과는 미확인입니다.', error.networkCode);
      }
      return failure(1, 'API_ERROR', 'API가 조회를 완료하지 못했습니다. 결과는 미확인입니다.');
    }
    return failure(1, 'INVALID_RESPONSE', '서버 응답 형식을 확인하지 못했습니다. 결과는 미확인입니다.');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

if (require.main === module) {
  void runFinanceCheck({ args: process.argv.slice(2) }).then((result: FinanceCheckResult) => {
    // 동기 출력 후 종료해 타임아웃된 HTTP 연결이 명령을 붙잡거나 결과가 잘리지 않게 한다.
    writeSync(1, `${JSON.stringify(result.output)}\n`);
    process.exit(result.exitCode);
  }).catch(() => {
    writeSync(2, '{"ok":false,"code":"CHECK_FAILED","message":"품질 조회 명령을 완료하지 못했습니다."}\n');
    process.exit(1);
  });
}
