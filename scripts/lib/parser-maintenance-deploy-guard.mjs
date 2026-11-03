import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const ROLES = ['api', 'worker'];
const IMAGE = /^sha256:[a-f0-9]{64}$/u;
const CONTAINER = /^[a-f0-9]{64}$/u;
const fingerprint = state => JSON.stringify([state?.id, state?.image, state?.service,
  state?.project, state?.directory, state?.files, state?.envFiles]);
const same = (left, right) => fingerprint(left) === fingerprint(right);

/** Preserve the existing Compose/env order and select only proven-owned roles. */
export function maintenanceComposeChangeArgs(compose, files, override, roles) {
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > ROLES.length
    || new Set(roles).size !== roles.length || roles.some(role => !ROLES.includes(role))) {
    throw new Error('maintenance_deployment_roles_invalid');
  }
  return ['compose', '-p', compose.project, '--project-directory', compose.directory,
    ...compose.envFiles.flatMap(file => ['--env-file', file]), ...files.flatMap(file => ['-f', file]),
    '-f', override, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', ...roles];
}

/**
 * Same-host parser applies share this lock across worktrees. A stale lock is not
 * removed automatically. Other deployment tools must cooperate to serialize too.
 */
export async function withMaintenanceApplyLock(file, operation) {
  const token = randomBytes(16).toString('hex');
  let descriptor;
  try { descriptor = openSync(file, 'wx', 0o600); }
  catch { throw new Error('maintenance_apply_lock_unavailable'); }
  const identity = fstatSync(descriptor);
  try {
    writeFileSync(descriptor, JSON.stringify({ version: 1, token, pid: process.pid, startedAt: new Date().toISOString() }));
  } finally { closeSync(descriptor); }
  try { return await operation(); }
  finally {
    // Do not remove a replacement lock created by another process/operator.
    const current = lstatSync(file);
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('maintenance_apply_lock_changed');
    const check = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(check);
      if (opened.dev !== identity.dev || opened.ino !== identity.ino
        || JSON.parse(readFileSync(check, 'utf8')).token !== token) throw new Error('maintenance_apply_lock_changed');
    } finally { closeSync(check); }
    unlinkSync(file);
  }
}

/**
 * Container IDs plus this run's unique Compose override path identify our writes.
 * Docker Compose has no atomic inspect-and-recreate CAS: an independent deployer
 * that does not share the lock can still race the final read and the command.
 *
 * Only allowlisted, non-secret metadata is accepted by this controller.
 */
export function createMaintenanceDeployment(io) {
  const baseline = normalise(io.baseline);
  const owned = new Map();
  let restored;
  let attempted = false;
  let rollbackRoles = [];
  let phase = 'candidate';
  let lastStates = baseline;
  const labelsMatch = (state, image, files) => state.image === image
    && state.project === io.compose.project && state.directory === io.compose.directory
    && state.files === files.join(',') && state.envFiles === io.compose.envFiles.join(',');
  if (!IMAGE.test(io.baselineImage) || !IMAGE.test(io.candidateImage) || io.baselineImage === io.candidateImage
    || !baseline.every(state => labelsMatch(state, io.baselineImage, io.compose.files))) {
    throw new Error('maintenance_compose_runtime_mismatch');
  }
  const states = async () => {
    try { lastStates = normalise(await io.readStates()); return lastStates; }
    catch (error) { lastStates = null; throw error; }
  };
  const observeCandidate = current => {
    if (!attempted) return;
    for (let index = 0; index < ROLES.length; index += 1) {
      const state = current[index];
      if (!owned.has(state.service) && state.id !== baseline[index].id
        && labelsMatch(state, io.candidateImage, io.candidateFiles)) owned.set(state.service, state);
    }
  };
  const candidateMatches = current => current.every(state => owned.has(state.service)
    && same(state, owned.get(state.service)));
  const rollbackPlan = current => {
    if (!attempted) return null;
    observeCandidate(current);
    const roles = [];
    for (let index = 0; index < ROLES.length; index += 1) {
      const state = current[index];
      if (same(state, baseline[index])) continue;
      if (!owned.has(state.service) || !same(state, owned.get(state.service))) return null;
      roles.push(state.service);
    }
    return roles.length ? roles : null;
  };
  const observeRollback = current => {
    if (!restored && current.every((state, index) => rollbackRoles.includes(state.service)
      ? labelsMatch(state, io.baselineImage, io.rollbackFiles) && state.id !== owned.get(state.service)?.id
      : same(state, baseline[index]))) restored = current;
  };
  return {
    async deploy() {
      await io.assertUnchanged();
      const current = await states();
      if (!current.every((state, index) => same(state, baseline[index]))) throw new Error('maintenance_deployment_changed');
      attempted = true;
      try { await io.changeImage('candidate', [...ROLES]); }
      finally {
        // A failed CLI response does not prove that Docker made no changes.
        try { observeCandidate(await states()); } catch { /* canRollback reads again before any write. */ }
      }
    },
    async canRollback() {
      await io.assertUnchanged();
      return rollbackPlan(await states()) !== null;
    },
    async rollback() {
      // Recheck immediately before Compose, even after canRollback succeeded.
      await io.assertUnchanged();
      const roles = rollbackPlan(await states());
      if (!roles) throw new Error('maintenance_deployment_changed');
      rollbackRoles = roles; phase = 'rollback';
      try { await io.changeImage('rollback', roles); }
      finally {
        try { observeRollback(await states()); } catch { /* healthy/final checks do not infer success. */ }
      }
    },
    async healthy() {
      const current = await states();
      const matches = phase === 'candidate' ? candidateMatches(current)
        : restored && current.every((state, index) => same(state, restored[index]));
      return Boolean(matches && current.every(state => state.health === 'healthy'));
    },
    async assertCandidate() {
      await io.assertUnchanged();
      if (phase !== 'candidate' || !candidateMatches(await states())) throw new Error('maintenance_deployment_changed');
    },
    async assertRollback() {
      await io.assertUnchanged();
      if (phase !== 'rollback' || rollbackRoles.length === 0) throw new Error('maintenance_rollback_not_attempted');
      const current = await states();
      // The immediate post-command read may also have lost its response. Only
      // the first matching identity can be recorded; later replacement IDs fail.
      observeRollback(current);
      if (!restored || !current.every((state, index) => same(state, restored[index]))) throw new Error('maintenance_deployment_changed');
    },
    async assertFinal() {
      await io.assertUnchanged();
      const current = await states();
      const matches = phase === 'candidate' ? candidateMatches(current)
        : restored && current.every((state, index) => same(state, restored[index]));
      if (!matches) throw new Error('maintenance_deployment_changed');
    },
    candidateWorkerId() { return owned.get('worker')?.id; },
    rollbackServices() { return [...rollbackRoles]; },
    partialRollback() { return rollbackRoles.length > 0 && rollbackRoles.length < ROLES.length; },
    effectiveImage() { return lastStates && lastStates.every(state => state.image === lastStates[0].image) ? lastStates[0].image : null; },
  };
}

function normalise(value) {
  if (!Array.isArray(value) || value.length !== ROLES.length) throw new Error('maintenance_runtime_unknown');
  const ordered = ROLES.map(role => value.find(state => state?.service === role));
  if (ordered.some(state => !state || !CONTAINER.test(state.id) || !IMAGE.test(state.image)
    || ['project', 'directory', 'files', 'envFiles'].some(key => typeof state[key] !== 'string'))) {
    throw new Error('maintenance_runtime_unknown');
  }
  return ordered.map(({ id, image, service, project, directory, files, envFiles, health }) => ({ id, image, service, project, directory, files, envFiles, health }));
}
