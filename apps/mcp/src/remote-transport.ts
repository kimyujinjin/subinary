import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { FamilyApiClient } from './api-client';
import { registerAllTools } from './tools';

/**
 * 인증된 한 요청에 금융 조회 도구만 등록하고 JSON 방식의 MCP 응답을 반환한다.
 * 호출자는 인증·Host·Origin·본문 크기 검사를 먼저 수행해야 한다.
 * 클라이언트는 요청별로 생성하며 세션 스냅샷은 이 함수 완료 후 연결 저장소에 보관한다.
 */
export async function handleFinanceMcp(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  client: FamilyApiClient,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: '이 연결은 POST 요청만 지원합니다.' } }));
    return;
  }

  const server = new McpServer({ name: 'family-finance', version: '0.2.0' }, {
    instructions: '로그인한 사용자의 가족 가계부 조회 도구입니다. 조회 시각·집계 범위·제외 내역을 함께 설명하세요. '
      + '카드 문자 기반 사용액을 청구 확정액이나 통장 잔액으로 표현하지 마세요. 실패를 0건으로 보고하지 마세요. '
      + '분류 미리보기는 조회만 하며 쓰기·카드 소유자 변경·원문 문자 조회·외부 AI 호출을 지원하지 않습니다.',
  });
  registerAllTools(server, client, 'finance-readonly');
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  let handlingComplete = false;
  let closePromise: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    closePromise ??= server.close();
    return closePromise;
  };
  // JSON 응답 작성 중 조기 close로 SDK의 대기 Promise가 끊기지 않게 처리 완료를 기다린다.
  const onFinished = (): void => {
    if (handlingComplete) void cleanup().catch(() => undefined);
  };
  res.once('finish', onFinished);
  res.once('close', onFinished);
  res.setHeader('Cache-Control', 'no-store');
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch {
    if (!res.headersSent && !res.destroyed) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: '금융 조회 요청을 처리하지 못했습니다. 다시 시도하세요.' } }));
    } else if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  } finally {
    handlingComplete = true;
    res.off('finish', onFinished);
    res.off('close', onFinished);
    await cleanup().catch(() => undefined);
  }
}
