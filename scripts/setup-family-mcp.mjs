#!/usr/bin/env node
/**
 * 가족 가계부 MCP의 로컬 인증 설정. 비밀번호를 채팅·명령줄 인자로 받지 않는다.
 * 127.0.0.1의 일회용 폼에서 로그인 성공을 검증한 뒤 권한 600 파일에 저장한다.
 */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, chmod, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const apiUrl = new URL(process.env.FAMILY_API_URL ?? 'https://app.subinary.cloud');
if (apiUrl.protocol !== 'https:' && !(['127.0.0.1', 'localhost'].includes(apiUrl.hostname) && apiUrl.protocol === 'http:')) {
  throw new Error('인증 서버는 HTTPS 또는 로컬 HTTP여야 합니다.');
}
if (apiUrl.username || apiUrl.password) throw new Error('URL에 인증 정보를 넣을 수 없습니다.');
const file = process.env.FAMILY_CREDENTIALS_FILE ?? join(homedir(), '.config/family-memory-ai/mcp-credentials.json');
const token = randomBytes(32).toString('hex');
let completed = false;
let busy = false;
let localOrigin = '';
const escape = (value) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.headers.host !== new URL(localOrigin).host) { res.writeHead(403); res.end('허용되지 않은 호스트입니다.'); return; }
  const url = new URL(req.url ?? '/', localOrigin);
  if (req.method === 'GET' && url.pathname === '/' && !completed) {
    res.end(`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family 가계부 연결</title><style>body{font:16px system-ui;background:#f6f7f9;color:#17212b;margin:0;padding:28px}main{max-width:420px;margin:40px auto;background:white;border-radius:20px;padding:28px}h1{font-size:24px}p{line-height:1.65;color:#536170}label{display:block;margin:20px 0 6px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #b8c2ce;border-radius:9px;font:inherit}button{margin-top:24px;width:100%;padding:13px;background:#162c46;color:white;border:0;border-radius:10px;font:inherit}</style><main><h1>가계부를 Dot에 연결</h1><p>기존 family-memory-ai 계정으로 로그인하세요. 인증 정보는 이 PC의 소유자 전용 파일에 저장되며 채팅에 표시되지 않습니다.</p><p>연결할 서버: ${escape(apiUrl.origin)}</p><form method="post" action="/connect"><input type="hidden" name="token" value="${token}"><label for="email">이메일</label><input id="email" name="email" type="email" autocomplete="username" required><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>로그인 확인 후 이 PC에 연결</button></form></main></html>`);
    return;
  }
  // 앱 내 브라우저는 Origin:null을 보낼 수 있다. null 자체를 인증 근거로 쓰지 않고
  // 아래의 예측 불가능한 CSRF 토큰을 반드시 대조한다. 외부의 명시적 출처는 계속 거절한다.
  const allowedOrigin = req.headers.origin === localOrigin || req.headers.origin === 'null';
  if (req.method !== 'POST' || url.pathname !== '/connect' || !allowedOrigin || completed || busy) {
    console.log(JSON.stringify({ event: 'setup_request_rejected', method: req.method, route: url.pathname === '/connect' ? 'connect' : 'other', origin: req.headers.origin === undefined ? 'missing' : req.headers.origin === 'null' ? 'opaque' : req.headers.origin === localOrigin ? 'local' : 'other', completed, busy }));
    res.writeHead(403); res.end('이 연결 요청을 사용할 수 없습니다.'); return;
  }
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 8192) { res.writeHead(413); res.end('입력이 너무 큽니다.'); return; }
      chunks.push(chunk);
    }
    const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const provided = Buffer.from(fields.get('token') ?? '');
    if (provided.length !== token.length || !timingSafeEqual(provided, Buffer.from(token))) {
      res.writeHead(403); res.end('연결 요청이 만료됐습니다.'); return;
    }
    const email = fields.get('email')?.trim();
    const password = fields.get('password');
    if (!email || !password) { res.writeHead(400); res.end('이메일과 비밀번호를 입력하세요.'); return; }
    busy = true;
    const response = await fetch(new URL('/v1/auth/login', apiUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) { res.writeHead(400); res.end('로그인을 확인하지 못했습니다. 뒤로 돌아가 계정을 확인하세요.'); return; }
    const auth = await response.json();
    if (typeof auth?.tokens?.accessToken !== 'string' || auth.tokens.accessToken.length === 0) throw new Error('invalid login response');
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const existing = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing?.isSymbolicLink()) throw new Error('invalid destination');
    await writeFile(file, JSON.stringify({ email, password }), { mode: 0o600 });
    await chmod(file, 0o600);
    completed = true;
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>연결 확인</title><h1>가계부 로그인을 확인했습니다.</h1><p>이 창을 닫아도 됩니다. 금융 도구의 실제 조회 검증을 이어서 진행합니다.</p></html>');
    console.log('FAMILY_MCP_CREDENTIALS_READY');
    setTimeout(() => server.close(), 500).unref();
  } catch {
    res.writeHead(500); res.end('연결을 완료하지 못했습니다. 다시 시도하세요. 인증 정보는 로그에 남기지 않았습니다.');
  } finally { busy = false; }
});
server.listen(Number(process.env.FAMILY_SETUP_PORT ?? 0), '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('로컬 연결 주소를 만들지 못했습니다.');
  localOrigin = `http://127.0.0.1:${address.port}`;
  console.log(`FAMILY_MCP_SETUP_URL=${localOrigin}/?token=${token}`);
});
setTimeout(() => server.close(), 30 * 60_000).unref();
