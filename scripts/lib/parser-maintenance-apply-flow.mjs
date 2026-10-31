/**
 * 배포 health 실패만 이전 이미지로 복구한다. 큐 전달 이후에는 재전송·거래 역변경하지 않는다.
 * @param {{deploy:()=>Promise<void>,healthy:()=>Promise<boolean>,canRollback:()=>Promise<boolean>,rollback:()=>Promise<void>,verifyRollback:()=>Promise<boolean>,plan:()=>Promise<{targets:number}>,enqueue:()=>Promise<unknown>,verify:()=>Promise<{verified:number,total:number}>,wait:()=>Promise<void>,targets:number}} io
 */
export async function executeMaintenanceApply(io) {
  try {
    await io.deploy();
    if (!await io.healthy()) throw new Error('unhealthy');
  } catch {
    // A preflight failure or another deployer's containers are not ours to undo.
    try {
      if (typeof io.canRollback !== 'function' || await io.canRollback() !== true) {
        return { status: 'held', phase: 'deployment_conflict', notification: 'none' };
      }
    } catch { return { status: 'held', phase: 'deployment_ownership_unknown', notification: 'none' }; }
    let rollbackResponseUnknown = false;
    try { await io.rollback(); } catch { rollbackResponseUnknown = true; }
    // Both successful and lost CLI responses need a fresh owned-state check:
    // the command's immediate inspect response can be lost independently too.
    try {
      if (typeof io.verifyRollback !== 'function') throw new Error('rollback_verification_missing');
      if (await io.verifyRollback() === true) {
        return { status: 'rolled_back', phase: 'deployment', notification: 'none' };
      }
      if (!rollbackResponseUnknown) return { status: 'rollback_unhealthy', phase: 'deployment', notification: 'none' };
    } catch { /* Unknown state is not evidence of a failed or completed write. */ }
    return { status: 'held', phase: 'rollback_outcome_unknown', notification: 'none' };
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
