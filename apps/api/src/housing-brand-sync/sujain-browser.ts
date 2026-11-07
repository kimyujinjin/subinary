import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { configSchema } from '@family/config';
import { housingBrandSyncErrorSchema, type HousingBrandSyncError } from '@family/contracts';
import { parseSujainRows, type SujainRawRow } from './sujain-parse';

export class SujainBrowserError extends Error {
  constructor(
    readonly code: HousingBrandSyncError,
    /** Fixed allowlisted runner reason only — never credentials or raw stderr. */
    readonly reason: string | null = null,
  ) {
    super('Sujain read did not complete');
  }
}

export type SujainCredentials = { loginId: string; password: string };

const failureReasonSchema = z.enum(['chromium_launch_failed']);

const responseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    capturedAt: z.string().datetime({ offset: true }),
    rows: z.array(z.object({
      cells: z.array(z.string().max(200)).max(20),
      headers: z.array(z.string().max(100)).max(20).optional(),
      sourcePage: z.enum(['payment', 'unit-items']),
    }).strict()).max(100),
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: housingBrandSyncErrorSchema,
    reason: failureReasonSchema.optional(),
  }).strict(),
]);

const STDERR_KEEP = /sandbox|no-sandbox|chromium|chrome|playwright|headless|zygote|executable|permission denied|cannot open|\berror\b/i;

/** Keep only short Chromium/Playwright launch signals. Never persist raw stderr. */
export function sanitizeSujainRunnerStderr(raw: string, credentials?: SujainCredentials): string {
  let text = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  if (credentials?.loginId) text = text.split(credentials.loginId).join('[redacted]');
  if (credentials?.password) text = text.split(credentials.password).join('[redacted]');
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && STDERR_KEEP.test(line))
    .join(' | ')
    .slice(0, 240);
}

export function classifySujainRunnerFailure(
  exitCode: number | null,
  payload: { error: HousingBrandSyncError; reason?: z.infer<typeof failureReasonSchema> } | null,
  stderr: string,
): { code: HousingBrandSyncError; reason: string | null } {
  if (payload) {
    return { code: payload.error, reason: payload.reason ?? null };
  }
  if (/Running as root without --no-sandbox|No usable sandbox|chromium.?sandbox/i.test(stderr)) {
    return { code: 'runtime_unavailable', reason: 'chromium_launch_failed' };
  }
  if (exitCode !== 0) return { code: 'operation_unknown', reason: null };
  return { code: 'operation_unknown', reason: null };
}

/**
 * 수자인 전용 브라우저 자식. 신한 bank-web-runner와 경로·공급자를 섞지 않는다.
 * 자격증명은 stdin JSON으로만 넘기고 argv/env/로그에 평문을 두지 않는다.
 */
@Injectable()
export class SujainBrowserClient {
  readonly configured: boolean;
  readonly available: boolean;
  readonly #logger = new Logger(SujainBrowserClient.name);
  #runner: string;
  #executable: string;
  #active = false;

  constructor(config: ConfigService) {
    const parsed = configSchema.shape.sujainWebConnections.safeParse(config.get('sujainWebConnections'));
    if (!parsed.success) throw new Error('Sujain browser configuration unavailable');
    this.configured = parsed.data.enabled;
    this.#runner = resolve(parsed.data.runnerPath ?? join(process.cwd(), 'tools/sujain-web-runner/run.mjs'));
    this.#executable = parsed.data.browserExecutable ?? '';
    let runtimePresent = false;
    if (this.configured && isAbsolute(this.#executable) && existsSync(this.#runner) && existsSync(this.#executable)) {
      try {
        const pkg = JSON.parse(readFileSync(join(dirname(this.#runner), 'node_modules/playwright-core/package.json'), 'utf8')) as { name?: string; version?: string };
        runtimePresent = pkg.name === 'playwright-core' && pkg.version === '1.62.0';
      } catch { /* Missing runtime is a capability, never a request for credentials. */ }
    }
    this.available = this.configured && runtimePresent;
  }

  /** 테스트·합성용. 브라우저 없이 표 행만 해석한다. */
  parseRows(rows: SujainRawRow[]) {
    return parseSujainRows(rows);
  }

  async read(credentials: SujainCredentials, signal: AbortSignal): Promise<{
    capturedAt: string;
    rows: SujainRawRow[];
  }> {
    if (!this.available || signal.aborted || this.#active) throw new SujainBrowserError('runtime_unavailable');
    return new Promise((resolveResult, rejectResult) => {
      let output = '';
      let stderr = '';
      let bytes = 0;
      let errBytes = 0;
      let settled = false;
      const child = spawn(process.execPath, [this.#runner], {
        cwd: dirname(this.#runner),
        env: {
          PATH: '/usr/local/bin:/usr/bin:/bin',
          TZ: 'Asia/Seoul',
          SUJAIN_WEB_BROWSER_EXECUTABLE: this.#executable,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.#active = true;
      const finish = (error?: HousingBrandSyncError, payload?: { capturedAt: string; rows: SujainRawRow[] }, reason: string | null = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        const diagnostic = sanitizeSujainRunnerStderr(stderr, credentials);
        output = '';
        stderr = '';
        if (error || !payload) {
          if (diagnostic) {
            this.#logger.warn(`sujain runner failed code=${error ?? 'operation_unknown'} reason=${reason ?? 'none'} detail=${diagnostic}`);
          } else if (reason) {
            this.#logger.warn(`sujain runner failed code=${error ?? 'operation_unknown'} reason=${reason}`);
          }
          rejectResult(new SujainBrowserError(error ?? 'operation_unknown', reason));
        } else resolveResult(payload);
      };
      const stop = () => {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGTERM');
          const hard = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2000);
          hard.unref();
        }
      };
      const abort = () => { stop(); finish('operation_unknown'); };
      const timer = setTimeout(abort, 60_000);
      signal.addEventListener('abort', abort, { once: true });
      child.on('error', () => { this.#active = false; finish('runtime_unavailable'); });
      child.stdin.on('error', () => { stop(); finish('operation_unknown'); });
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 65_536) { stop(); finish('operation_unknown'); return; }
        output += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        errBytes += chunk.byteLength;
        if (errBytes > 8_192) return;
        stderr += chunk.toString('utf8');
      });
      child.on('close', (code) => {
        this.#active = false;
        if (settled) return;
        let payload: { error: HousingBrandSyncError; reason?: z.infer<typeof failureReasonSchema> } | null = null;
        let success: { capturedAt: string; rows: SujainRawRow[] } | undefined;
        if (code === 0) {
          try {
            const parsed = responseSchema.safeParse(JSON.parse(output));
            if (parsed.success) {
              if (parsed.data.ok) success = { capturedAt: parsed.data.capturedAt, rows: parsed.data.rows };
              else payload = { error: parsed.data.error, reason: parsed.data.reason };
            }
          } catch { /* fall through to classify */ }
        }
        if (success) { finish(undefined, success); return; }
        const failure = classifySujainRunnerFailure(code, payload, stderr);
        finish(failure.code, undefined, failure.reason);
      });
      child.stdin.end(JSON.stringify({
        provider: 'sujain',
        credentials: { loginId: credentials.loginId, password: credentials.password },
      }));
      if (signal.aborted) abort();
    });
  }
}
