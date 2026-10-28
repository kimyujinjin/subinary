/** 내부 세션 확인을 겹치지 않게 실행하고 종료 시 진행 중 작업까지 기다린다. */
export function startSessionMaintenance(
  run: (shouldStop: () => boolean) => Promise<unknown>,
  onFailure: () => void,
  intervalMs = 6 * 60 * 60 * 1000,
): () => Promise<void> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('세션 확인 주기는 양수여야 합니다.');
  let stopped = false;
  let running: Promise<void> | undefined;
  const tick = (): void => {
    if (stopped || running) return;
    running = Promise.resolve().then(() => run(() => stopped)).then(() => undefined)
      .catch(() => { onFailure(); })
      .finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
