import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BankBrowserClient } from './bank-browser';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => JSON.stringify({ name: 'playwright-core', version: '1.62.0' })) }));
const NOW = Date.parse('2026-11-02T00:00:00Z');
const credentials = () => ({ loginId: 'synthetic-id', password: 'Synthetic!123' });
const selector = { accountLast4: '1234', loanType: 'interim' as const };
const capture = () => ({ formatVersion: 1, provider: 'shinhan', source: 'browser_assisted',
  origin: 'https://bank.shinhan.com', pageKind: 'loan_account_list', capturedAt: new Date(NOW).toISOString(),
  accountFingerprint: 'a'.repeat(64), ...selector, outstandingPrincipalKrw: '9007199254740993', maturityDate: null, bankAsOfDate: null });
function client(enabled = true) {
  return new BankBrowserClient({ get: () => ({ enabled, runnerPath: '/synthetic-bank/run.mjs',
    browserExecutable: '/synthetic-bank/chromium' }) } as unknown as ConfigService);
}
function child() {
  const process = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
    exitCode: null as number | null, killed: false, kill: vi.fn(() => true) });
  let input = '';
  process.stdin.on('data', chunk => { input += chunk.toString(); });
  vi.mocked(spawn).mockReturnValueOnce(process as unknown as ReturnType<typeof spawn>);
  return { process, input: () => input, close: () => { process.exitCode = 0; process.emit('close', 0); } };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(existsSync).mockReturnValue(true); vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('bank child transport with synthetic streams, no browser or bank connection', () => {
  it('disabled or missing runtime never starts a process', async () => {
    const disabled = client(false); expect(disabled.available).toBe(false);
    await expect(disabled.read(credentials(), selector, new AbortController().signal)).rejects.toMatchObject({ code: 'runtime_unavailable' });
    vi.mocked(existsSync).mockReturnValue(false); expect(client().available).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('sends credentials only through stdin, with fixed argv and minimal environment', async () => {
    const test = child(), service = client(), pending = service.read(credentials(), selector, new AbortController().signal);
    const call = vi.mocked(spawn).mock.calls[0]!;
    expect(call[1]).toEqual(['/synthetic-bank/run.mjs']);
    expect(call[2]?.env).toEqual({ PATH: '/usr/local/bin:/usr/bin:/bin', TZ: 'Asia/Seoul', BANK_WEB_BROWSER_EXECUTABLE: '/synthetic-bank/chromium' });
    expect(JSON.stringify(call)).not.toContain('Synthetic!123');
    expect(JSON.parse(test.input()).credentials).toEqual(credentials());
    test.process.stdout.write(JSON.stringify({ ok: true, capture: capture() })); test.close();
    expect(await pending).toMatchObject({outstandingPrincipalKrw:'9007199254740993'});
  });
  it.each(['foreign', 'stale', 'extra'])('rejects %s results without returning raw output', async kind => {
    const test = child(), service = client(), pending = service.read(credentials(), selector, new AbortController().signal);
    const value = capture();
    if (kind === 'foreign') value.accountLast4 = '5678';
    if (kind === 'stale') value.capturedAt = new Date(NOW - 120001).toISOString();
    const response = kind === 'extra' ? { ok: true, capture: value, rawPassword: 'PRIVATE_FIXTURE' } : { ok: true, capture: value };
    const outcome = expect(pending).rejects.toMatchObject({ message: 'Bank read did not complete' });
    test.process.stdout.write(JSON.stringify(response)); test.close(); await outcome;
  });
  it('keeps its browser slot occupied after cancellation until the child closes', async () => {
    const test = child(), service = client(), controller = new AbortController();
    const pending = service.read(credentials(), selector, controller.signal);
    const outcome = expect(pending).rejects.toMatchObject({ code: 'operation_unknown' });
    controller.abort(); await outcome;
    expect(test.process.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(service.read(credentials(), selector, new AbortController().signal)).rejects.toMatchObject({ code: 'runtime_unavailable' });
    expect(spawn).toHaveBeenCalledTimes(1); test.close();
    const second = child(), next = service.read(credentials(), selector, new AbortController().signal);
    const nextOutcome = expect(next).rejects.toMatchObject({ code: 'authentication_required' });
    second.process.stdout.write(JSON.stringify({ ok: false, error: 'authentication_required' })); second.close(); await nextOutcome;
    expect(spawn).toHaveBeenCalledTimes(2);
  });
  it('stops oversized output and discards it rather than exposing page text', async () => {
    const test = child(), pending = client().read(credentials(), selector, new AbortController().signal);
    const outcome = expect(pending).rejects.toMatchObject({ code: 'operation_unknown' });
    test.process.stdout.write(Buffer.alloc(32769, 'x')); await outcome;
    expect(test.process.kill).toHaveBeenCalledWith('SIGTERM'); test.close();
  });
});
