/**
 * 배포 health 실패만 이전 이미지로 복구한다. 큐 전달 이후에는 재전송·거래 역변경하지 않는다.
 * @param {{deploy:()=>Promise<void>,healthy:()=>Promise<boolean>,rollback:()=>Promise<void>,plan:()=>Promise<{targets:number}>,enqueue:()=>Promise<unknown>,verify:()=>Promise<{verified:number,total:number}>,wait:()=>Promise<void>,targets:number}} io
 */
export async function executeMaintenanceApply(io) {
  try {
    await io.deploy();
    if (!await io.healthy()) throw new Error('unhealthy');
  } catch {
    try {
      await io.rollback();
      return { status: await io.healthy() ? 'rolled_back' : 'rollback_unhealthy', phase: 'deployment', notification: 'none' };
    } catch { return { status: 'rollback_failed', phase: 'deployment', notification: 'none' }; }
  }
  try {
    const plan = await io.plan();
    if (plan.targets !== io.targets || io.targets < 1 || io.targets > 100) return { status: 'held', phase: 'scope_plan', notification: 'none' };
  } catch { return { status: 'held', phase: 'scope_plan', notification: 'none' }; }
  let outcomeUnknown = false;
  try { await io.enqueue(); } catch { outcomeUnknown = true; }
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const actual = await io.verify();
      if (actual.total === io.targets && actual.verified === io.targets) return { status: 'verified', phase: 'complete', verified: actual.verified, notification: 'none' };
    } catch { /* 조회 실패를 0건 또는 완료로 바꾸지 않는다. */ }
    await io.wait();
  }
  return { status: outcomeUnknown ? 'repair_outcome_unknown' : 'repair_incomplete', phase: 'verification', notification: 'none' };
}
