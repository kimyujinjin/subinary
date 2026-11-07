import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SujainBrowserClient,
  classifySujainRunnerFailure,
  sanitizeSujainRunnerStderr,
} from './sujain-browser';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => JSON.stringify({ name: 'playwright-core', version: '1.62.0' })),
}));

const credentials = () => ({ loginId: 'synthetic-id', password: 'Synthetic!123' });

function client(enabled = true) {
  return new SujainBrowserClient({
    get: () => ({
      enabled,
      runnerPath: '/synthetic-sujain/run.mjs',
      browserExecutable: '/synthetic-sujain/chromium',
    }),
  } as unknown as ConfigService);
}

function child() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    killed: false,
    kill: vi.fn(() => true),
  });
  let input = '';
  process.stdin.on('data', (chunk: Buffer | string) => { input += chunk.toString(); });
  vi.mocked(spawn).mockReturnValueOnce(process as unknown as ReturnType<typeof spawn>);
  return {
    process,
    input: () => input,
    close: (code = 0) => { process.exitCode = code; process.emit('close', code); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReturnValue(true);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('sujain runner diagnostics without credentials', () => {
  it('keeps only chromium launch signals and redacts credential substrings', () => {
    const raw = [
      'Running as root without --no-sandbox is not supported.',
      'login=synthetic-id password=Synthetic!123',
      'unrelated noise line',
    ].join('\n');
    const sanitized = sanitizeSujainRunnerStderr(raw, credentials());
    expect(sanitized).toContain('Running as root without --no-sandbox');
    expect(sanitized).not.toContain('Synthetic!123');
    expect(sanitized).not.toContain('synthetic-id');
    expect(sanitized).not.toContain('unrelated noise');
  });

  it('maps root sandbox stderr to runtime_unavailable when JSON is missing', () => {
    expect(classifySujainRunnerFailure(
      1,
      null,
      'Running as root without --no-sandbox is not supported.\n',
    )).toEqual({ code: 'runtime_unavailable', reason: 'chromium_launch_failed' });
  });

  it('preserves allowlisted runner reason from stdout JSON', () => {
    expect(classifySujainRunnerFailure(
      0,
      { error: 'runtime_unavailable', reason: 'chromium_launch_failed' },
      '',
    )).toEqual({ code: 'runtime_unavailable', reason: 'chromium_launch_failed' });
  });
});

describe('sujain child transport with synthetic streams', () => {
  it('pipes stderr and surfaces chromium_launch_failed without echoing secrets', async () => {
    const test = child();
    const pending = client().read(credentials(), new AbortController().signal);
    const call = vi.mocked(spawn).mock.calls[0]!;
    expect(call[2]?.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(JSON.stringify(call)).not.toContain('Synthetic!123');
    test.process.stderr.write('Running as root without --no-sandbox is not supported.\n');
    test.process.stdout.write(JSON.stringify({
      ok: false,
      error: 'runtime_unavailable',
      reason: 'chromium_launch_failed',
    }));
    test.close(0);
    await expect(pending).rejects.toMatchObject({
      code: 'runtime_unavailable',
      reason: 'chromium_launch_failed',
      message: 'Sujain read did not complete',
    });
    expect(test.input()).toContain('synthetic-id');
  });

  it('remaps hard exit with sandbox stderr when stdout is empty', async () => {
    const test = child();
    const pending = client().read(credentials(), new AbortController().signal);
    test.process.stderr.write('No usable sandbox!\n');
    test.close(1);
    await expect(pending).rejects.toMatchObject({
      code: 'runtime_unavailable',
      reason: 'chromium_launch_failed',
    });
  });
});
