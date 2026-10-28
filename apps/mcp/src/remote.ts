import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { RemoteAuthStore } from './remote-auth';
import { createRemoteHttpServer } from './remote-http';

/** 금융 원격 MCP 실행 설정. 비밀번호·기존 로컬 인증 파일을 사용하지 않는다. */
export interface RemoteConfig {
  publicUrl: string;
  apiUrl: string;
  port: number;
  databasePath: string;
  encryptionKey: Buffer;
  allowedRedirectUris: string[];
  trustProxyClientIp: boolean;
}

/** 운영 주소와 별도 암호화 키 파일을 검사한다. 오류에는 환경 변수 값이 포함되지 않는다. */
export function loadRemoteConfig(env: NodeJS.ProcessEnv): RemoteConfig {
  const publicUrl = new URL(env.REMOTE_MCP_PUBLIC_URL ?? 'https://app.subinary.cloud');
  if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) throw new Error('REMOTE_MCP_PUBLIC_URL에는 HTTPS 원점만 설정하세요.');
  const apiUrl = new URL(env.REMOTE_MCP_API_URL ?? 'http://api:3001');
  if (!['https:', 'http:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash || apiUrl.pathname !== '/') throw new Error('REMOTE_MCP_API_URL 형식을 확인하세요.');
  const port = Number(env.REMOTE_MCP_PORT ?? '3002');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('REMOTE_MCP_PORT 범위를 확인하세요.');
  const databasePath = env.REMOTE_MCP_DATABASE_PATH ?? '/data/finance-mcp.sqlite';
  const keyPath = env.REMOTE_MCP_KEY_FILE ?? '/run/secrets/finance-mcp.key';
  const stat = statSync(keyPath);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size !== 32) throw new Error('MCP 암호화 키는 32바이트·소유자 전용 파일이어야 합니다.');
  const encryptionKey = readFileSync(keyPath);
  const allowedRedirectUris = (env.REMOTE_MCP_REDIRECT_URIS ?? 'https://chatgpt.com/connector_platform_oauth_redirect').split(',').map((value) => value.trim());
  for (const value of allowedRedirectUris) {
    const uri = new URL(value);
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.hash) throw new Error('OAuth 반환 주소는 정확한 HTTPS 주소여야 합니다.');
  }
  return { publicUrl: publicUrl.origin, apiUrl: apiUrl.origin, port, databasePath, encryptionKey, allowedRedirectUris, trustProxyClientIp: env.REMOTE_MCP_TRUST_PROXY_IP === 'true' };
}

/** 읽기 도구와 OAuth 연결 관리 서비스를 시작한다. 비밀 정보나 요청 본문은 기록하지 않는다. */
export function startRemoteServer(env: NodeJS.ProcessEnv = process.env): void {
  const config = loadRemoteConfig(env);
  mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(config.databasePath), 0o700);
  const store = new RemoteAuthStore({ databasePath: config.databasePath, encryptionKey: config.encryptionKey, resource: `${config.publicUrl}/mcp`, issuer: config.publicUrl, allowedRedirectUris: config.allowedRedirectUris });
  chmodSync(config.databasePath, 0o600);
  const server = createRemoteHttpServer({ publicUrl: config.publicUrl, apiUrl: config.apiUrl, store, trustProxyClientIp: config.trustProxyClientIp });
  server.listen(config.port, '0.0.0.0', () => { process.stderr.write('[family-finance-mcp] 원격 읽기 서비스 준비 완료\n'); });
  const shutdown = (): void => {
    server.close(() => { store.close(); process.exit(0); });
    setTimeout(() => { process.exit(1); }, 10_000).unref();
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  server.on('error', () => { process.stderr.write('[family-finance-mcp] 서버 시작 오류\n'); process.exit(1); });
}

if (require.main === module) {
  try { startRemoteServer(); }
  catch { process.stderr.write('[family-finance-mcp] 원격 서버 설정을 확인해 주세요.\n'); process.exit(1); }
}
