import {
  SujainReadError,
  allowedRequest,
  chromiumSandboxEnabled,
  classifyUntypedRunnerError,
  validateJob,
} from './policy.mjs';
import { readSujainPages } from './collect.mjs';

let browser, context, job;
let closing = false;
/** Fixed reason codes only — never Chromium stderr, URLs with secrets, or credentials. */
let failureReason;
async function close() {
  if (closing) return;
  closing = true;
  try { await context?.close(); } catch { /* No diagnostic body. */ }
  try { await browser?.close(); } catch { /* No diagnostic body. */ }
}
process.on('SIGTERM', () => { void close().finally(() => process.exit(0)); });
process.on('SIGINT', () => { void close().finally(() => process.exit(0)); });
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString('utf8');
    if (Buffer.byteLength(input, 'utf8') > 8192) throw new SujainReadError('operation_unknown');
  }
  try { job = validateJob(JSON.parse(input)); } catch { throw new SujainReadError('operation_unknown'); }
  input = '';
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { throw new SujainReadError('runtime_unavailable'); }
  const executablePath = process.env.SUJAIN_WEB_BROWSER_EXECUTABLE;
  if (!executablePath?.startsWith('/')) throw new SujainReadError('runtime_unavailable');
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      chromiumSandbox: chromiumSandboxEnabled(),
      timeout: 20_000,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TZ: 'Asia/Seoul' },
    });
  } catch {
    failureReason = 'chromium_launch_failed';
    throw new SujainReadError('runtime_unavailable');
  }
  context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
  await context.route('**/*', (route) => (allowedRequest(route.request().url()) ? route.continue() : route.abort()));
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const capture = await readSujainPages(page, job);
  process.stdout.write(JSON.stringify({ ok: true, ...capture }));
} catch (error) {
  const payload = {
    ok: false,
    error: error instanceof SujainReadError ? error.code : 'operation_unknown',
  };
  if (failureReason && payload.error === 'runtime_unavailable') {
    payload.reason = failureReason;
  } else {
    const untyped = classifyUntypedRunnerError(error);
    if (untyped) payload.reason = untyped;
  }
  process.stdout.write(JSON.stringify(payload));
} finally {
  if (job?.credentials) {
    job.credentials.password = '';
    job.credentials.loginId = '';
  }
  await close();
}
