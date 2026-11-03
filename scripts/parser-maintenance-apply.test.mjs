import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeMaintenanceApply } from './lib/parser-maintenance-apply-flow.mjs';
import { createMaintenanceDeployment, maintenanceComposeChangeArgs, withMaintenanceApplyLock } from './lib/parser-maintenance-deploy-guard.mjs';
function setup(patch = {}) {
  const calls = [];
  return { calls, io: { targets: 1, deploy: async () => { calls.push('deploy'); }, healthy: async () => true,
    canRollback: async () => true, rollback: async () => { calls.push('rollback'); }, verifyRollback: async () => true,
    plan: async () => ({ targets: 1 }), enqueue: async () => { calls.push('enqueue'); },
    verify: async () => ({ verified: 1, total: 1 }), wait: async () => {}, ...patch } };
}
test('배포와 실제 재처리 검증까지 끝나야 완료다', async () => {
  const { calls, io } = setup(); assert.equal((await executeMaintenanceApply(io)).status, 'verified'); assert.deepEqual(calls, ['deploy', 'enqueue']);
});

const image = digit => `sha256:${digit.repeat(64)}`;
const id = digit => digit.repeat(64);
function deploymentHarness() {
  const compose = { project: 'family-memory-ai', directory: '/synthetic/worktree',
    files: ['/synthetic/prod.yml', '/synthetic/mcp.yml'], envFiles: ['/synthetic/runtime-env', '/synthetic/prod-env'] };
  const candidateFiles = [...compose.files, '/synthetic/run-one/candidate.compose.json'];
  const rollbackFiles = [...compose.files, '/synthetic/run-one/rollback.compose.json'];
  const baseline = ['api', 'worker'].map((service, index) => ({ service, id: id(String(index + 1)),
    image: image('a'), project: compose.project, directory: compose.directory,
    files: compose.files.join(','), envFiles: compose.envFiles.join(','), health: 'healthy' }));
  let current = structuredClone(baseline); let changed = false; let unreadable = false; let readsToFail = 0;
  let change = async (kind, roles) => {
    current = current.map((state, index) => roles.includes(state.service) ? {
      ...baseline[index], id: id(String(index + (kind === 'candidate' ? 3 : 5))),
      image: kind === 'candidate' ? image('b') : image('a'),
      files: (kind === 'candidate' ? candidateFiles : rollbackFiles).join(','),
    } : state);
  };
  const calls = [];
  const guard = createMaintenanceDeployment({ baseline, compose, baselineImage: image('a'), candidateImage: image('b'),
    candidateFiles, rollbackFiles,
    assertUnchanged: async () => { if (changed) throw new Error('maintenance_settings_changed'); },
    readStates: async () => { if (unreadable || readsToFail-- > 0) throw new Error('maintenance_runtime_unknown'); return structuredClone(current); },
    changeImage: async (kind, roles) => { calls.push({ kind, roles }); await change(kind, roles); },
  });
  return { guard, calls, baseline, candidateFiles, rollbackFiles,
    states: () => structuredClone(current), set: value => { current = structuredClone(value); },
    change: callback => { const original = change; change = (kind, roles) => callback(kind, roles, original); },
    settingsChanged: () => { changed = true; }, unreadable: () => { unreadable = true; }, failReads: count => { readsToFail = count; } };
}

function guardedFlow(h, patch = {}) {
  const queued = [];
  return { queued, io: {
    targets: 1, deploy: () => h.guard.deploy(), canRollback: () => h.guard.canRollback(),
    rollback: () => h.guard.rollback(), healthy: () => h.guard.healthy(),
    verifyRollback: async () => { await h.guard.assertRollback(); return h.guard.healthy(); },
    plan: async () => ({ targets: 1 }), enqueue: async () => { queued.push('apply'); },
    verify: async () => ({ verified: 1, total: 1 }), wait: async () => {}, ...patch,
  } };
}

test('배포 직전 설정 변경은 Compose와 rollback 모두 실행하지 않는다', async () => {
  const h = deploymentHarness(); h.settingsChanged();
  const { io, queued } = guardedFlow(h);
  assert.equal((await executeMaintenanceApply(io)).status, 'held');
  assert.deepEqual(h.calls, []); assert.deepEqual(queued, []);
});

test('초기 점검 뒤 다른 이미지나 같은 이미지의 새 컨테이너가 생기면 배포하지 않는다', async () => {
  for (const sameImage of [false, true]) {
    const h = deploymentHarness();
    h.set(h.states().map(state => ({ ...state, id: id('7'), image: sameImage ? image('a') : image('c') })));
    const result = await executeMaintenanceApply(guardedFlow(h).io);
    assert.equal(result.status, 'held'); assert.deepEqual(h.calls, []);
  }
});

test('초기 점검 뒤 Compose project/directory/files/env 순서가 바뀌면 배포하지 않는다', async () => {
  for (const field of ['project', 'directory', 'files', 'envFiles']) {
    const h = deploymentHarness(); const current = h.states(); current[0][field] += '-changed'; h.set(current);
    assert.equal((await executeMaintenanceApply(guardedFlow(h).io)).status, 'held');
    assert.deepEqual(h.calls, []);
  }
});

test('가짜 Docker runner에 넘기는 부분 복구 인자는 기존 Compose/env 순서와 단일 role만 담는다', () => {
  const compose = { project: 'family-memory-ai', directory: '/synthetic/root', envFiles: ['/synthetic/base-env', '/synthetic/prod-env'] };
  assert.deepEqual(maintenanceComposeChangeArgs(compose, ['/synthetic/prod.yml', '/synthetic/mcp.yml'], '/synthetic/rollback.json', ['worker']),
    ['compose', '-p', 'family-memory-ai', '--project-directory', '/synthetic/root', '--env-file', '/synthetic/base-env', '--env-file', '/synthetic/prod-env',
      '-f', '/synthetic/prod.yml', '-f', '/synthetic/mcp.yml', '-f', '/synthetic/rollback.json', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'worker']);
  for (const roles of [[], ['api', 'api'], ['web'], ['api', 'worker', 'web']]) {
    assert.throws(() => maintenanceComposeChangeArgs(compose, [], '/synthetic/rollback.json', roles), /maintenance_deployment_roles_invalid/u);
  }
});

test('자기 candidate의 ID와 라벨·health가 모두 맞아야 재처리를 시작한다', async () => {
  const h = deploymentHarness(); const { io, queued } = guardedFlow(h);
  assert.equal((await executeMaintenanceApply(io)).status, 'verified');
  assert.deepEqual(h.calls, [{ kind: 'candidate', roles: ['api', 'worker'] }]);
  assert.deepEqual(queued, ['apply']); await h.guard.assertCandidate(); await h.guard.assertFinal();
});

test('Docker 응답 실패 뒤 실제 자기 candidate가 확인되면 그 컨테이너만 복구한다', async () => {
  const h = deploymentHarness();
  h.change(async (kind, roles, original) => { await original(kind, roles); if (kind === 'candidate') throw new Error('synthetic lost response'); });
  const { io, queued } = guardedFlow(h);
  assert.equal((await executeMaintenanceApply(io)).status, 'rolled_back');
  assert.deepEqual(h.calls, [{ kind: 'candidate', roles: ['api', 'worker'] }, { kind: 'rollback', roles: ['api', 'worker'] }]);
  assert.deepEqual(queued, []); assert.equal(h.guard.effectiveImage(), image('a'));
});

test('Docker 실패 뒤 실제 변경이 없으면 rollback 명령을 보내지 않는다', async () => {
  const h = deploymentHarness(); h.change(async () => { throw new Error('synthetic failure before change'); });
  assert.equal((await executeMaintenanceApply(guardedFlow(h).io)).status, 'held');
  assert.deepEqual(h.calls, [{ kind: 'candidate', roles: ['api', 'worker'] }]);
  assert.deepEqual(h.states(), h.baseline);
});

test('rollback 응답이 유실돼도 실제 복구 ID·라벨·health가 맞으면 한 번만 복구하고 완료를 인정한다', async () => {
  const h = deploymentHarness(); let healthyChecks = 0;
  h.change(async (kind, roles, original) => { await original(kind, roles); if (kind === 'rollback') throw new Error('synthetic lost rollback response'); });
  const { io, queued } = guardedFlow(h, { healthy: async () => ++healthyChecks > 1 && h.guard.healthy() });
  const result = await executeMaintenanceApply(io);
  assert.equal(result.status, 'rolled_back'); assert.equal(result.phase, 'deployment');
  assert.equal(h.calls.filter(call => call.kind === 'rollback').length, 1);
  assert.equal(h.states().every(state => state.image === image('a') && state.health === 'healthy'), true);
  assert.equal(h.guard.partialRollback(), false); await h.guard.assertFinal();
  assert.deepEqual(queued, []);
});

test('rollback와 직후 inspect 응답이 함께 유실돼도 새 읽기로 실제 복구를 검증하고 재명령하지 않는다', async () => {
  const h = deploymentHarness(); let healthyChecks = 0;
  h.change(async (kind, roles, original) => {
    await original(kind, roles);
    if (kind === 'rollback') { h.failReads(1); throw new Error('synthetic rollback and inspect response loss'); }
  });
  const result = await executeMaintenanceApply(guardedFlow(h, { healthy: async () => ++healthyChecks > 1 && h.guard.healthy() }).io);
  assert.equal(result.status, 'rolled_back'); assert.equal(h.calls.filter(call => call.kind === 'rollback').length, 1);
  await h.guard.assertFinal();
});

test('rollback CLI가 성공하고 직후 inspect만 유실돼도 새 검증으로 정상 복구를 확인한다', async () => {
  const h = deploymentHarness();
  h.change(async (kind, roles, original) => {
    await original(kind, roles); if (kind === 'rollback') h.failReads(1);
  });
  const result = await executeMaintenanceApply(guardedFlow(h, { healthy: async () => false }).io);
  assert.equal(result.status, 'rolled_back'); assert.equal(h.calls.filter(call => call.kind === 'rollback').length, 1);
  assert.equal(h.guard.partialRollback(), false); await h.guard.assertFinal();
});

test('실제 rollback 변경이 없거나 복구 health를 확인하지 못하면 재시도 없이 보류한다', async () => {
  for (const restore of [false, true]) {
    const h = deploymentHarness();
    h.change(async (kind, roles, original) => {
      if (kind === 'candidate') return original(kind, roles);
      if (restore) { await original(kind, roles); h.set(h.states().map(state => ({ ...state, health: 'unhealthy' }))); }
      throw new Error('synthetic rollback response loss');
    });
    const result = await executeMaintenanceApply(guardedFlow(h, { healthy: async () => false }).io);
    assert.equal(result.status, 'held'); assert.equal(result.phase, 'rollback_outcome_unknown');
    assert.equal(h.calls.filter(call => call.kind === 'rollback').length, 1);
  }
});

test('rollback 시도 전의 healthy candidate를 복구 성공으로 오인하지 않는다', async () => {
  const h = deploymentHarness(); await h.guard.deploy();
  assert.equal(await h.guard.healthy(), true);
  await assert.rejects(h.guard.assertRollback(), /maintenance_rollback_not_attempted/u);
  assert.equal(h.calls.filter(call => call.kind === 'rollback').length, 0);
});

test('rollback 직전 설정 충돌이면 candidate가 healthy여도 복구 완료로 바꾸지 않는다', async () => {
  const h = deploymentHarness();
  const { io } = guardedFlow(h, { healthy: async () => false,
    rollback: async () => { h.settingsChanged(); await h.guard.rollback(); } });
  const result = await executeMaintenanceApply(io);
  assert.equal(result.status, 'held'); assert.equal(result.phase, 'rollback_outcome_unknown');
  assert.equal(h.states().every(state => state.image === image('b') && state.health === 'healthy'), true);
  assert.equal(h.calls.filter(call => call.kind === 'rollback').length, 0);
});

test('복구 확인 뒤 같은 이미지·라벨의 컨테이너가 다시 바뀌면 다른 배포를 재학습하지 않는다', async () => {
  const h = deploymentHarness();
  h.change(async (kind, roles, original) => { await original(kind, roles); if (kind === 'rollback') throw new Error('synthetic lost response'); });
  const { io } = guardedFlow(h, { healthy: async () => false,
    verifyRollback: async () => { const current = h.states(); current[0].id = id('7'); h.set(current); await h.guard.assertRollback(); return h.guard.healthy(); } });
  const result = await executeMaintenanceApply(io);
  assert.equal(result.status, 'held'); assert.equal(result.phase, 'rollback_outcome_unknown');
  assert.equal(h.calls.filter(call => call.kind === 'rollback').length, 1);
});

test('부분 실패는 자기 API만 복구하고 그대로인 worker ID는 유지한다', async () => {
  const h = deploymentHarness();
  h.change(async (kind, roles, original) => {
    await original(kind, kind === 'candidate' ? ['api'] : roles);
    if (kind === 'candidate') throw new Error('synthetic partial change');
  });
  assert.equal((await executeMaintenanceApply(guardedFlow(h).io)).status, 'rolled_back');
  assert.deepEqual(h.calls[1], { kind: 'rollback', roles: ['api'] });
  assert.equal(h.states()[1].id, h.baseline[1].id); assert.deepEqual(h.guard.rollbackServices(), ['api']);
  assert.equal(h.guard.partialRollback(), true); await h.guard.assertFinal();
});

test('부분 rollback 응답 유실을 검증해도 설정 자동 승계 금지는 유지한다', async () => {
  const h = deploymentHarness();
  h.change(async (kind, roles, original) => {
    await original(kind, kind === 'candidate' ? ['api'] : roles);
    throw new Error('synthetic partial deployment/rollback response loss');
  });
  const { io, queued } = guardedFlow(h);
  assert.equal((await executeMaintenanceApply(io)).status, 'rolled_back');
  assert.deepEqual(h.calls.filter(call => call.kind === 'rollback'), [{ kind: 'rollback', roles: ['api'] }]);
  assert.equal(h.guard.partialRollback(), true); assert.equal(h.states()[1].id, h.baseline[1].id);
  await h.guard.assertFinal(); assert.deepEqual(queued, []);
});

test('자기 API와 다른 배포의 worker가 섞이면 어느 서비스도 복구로 덮지 않는다', async () => {
  const h = deploymentHarness();
  h.change(async (kind, roles, original) => {
    await original(kind, roles); const current = h.states(); current[1] = { ...current[1], id: id('7'), image: image('c'), files: '/synthetic/another-deploy.yml' }; h.set(current);
  });
  const { io, queued } = guardedFlow(h);
  assert.equal((await executeMaintenanceApply(io)).status, 'held');
  assert.equal(h.calls.length, 1); assert.deepEqual(queued, []); assert.equal(h.states()[1].image, image('c'));
});

test('이미지가 같아도 다른 override나 다시 생성된 ID는 자기 배포가 아니다', async () => {
  for (const field of ['files', 'id']) {
    const h = deploymentHarness(); await h.guard.deploy();
    const current = h.states(); current[0][field] = field === 'id' ? id('7') : '/synthetic/other-override.yml'; h.set(current);
    assert.equal(await h.guard.canRollback(), false); await assert.rejects(h.guard.rollback(), /maintenance_deployment_changed/u);
    assert.equal(h.calls.length, 1);
  }
});

test('rollback 허용 점검과 실제 호출 사이에도 실제 ID와 설정을 다시 확인한다', async () => {
  for (const changeSettings of [false, true]) {
    const h = deploymentHarness(); await h.guard.deploy(); assert.equal(await h.guard.canRollback(), true);
    if (changeSettings) h.settingsChanged();
    else { const current = h.states(); current[0].id = id('7'); h.set(current); }
    await assert.rejects(h.guard.rollback(), /maintenance_(deployment|settings)_changed/u);
    assert.equal(h.calls.length, 1);
  }
});

test('실제 상태를 읽을 수 없으면 소유권을 추정하지 않고 보류한다', async () => {
  const h = deploymentHarness(); h.change(async (kind, roles, original) => { await original(kind, roles); h.unreadable(); });
  const result = await executeMaintenanceApply(guardedFlow(h).io);
  assert.equal(result.status, 'held'); assert.equal(result.phase, 'deployment_ownership_unknown'); assert.equal(h.calls.length, 1);
});

test('재처리 직전과 최종 승계 직전의 상태 교체도 감지한다', async () => {
  const h = deploymentHarness(); await h.guard.deploy();
  const current = h.states(); current[1].id = id('7'); h.set(current);
  await assert.rejects(h.guard.assertCandidate(), /maintenance_deployment_changed/u);
  await assert.rejects(h.guard.assertFinal(), /maintenance_deployment_changed/u);
  assert.equal(h.calls.length, 1);
});

test('동일 호스트 parser lock은 중복 실행을 막고 정상 종료 뒤 자기 lock만 해제한다', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'parser-apply-lock-')); const file = join(folder, 'apply.lock');
  try {
    let nested = false;
    await withMaintenanceApplyLock(file, async () => {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      await assert.rejects(withMaintenanceApplyLock(file, async () => { nested = true; }), /maintenance_apply_lock_unavailable/u);
    });
    assert.equal(nested, false); assert.equal(existsSync(file), false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('기존 stale lock과 교체된 다른 소유 lock을 자동 삭제하지 않는다', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'parser-apply-lock-')); const file = join(folder, 'apply.lock');
  try {
    writeFileSync(file, '{"token":"stale"}', { mode: 0o600 });
    await assert.rejects(withMaintenanceApplyLock(file, async () => {}), /maintenance_apply_lock_unavailable/u);
    assert.equal(readFileSync(file, 'utf8'), '{"token":"stale"}'); unlinkSync(file);
    await assert.rejects(withMaintenanceApplyLock(file, async () => {
      unlinkSync(file); writeFileSync(file, '{"token":"other-owner"}', { mode: 0o600 });
    }), /maintenance_apply_lock_changed/u);
    assert.equal(readFileSync(file, 'utf8'), '{"token":"other-owner"}');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('작업이 실패해도 자기 lock은 해제하고 원래 오류를 전파한다', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'parser-apply-lock-')); const file = join(folder, 'apply.lock');
  try {
    const failure = new Error('synthetic operation failure');
    await assert.rejects(withMaintenanceApplyLock(file, async () => { throw failure; }), error => error === failure);
    assert.equal(existsSync(file), false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('health 실패는 이전 이미지 복구를 확인하고 큐를 보내지 않는다', async () => {
  let checks = 0; const { calls, io } = setup({ healthy: async () => ++checks > 1 });
  assert.equal((await executeMaintenanceApply(io)).status, 'rolled_back'); assert.deepEqual(calls, ['deploy', 'rollback']);
});
test('복구 결과를 확인할 수 없으면 정상이나 실패로 단정하지 않는다', async () => {
  const { io } = setup({ deploy: async () => { throw Error(); }, rollback: async () => { throw Error(); }, verifyRollback: async () => false });
  const result = await executeMaintenanceApply(io);
  assert.equal(result.status, 'held'); assert.equal(result.phase, 'rollback_outcome_unknown');
});
test('scope 대상 수가 다르면 재처리하지 않는다', async () => {
  const { calls, io } = setup({ plan: async () => ({ targets: 2 }) }); assert.equal((await executeMaintenanceApply(io)).phase, 'scope_plan'); assert.deepEqual(calls, ['deploy']);
});
test('큐 응답 유실 뒤 실제 결과가 맞으면 완료, 중복 전송은 없다', async () => {
  let sends = 0; const { io } = setup({ enqueue: async () => { sends += 1; throw Error(); } }); assert.equal((await executeMaintenanceApply(io)).status, 'verified'); assert.equal(sends, 1);
});
test('결과 불명과 미완료를 분리하며 거래를 되돌리지 않는다', async () => {
  for (const unknown of [false, true]) {
    let verifies = 0;
    const { calls, io } = setup({ enqueue: async () => { if (unknown) throw Error(); }, verify: async () => { verifies += 1; return { total: 1, verified: 0 }; } });
    assert.equal((await executeMaintenanceApply(io)).status, unknown ? 'repair_outcome_unknown' : 'repair_incomplete'); assert.equal(verifies, 15); assert.deepEqual(calls, ['deploy']);
  }
});
