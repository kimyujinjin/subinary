import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('로컬 연결 폼은 인증·CSRF·비밀 저장 권한을 검증한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'family-mcp-setup-test-'));
  const file = join(directory, 'credentials.json');
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (input.password !== 'fixture-password') { res.writeHead(401); res.end('{}'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tokens: { accessToken: 'fixture-access-token' } }));
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const child = spawn(process.execPath, ['scripts/setup-family-mcp.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, FAMILY_API_URL: `http://127.0.0.1:${api.address().port}`, FAMILY_CREDENTIALS_FILE: file },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  try {
    const setupUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('setup timeout')), 5000);
      child.stdout.on('data', () => {
        const match = output.match(/FAMILY_MCP_SETUP_URL=(\S+)/);
        if (match) { clearTimeout(timer); resolve(new URL(match[1])); }
      });
      child.once('error', reject);
    });
    const page = await fetch(setupUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /type="password"/);
    const send = (token, password, origin = setupUrl.origin) => fetch(`${setupUrl.origin}/connect`, {
      method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'test@example.com', password, token }),
    });
    assert.equal((await send('invalid', 'fixture-password')).status, 403);
    assert.equal((await send(setupUrl.searchParams.get('token'), 'fixture-password', 'https://untrusted.invalid')).status, 403);
    assert.equal((await send(setupUrl.searchParams.get('token'), 'wrong')).status, 400);
    await assert.rejects(stat(file), { code: 'ENOENT' });
    assert.equal((await send(setupUrl.searchParams.get('token'), 'fixture-password', 'null')).status, 200);
    const credentials = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(credentials, { email: 'test@example.com', password: 'fixture-password' });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.doesNotMatch(output + errors, /fixture-password|fixture-access-token|test@example.com/);
  } finally {
    child.kill('SIGTERM');
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
