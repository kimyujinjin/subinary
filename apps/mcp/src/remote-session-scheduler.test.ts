import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSessionMaintenance } from './remote-session-scheduler';

afterEach(() => { vi.useRealTimers(); });

describe('연결 세션 확인 주기', () => {
  it('시작 시 실행하고 다음 주기에 다시 실행하며 종료 뒤에는 멈춘다', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const stop = startSessionMaintenance(run, vi.fn(), 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    await stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('진행 중인 갱신과 겹치지 않고 종료 시 해당 작업을 기다린다', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    let shouldStop: () => boolean = () => false;
    const run = vi.fn((closed: () => boolean) => {
      shouldStop = closed;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const stop = startSessionMaintenance(run, vi.fn(), 100);
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(1);
    let stopped = false;
    const pending = stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(shouldStop()).toBe(true);
    expect(stopped).toBe(false);
    finish();
    await pending;
    expect(stopped).toBe(true);
  });

  it('실패 내용을 출력하지 않고 다음 주기에 다시 확인한다', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValueOnce(new Error('synthetic-secret')).mockResolvedValue(undefined);
    const failed = vi.fn();
    const stop = startSessionMaintenance(run, failed, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(failed).toHaveBeenCalledExactlyOnceWith();
    expect(run).toHaveBeenCalledTimes(2);
    await stop();
    expect(() => startSessionMaintenance(run, failed, 0)).toThrow('세션 확인 주기');
  });
});
