import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@family/database';
import { RecurringService } from './recurring.service';
import { RecurringRefreshService } from './recurring-refresh.service';
import { RECURRING_REFRESH_INTERVAL_MS } from './recurring.constants';

describe('정기결제 자동 갱신 타이머', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function createRefresh(): RecurringRefreshService {
    const db = {} as Db;
    return new RecurringRefreshService(db, new RecurringService(db));
  }

  it('시작 시와 30분마다 실행하고 종료하면 멈춘다', async () => {
    vi.useFakeTimers();
    vi.stubEnv('RECURRING_RADAR_ENABLED', 'true');
    const refresh = createRefresh();
    const run = vi.spyOn(refresh, 'refreshDue').mockResolvedValue({ refreshed: 0, failed: 0 });
    refresh.onApplicationBootstrap();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECURRING_REFRESH_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    refresh.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(RECURRING_REFRESH_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('기능이 꺼져 있으면 자동 실행하지 않는다', async () => {
    vi.useFakeTimers();
    vi.stubEnv('RECURRING_RADAR_ENABLED', 'false');
    const refresh = createRefresh();
    const run = vi.spyOn(refresh, 'refreshDue');
    refresh.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(RECURRING_REFRESH_INTERVAL_MS);
    expect(run).not.toHaveBeenCalled();
    refresh.onApplicationShutdown();
  });

  it('첫 계산에 시간이 걸려도 완료 뒤 30분 후에 다시 갱신한다', async () => {
    vi.useFakeTimers();
    vi.stubEnv('RECURRING_RADAR_ENABLED', 'true');
    const refresh = createRefresh();
    const run = vi.spyOn(refresh, 'refreshDue')
      .mockImplementationOnce(() => new Promise((resolve) => {
        setTimeout(() => resolve({ refreshed: 1, failed: 0 }), 60_000);
      }))
      .mockResolvedValue({ refreshed: 1, failed: 0 });
    refresh.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000 + RECURRING_REFRESH_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    refresh.onApplicationShutdown();
  });

  it('한 번의 장애가 다음 주기 실행을 막지 않는다', async () => {
    vi.useFakeTimers();
    vi.stubEnv('RECURRING_RADAR_ENABLED', 'true');
    const refresh = createRefresh();
    const run = vi.spyOn(refresh, 'refreshDue')
      .mockRejectedValueOnce(new Error('합성 연결 장애'))
      .mockResolvedValue({ refreshed: 1, failed: 0 });
    refresh.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(RECURRING_REFRESH_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    refresh.onApplicationShutdown();
  });
});
