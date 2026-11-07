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
  coerceSujainRunnerRows,
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

  it('preserves response_validation_failed and response_too_large reasons', () => {
    expect(classifySujainRunnerFailure(
      0,
      { error: 'operation_unknown', reason: 'response_validation_failed' },
      '',
    )).toEqual({ code: 'operation_unknown', reason: 'response_validation_failed' });
    expect(classifySujainRunnerFailure(
      0,
      { error: 'operation_unknown', reason: 'response_too_large' },
      '',
    )).toEqual({ code: 'operation_unknown', reason: 'response_too_large' });
  });

  it('truncates synthetic overlong cells without inventing values', () => {
    const longCell = `synthetic-cell-${'x'.repeat(250)}`;
    const coerced = coerceSujainRunnerRows([{
      cells: [longCell, '1,000'],
      headers: [`synthetic-header-${'y'.repeat(120)}`, '금액'],
      sourcePage: 'payment',
    }]);
    expect(coerced).toEqual([{
      cells: [longCell.slice(0, 200), '1,000'],
      headers: [`synthetic-header-${'y'.repeat(120)}`.slice(0, 100), '금액'],
      sourcePage: 'payment',
    }]);
    expect(coerceSujainRunnerRows([{ cells: [123], sourcePage: 'payment' }])).toBeNull();
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

  it('accepts ok:true rows whose synthetic cells exceed schema caps by truncating', async () => {
    const test = child();
    const pending = client().read(credentials(), new AbortController().signal);
    const longCell = `synthetic-cell-${'x'.repeat(250)}`;
    const longHeader = `synthetic-header-${'y'.repeat(120)}`;
    expect(longCell.length).toBeGreaterThan(200);
    expect(longHeader.length).toBeGreaterThan(100);
    test.process.stdout.write(JSON.stringify({
      ok: true,
      capturedAt: '2026-11-07T11:29:47.599+00:00',
      rows: [{
        cells: [longCell, '1,000'],
        headers: [longHeader, '금액'],
        sourcePage: 'payment',
      }],
    }));
    test.close(0);
    const result = await pending;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.cells[0]!.length).toBe(200);
    expect(result.rows[0]!.headers![0]!.length).toBe(100);
    expect(result.rows[0]!.cells[1]).toBe('1,000');
  });

  it('marks oversized stdout as operation_unknown with response_too_large reason', async () => {
    const test = child();
    const pending = client().read(credentials(), new AbortController().signal);
    // Stay under schema row caps but exceed the previous 65_536-byte kill switch.
    const fat = 'z'.repeat(70_000);
    test.process.stdout.write(JSON.stringify({
      ok: true,
      capturedAt: '2026-11-07T11:29:47.599+00:00',
      rows: [{ cells: [fat], headers: ['구분'], sourcePage: 'payment' }],
    }));
    // With the raised cap this still parses; force the kill path via a second huge chunk after open.
    // Emit enough bytes that the transport rejects before close.
    test.process.stdout.write('a'.repeat(1_100_000));
    test.close(0);
    await expect(pending).rejects.toMatchObject({
      code: 'operation_unknown',
      reason: 'response_too_large',
    });
  });

  it('surfaces response_validation_failed when ok payload cannot be coerced', async () => {
    const test = child();
    const pending = client().read(credentials(), new AbortController().signal);
    test.process.stdout.write(JSON.stringify({
      ok: true,
      capturedAt: '2026-11-07T11:29:47.599+00:00',
      rows: [{
        cells: [123],
        headers: ['구분'],
        sourcePage: 'payment',
      }],
    }));
    test.close(0);
    await expect(pending).rejects.toMatchObject({
      code: 'operation_unknown',
      reason: 'response_validation_failed',
    });
  });

  it('keeps typed ok:false error when optional reason is not allowlisted', async () => {
    const test = child();
    const pending = client().read(credentials(), new AbortController().signal);
    test.process.stdout.write(JSON.stringify({
      ok: false,
      error: 'credentials_invalid',
      reason: 'not-an-allowlisted-token',
    }));
    test.close(0);
    await expect(pending).rejects.toMatchObject({
      code: 'credentials_invalid',
      reason: null,
    });
  });
});
