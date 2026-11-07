import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  allowedRequest,
  chromiumSandboxEnabled,
  classifyUntypedRunnerError,
  isLoginUrl,
  validateJob,
  SujainReadError,
} from '../policy.mjs';

test('allows only sujain hosts', () => {
  assert.equal(allowedRequest('https://www.sujain.co.kr/mypage/payment'), true);
  assert.equal(allowedRequest('https://m.sujain.co.kr/login'), true);
  assert.equal(allowedRequest('https://bank.shinhan.com/'), false);
  assert.equal(allowedRequest('https://hoban.co.kr/'), false);
  assert.equal(allowedRequest('https://evil.example/www.sujain.co.kr'), false);
});

test('isLoginUrl treats /login/result as still in the login flow until home', () => {
  // Official success lands on /login/result with a success alert; waiters must not
  // treat that intermediate as "left login" or the race classifies the alert as extra auth.
  assert.equal(isLoginUrl('https://www.sujain.co.kr/login'), true);
  assert.equal(isLoginUrl('https://www.sujain.co.kr/login/result'), true);
  assert.equal(isLoginUrl('https://www.sujain.co.kr/index'), false);
  assert.equal(isLoginUrl('https://www.sujain.co.kr/'), false);
  assert.equal(isLoginUrl('https://www.sujain.co.kr/mypage/payment'), false);
});

test('rejects non-sujain provider and keeps secrets out of thrown messages', () => {
  assert.throws(() => validateJob({
    provider: 'shinhan_bank',
    credentials: { loginId: 'synthetic-id', password: 'SYNTHETIC_SECRET' },
  }), (error) => error instanceof SujainReadError && !String(error).includes('SYNTHETIC_SECRET'));
});

test('accepts synthetic sujain credentials shape', () => {
  const job = validateJob({
    provider: 'sujain',
    credentials: { loginId: 'synthetic.id', password: 'SYNTHETIC_SECRET' },
  });
  assert.equal(job.provider, 'sujain');
});

test('disables Chromium sandbox only when running as root (production API container)', () => {
  assert.equal(chromiumSandboxEnabled(() => 0), false);
  assert.equal(chromiumSandboxEnabled(() => 1000), true);
  assert.equal(chromiumSandboxEnabled(undefined), true);
});

test('runner turns sandbox off via policy and maps launch failure to runtime_unavailable', async () => {
  const runtime = await readFile(new URL('../run.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /chromiumSandboxEnabled\(\)/);
  assert.match(runtime, /chromium_launch_failed/);
  assert.match(runtime, /runtime_unavailable/);
  assert.doesNotMatch(runtime, /chromiumSandbox:\s*true/);
  assert.doesNotMatch(runtime, /console\.(log|error|info|debug|warn)/);
  assert.doesNotMatch(runtime, /BANK_WEB_/);
  assert.doesNotMatch(runtime, /--no-sandbox/);
});

test('classifyUntypedRunnerError uses error.name only — never message text', () => {
  const timeout = new Error('page.setDefaultTimeout synthetic secret Timeout 5000ms exceeded');
  timeout.name = 'TimeoutError';
  assert.equal(classifyUntypedRunnerError(timeout), 'playwright_timeout');

  const destroyed = new Error('Execution context was destroyed synthetic page text');
  destroyed.name = 'Error';
  assert.equal(classifyUntypedRunnerError(destroyed), 'runner_exception');

  assert.equal(classifyUntypedRunnerError(new SujainReadError('credentials_invalid')), null);
  assert.equal(classifyUntypedRunnerError(null), 'runner_exception');
  assert.equal(classifyUntypedRunnerError('string-throw'), 'runner_exception');
});

test('runner catch attaches allowlisted reason for untyped failures', async () => {
  const runtime = await readFile(new URL('../run.mjs', import.meta.url), 'utf8');
  const policy = await readFile(new URL('../policy.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /classifyUntypedRunnerError/);
  assert.match(policy, /playwright_timeout/);
  assert.match(policy, /runner_exception/);
  assert.match(policy, /error\.name/);
  assert.doesNotMatch(policy, /error\.message/);
  assert.doesNotMatch(runtime, /error\.message/);
  assert.doesNotMatch(runtime, /\.stack/);
});
