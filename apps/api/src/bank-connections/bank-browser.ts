import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { configSchema } from '@family/config';
import { bankConnectionErrorSchema, bankObservationSchema, bankCaptureMatchesSelector, type BankConnectionError, type BankSelector, type BankObservation } from '@family/contracts';

export class BankBrowserError extends Error {
  constructor(readonly code: BankConnectionError) { super('Bank read did not complete'); }
}
const response = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), capture: bankObservationSchema }).strict(),
  z.object({ ok: z.literal(false), error: bankConnectionErrorSchema }).strict(),
]);
export type BankCredentials = { loginId: string; password: string };

/** A dedicated child receives only the selected bank credential via stdin, never argv, env or logs. */
@Injectable()
export class BankBrowserClient {
  readonly configured: boolean;
  readonly available: boolean;
  #runner: string;
  #executable: string;
  #active = false;

  constructor(config: ConfigService) {
    const parsed = configSchema.shape.bankWebConnections.safeParse(config.get('bankWebConnections'));
    if (!parsed.success) throw new Error('Bank browser configuration unavailable');
    this.configured = parsed.data.enabled;
    this.#runner = resolve(parsed.data.runnerPath ?? join(process.cwd(), 'tools/bank-web-runner/run.mjs'));
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

  async read(credentials: BankCredentials, selector: BankSelector, signal: AbortSignal): Promise<BankObservation> {
    // One browser job per API instance, including the period after a cancel result
    // while its child is still exiting. Never multiply headless processes on refresh.
    if (!this.available || signal.aborted || this.#active) throw new BankBrowserError('runtime_unavailable');
    return new Promise((resolveResult, rejectResult) => {
      let output = '', bytes = 0, settled = false;
      const child = spawn(process.execPath, [this.#runner], { cwd: dirname(this.#runner),
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', TZ: 'Asia/Seoul', BANK_WEB_BROWSER_EXECUTABLE: this.#executable },
        stdio: ['pipe', 'pipe', 'ignore'] });
      this.#active = true;
      const finish = (error?: BankConnectionError, capture?: BankObservation) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        output = '';
        if (error || !capture) rejectResult(new BankBrowserError(error ?? 'operation_unknown'));
        else resolveResult(capture);
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
        if (bytes > 32_768) { stop(); finish('operation_unknown'); return; }
        output += chunk.toString('utf8');
      });
      child.on('close', code => {
        this.#active = false;
        if (settled) return;
        if (code !== 0) { finish('operation_unknown'); return; }
        try {
          const parsed = response.safeParse(JSON.parse(output));
          if (!parsed.success) { finish('operation_unknown'); return; }
          if (!parsed.data.ok) { finish(parsed.data.error); return; }
          const capture = parsed.data.capture;
          const age = Date.now() - Date.parse(capture.capturedAt);
          if (!bankCaptureMatchesSelector(selector, capture)
            || age < -30_000 || age > 120_000) { finish('account_changed'); return; }
          finish(undefined, capture);
        } catch { finish('operation_unknown'); }
      });
      child.stdin.end(JSON.stringify({ provider: 'shinhan_bank', credentials, selector }));
      if (signal.aborted) abort();
    });
  }
}
