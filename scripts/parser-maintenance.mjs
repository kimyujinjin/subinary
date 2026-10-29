#!/usr/bin/env node
/**
 * Dot용 파서 개선 준비/회귀 게이트. 운영 DB 쓰기·배포·모델 호출·알림은 수행하지 않는다.
 * prepare → 합성 fixture → routing 리터럴 보정 → gate → build-image → plan-deploy
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, lstatSync, readdirSync, copyFileSync, renameSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { maintenanceHash, maintenanceSourceHash, syntheticSms, maintenanceSuspicious, allowedParserChanges, evaluateMaintenanceGate, validateCandidateResults } from './lib/parser-maintenance-core.mjs';
import { assertDataOnlyParserChange } from './lib/parser-maintenance-source-guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.deploy-logs/parser-maintenance');
const WORKER = 'family-memory-ai-worker-1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const LIB = join(ROOT, 'scripts/lib');
const CONFIG = join(homedir(), '.config/family-memory-ai/parser-maintenance.json');
/** 본인 범위는 사용자 전용 로컬 설정에서 읽고 출력하지 않는다. */
export function readMaintenanceConfig() {
  const stat = lstatSync(CONFIG);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error('maintenance_private_config_required');
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  if (config.version !== 1 || !UUID.test(config.memberId) || !UUID.test(config.householdId)) throw new Error('maintenance_invalid_config');
  return config;
}
/** 운영 검증으로 증명한 image-only override만 다음 실행 설정으로 원자적 승계한다. */
export function updateMaintenanceConfig(expected, next) {
  if (maintenanceHash(readMaintenanceConfig()) !== maintenanceHash(expected)) throw new Error('maintenance_config_changed');
  const temporary = `${CONFIG}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, CONFIG);
}
/** @param {string} command @param {string[]} args @param {string | undefined} input */
function run(command, args, input) {
  try { return execFileSync(command, args, { cwd: ROOT, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 120000 }).trim(); }
  catch { throw new Error('maintenance_command_failed'); }
}
/** @param {string[]} args */
function git(args) { return run('git', args); }
/** @param {string} path @param {unknown} value */
function save(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
/** @param {string} member */
function collect(member, household) {
  if (!UUID.test(member) || !UUID.test(household)) throw new Error('maintenance_scope_required');
  const rows = JSON.parse(run('docker', ['exec', '-i', '-e', `PARSER_MAINTENANCE_MEMBER_ID=${member}`, '-e', `PARSER_MAINTENANCE_HOUSEHOLD_ID=${household}`, WORKER, 'node', '--input-type=module', '-'], readFileSync(join(LIB, 'parser-maintenance-read.mjs'), 'utf8')));
  if (!Array.isArray(rows) || rows.length > 10000 || rows.some(row => !UUID.test(row.id) || typeof row.content !== 'string' || typeof row.sender !== 'string' || Number.isNaN(Date.parse(row.receivedAt)))) throw new Error('maintenance_invalid_source');
  return rows;
}
/** 적용 직전 전수 입력이 최종 이미지 검증 때와 같은지 확인한다. 원문은 반환하지 않는다. */
export function maintenanceCorpusHash(member, household) { return maintenanceHash(collect(member, household)); }
/** 이미지 태그가 바뀌어도 같은 baseline을 쓴다. @returns {string} */
function imageId() {
  const value = run('docker', ['inspect', '--format', '{{.Image}}', WORKER]);
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error('maintenance_invalid_image');
  if (run('docker', ['inspect', '--format', '{{.Image}}', 'family-memory-ai-api-1']) !== value) throw new Error('maintenance_api_worker_image_mismatch');
  return value;
}
/** git diff의 파일명만 사용하며 삭제·이름변경·symlink는 거부한다. */
function changes() {
  if (git(['diff', '--name-only', '--diff-filter=DR']) || git(['diff', '--cached', '--name-only'])) throw new Error('maintenance_unsupported_git_state');
  const paths = [...new Set([...git(['diff', '--name-only']).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')].filter(Boolean))];
  if (!allowedParserChanges(paths) || paths.some(path => !lstatSync(join(ROOT, path)).isFile() || lstatSync(join(ROOT, path)).isSymbolicLink())) throw new Error('maintenance_scope_violation');
  const tracked = new Set(git(['ls-files']).split('\n'));
  if (paths.some(path => path !== 'packages/card-parsers/src/parsers/generic.parser.ts' && tracked.has(path))) throw new Error('maintenance_existing_fixture_protected');
  const parser = 'packages/card-parsers/src/parsers/generic.parser.ts';
  assertDataOnlyParserChange(git(['show', `HEAD:${parser}`]), readFileSync(join(ROOT, parser), 'utf8'));
  return paths.sort();
}
/** @param {string[]} paths */
function sourceHash(paths) { return maintenanceHash(paths.map(path => [path, maintenanceHash(readFileSync(join(ROOT, path), 'utf8'))])); }
/** 적용 직전에도 후보 경로·내용·기준 커밋이 바뀌지 않았는지 재검증한다. */
export function assertMaintenanceSourceState(manifest, gate) {
  if (git(['rev-parse', 'HEAD']) !== manifest.baselineCommit || sourceHash(changes()) !== gate.candidateSourceHash) throw new Error('maintenance_candidate_changed');
}
/** @param {string} dir */
function manifestAt(dir) {
  const path = resolve(dir);
  if (dirname(path) !== STATE || lstatSync(path).isSymbolicLink()) throw new Error('maintenance_invalid_run');
  const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !UUID.test(manifest.memberId) || !UUID.test(manifest.householdId) || !/^[a-f0-9]{40}$/u.test(manifest.baselineCommit) || !/^sha256:[a-f0-9]{64}$/u.test(manifest.baselineImage)) throw new Error('maintenance_invalid_manifest');
  return { path, manifest };
}

/**
 * 후보는 DB·인증정보가 없는 임시 컨테이너에서 평가한다. 원문은 stdin·부모 메모리에만 둔다.
 * @param {string} image @param {unknown[]} rows @param {string | undefined} candidateBundle
 */
export function isolatedCommand(image, script, payload, mounts = [], writable = false, mode) {
  const name = `fma-parser-replay-${randomBytes(6).toString('hex')}`;
  const args = ['run', '--rm', '-i', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', writable ? '2g' : '256m', '--cpus', '2', '--pids-limit', '128', '--user', '0:0', '--entrypoint', 'node',
    '--tmpfs', '/app/.deploy-logs:ro,size=1m', '--tmpfs', '/tmp:rw,exec,size=256m',
    '--mount', `type=bind,src=${join(LIB, script)},dst=/runner.mjs,readonly`];
  if (writable) {
    for (const path of ['/app/packages/card-parsers/dist', '/app/packages/card-parsers/node_modules/.vite', '/app/packages/card-parsers/node_modules/.vite-temp', '/app/apps/worker/node_modules/.vite', '/app/apps/worker/node_modules/.vite-temp', '/app/node_modules/.vite-temp']) args.push('--tmpfs', `${path}:rw,exec,size=128m`);
  }
  for (const [source, target] of mounts) args.push('--mount', `type=bind,src=${source},dst=${target},readonly`);
  args.push(image, '/runner.mjs', ...(mode ? [mode] : []));
  try { return JSON.parse(run('docker', args, JSON.stringify(payload))); }
  finally { try { run('docker', ['rm', '-f', name]); } catch { /* --rm으로 이미 제거된 정상 컨테이너도 이 경로를 거친다. */ } }
}

/** 후보 실행과 신뢰 판정의 프로세스·전역 객체·입력을 분리한다. */
export function replay(image, rows, candidateBundle) {
  const cjs = candidateBundle?.endsWith('.js');
  const candidates = candidateBundle ? isolatedCommand(image, 'parser-maintenance-replay.mjs', { rows }, [[candidateBundle, `/app/packages/card-parsers/dist/candidate.${cjs ? 'js' : 'mjs'}`]], false, cjs ? 'candidate-cjs' : 'candidate') : undefined;
  if (candidateBundle) validateCandidateResults(candidates, rows.length);
  return isolatedCommand(image, 'parser-maintenance-replay.mjs', { rows, candidates });
}

/** @param {string[]} args @returns {Promise<Record<string, unknown>>} */
export async function runMaintenance(args) {
  const [command, option] = args;
  if (command === 'prepare') {
    if (args.length === 1) {
      const config = readMaintenanceConfig();
      return runMaintenance(['prepare', `--member-id=${config.memberId}`, `--household-id=${config.householdId}`]);
    }
    if (args.length !== 3 || !option?.startsWith('--member-id=') || !args[2]?.startsWith('--household-id=')) throw new Error('maintenance_arguments');
    if (git(['status', '--porcelain'])) throw new Error('maintenance_clean_baseline_required');
    const memberId = option.slice('--member-id='.length);
    const householdId = args[2].slice('--household-id='.length);
    const baselineCommit = git(['rev-parse', 'HEAD']);
    const baselineImage = imageId();
    // 운영 이미지의 파서 소스와 lockfile이 현재 clean 기준과 같아야 한다.
    const parserPaths = git(['ls-files', 'packages/card-parsers/src', 'pnpm-lock.yaml']).split('\n');
    for (const path of parserPaths) {
      const actual = run('docker', ['exec', WORKER, 'node', '-e', 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))', `/app/${path}`]);
      if (actual !== maintenanceHash(readFileSync(join(ROOT, path), 'utf8'))) throw new Error('maintenance_baseline_source_mismatch');
    }
    const rows = collect(memberId, householdId);
    const failures = rows.filter(row => row.status === 'parse_failed' && row.memberId === memberId);
    const groups = new Map();
    let held = 0;
    for (const row of failures) {
      const content = syntheticSms(row.content);
      if (content === null) { held += 1; continue; }
      const fingerprint = maintenanceHash(content);
      const group = groups.get(fingerprint);
      if (group) { group.count += 1; continue; }
      groups.set(fingerprint, { fingerprint, count: 1, input: { sender: '00000000', content, receivedAt: '2026-01-02T00:05:00.000Z' }, expected: null, label: 'synthetic_structure_only_not_ground_truth' });
    }
    if (groups.size === 0) return { status: 'idle', failures: failures.length, held, notification: 'none' };
    mkdirSync(STATE, { recursive: true, mode: 0o700 });
    // 같은 기준/양식은 한 번만 시도한다. 문자 재수신이나 스케줄 반복으로 재시도하지 않는다.
    const runId = maintenanceHash([baselineCommit, baselineImage, memberId, householdId, [...groups.keys()].sort()]);
    const path = join(STATE, runId);
    try {
      if (lstatSync(path).isDirectory()) return { status: 'already_prepared_no_automatic_retry', runDirectory: path, notification: 'none' };
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    mkdirSync(path, { mode: 0o700 });
    const manifest = { version: 1, createdAt: new Date().toISOString(), memberId, householdId, baselineCommit, baselineImage, corpusHash: maintenanceHash(rows),
      rowHashes: rows.map(row => [maintenanceHash(row.id), maintenanceHash(row)]), total: rows.length, sourceHash: sourceHash(parserPaths), fixtureHash: maintenanceHash([...groups.values()]) };
    save(join(path, 'manifest.json'), manifest);
    save(join(path, 'fixtures.json'), [...groups.values()]);
    return { status: 'prepared', runDirectory: path, fixtures: groups.size, held, notification: 'none' };
  }
  if (command === 'gate') {
    if (args.length !== 2) throw new Error('maintenance_arguments');
    const { path, manifest } = manifestAt(option);
    if (readdirSync(path).includes('gate.json')) throw new Error('maintenance_already_tested_no_automatic_retry');
    if (git(['rev-parse', 'HEAD']) !== manifest.baselineCommit || imageId() !== manifest.baselineImage) throw new Error('maintenance_baseline_changed');
    const paths = changes();
    const candidateSourceHash = sourceHash(paths);
    // 새로 추가된 문자도 전수 재생한다. 기존 원본이 바뀌거나 사라졌다면 보류한다.
    const rows = collect(manifest.memberId, manifest.householdId);
    const currentRows = new Map(rows.map(row => [maintenanceHash(row.id), maintenanceHash(row)]));
    if (!Array.isArray(manifest.rowHashes) || manifest.rowHashes.some(([id, hash]) => currentRows.get(id) !== hash)) throw new Error('maintenance_corpus_changed');
    if (maintenanceHash(JSON.parse(readFileSync(join(path, 'fixtures.json'), 'utf8'))) !== manifest.fixtureHash) throw new Error('maintenance_fixtures_changed');
    // 테스트 출력에는 합성 fixture만 허용한다. 실패 stdout도 상위 오류로 전달하지 않는다.
    try {
      const checks = isolatedCommand(manifest.baselineImage, 'parser-maintenance-build.mjs', {}, paths.map(file => [join(ROOT, file), `/app/${file}`]), true);
      if (!Array.isArray(checks.checks) || checks.checks.length !== 5 || Object.hasOwn(checks, 'artifacts')) throw new Error('maintenance_invalid_test_receipt');
      // 테스트의 자식 프로세스/쓰기 가능한 dist를 통째로 버린 뒤 새 baseline에서 배포물을 만든다.
      const parserSource = 'packages/card-parsers/src/parsers/generic.parser.ts';
      const build = isolatedCommand(manifest.baselineImage, 'parser-maintenance-build.mjs', {}, [[join(ROOT, parserSource), `/app/${parserSource}`]], true, 'artifact');
      if (!Array.isArray(build.checks) || build.checks.length !== 1 || !Array.isArray(build.artifacts) || build.artifacts.length > 8
        || !['index.mjs', 'index.js'].every(name => build.artifacts.some(file => file.name === name))
        || build.artifacts.some(file => !/^index\.(?:mjs|js|d\.ts|d\.mts)(?:\.map)?$/u.test(file.name) || typeof file.base64 !== 'string' || file.base64.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/u.test(file.base64))) throw new Error('maintenance_invalid_build');
      const artifactDir = join(path, 'artifacts');
      mkdirSync(artifactDir, { mode: 0o700 });
      const artifactHashes = {};
      for (const file of build.artifacts) {
        writeFileSync(join(artifactDir, file.name), Buffer.from(file.base64, 'base64'), { flag: 'wx', mode: 0o600 });
        artifactHashes[file.name] = maintenanceHash(readFileSync(join(artifactDir, file.name), 'utf8'));
      }
      const candidateBundle = join(artifactDir, 'index.mjs');
      const bundleHash = maintenanceHash(readFileSync(candidateBundle, 'utf8'));
      const baseline = replay(manifest.baselineImage, rows);
      const candidate = replay(manifest.baselineImage, rows, candidateBundle);
      if (baseline.length !== rows.length || candidate.length !== rows.length || baseline.some((value, index) => value.baseline !== candidate[index]?.baseline || value.id !== candidate[index]?.id)) throw new Error('maintenance_baseline_replay_changed');
      // 입력 차단은 baseline 판정과도 독립이다. 링크 등을 성공으로 바꾸는 변경은 막는다.
      candidate.forEach((value, index) => {
        value.suspicious ||= maintenanceSuspicious(rows[index].content);
        // 다른 구성원은 모든 기존 해석이 보존되어야 한다. 새 복구/write는 본인만 허용한다.
        if (rows[index].memberId !== manifest.memberId) value.safeRecovery = false;
      });
      const verdict = evaluateMaintenanceGate(candidate);
      if (verdict.recoverable > 100) { verdict.passed = false; verdict.reasons.push('recovery_batch_limit'); }
      if (sourceHash(changes()) !== candidateSourceHash || maintenanceHash(readFileSync(candidateBundle, 'utf8')) !== bundleHash || imageId() !== manifest.baselineImage) throw new Error('maintenance_candidate_changed');
      const scope = { version: 'parser-maintenance-scope-v1', memberId: manifest.memberId, householdId: manifest.householdId,
        entries: candidate.flatMap((value, index) => value.changed && value.safeRecovery && value.newlyResolved
          ? [{ id: rows[index].id, snapshotHash: maintenanceSourceHash(rows[index]) }] : []) };
      const receipt = { version: 1, checkedAt: new Date().toISOString(), baselineCommit: manifest.baselineCommit, baselineImage: manifest.baselineImage,
        corpusHash: maintenanceHash(rows), replayHash: maintenanceHash(candidate), candidateSourceHash, candidateBundleHash: bundleHash, artifactHashes, changedPaths: paths, verdict,
        scopeHash: verdict.passed ? maintenanceHash(scope) : null,
        status: verdict.passed ? 'parser_gate_passed_deployment_not_performed' : 'held', productionWrites: 0, notification: 'none' };
      save(join(path, 'gate.json'), receipt);
      if (verdict.passed) {
        save(join(path, 'recovery-scope.json'), { ...scope, digest: maintenanceHash(scope) });
      }
      return receipt;
    } catch (error) {
      if (!readdirSync(path).includes('gate.json')) save(join(path, 'gate.json'), { version: 1, status: 'held', reason: 'validation_failed', candidateSourceHash, notification: 'none', productionWrites: 0 });
      throw error;
    }
  }
  if (command === 'build-image') {
    if (args.length !== 2) throw new Error('maintenance_arguments');
    const { path, manifest } = manifestAt(option);
    const gate = JSON.parse(readFileSync(join(path, 'gate.json'), 'utf8'));
    if (gate.status !== 'parser_gate_passed_deployment_not_performed' || gate.verdict?.passed !== true
      || git(['rev-parse', 'HEAD']) !== manifest.baselineCommit || imageId() !== manifest.baselineImage
      || sourceHash(changes()) !== gate.candidateSourceHash) throw new Error('maintenance_gate_not_current');
    const context = join(path, 'image-context');
    mkdirSync(context, { mode: 0o700 });
    const copied = [];
    for (const [name, hash] of Object.entries(gate.artifactHashes ?? {})) {
      if (!/^index\.(?:mjs|js|d\.ts|d\.mts)(?:\.map)?$/u.test(name) || maintenanceHash(readFileSync(join(path, 'artifacts', name), 'utf8')) !== hash) throw new Error('maintenance_artifact_changed');
      copied.push({ source: name, target: `/app/packages/card-parsers/dist/${name}`, hash });
      copyFileSync(join(path, 'artifacts', name), join(context, name));
    }
    for (const [index, file] of gate.changedPaths.entries()) {
      const name = `source-${index}.txt`;
      copied.push({ source: name, target: `/app/${file}`, hash: maintenanceHash(readFileSync(join(ROOT, file), 'utf8')) });
      copyFileSync(join(ROOT, file), join(context, name));
    }
    // 일회 설치된 고정 재처리 제어기는 후보가 수정할 수 없다. 새 scope 옵션을 운영 이미지에도 둔다.
    const repairTool = 'scripts/repair-sms-parsing.mjs';
    if (git(['diff', '--', repairTool])) throw new Error('maintenance_repair_controller_changed');
    copied.push({ source: 'repair-controller.mjs', target: `/app/${repairTool}`, hash: maintenanceHash(readFileSync(join(ROOT, repairTool), 'utf8')) });
    copyFileSync(join(ROOT, repairTool), join(context, 'repair-controller.mjs'));
    // BuildKit의 FROM은 image ID 문자열을 저장소 이름으로 해석하므로 전용 로컬 태그를 쓴다.
    // 이후 실제 layer prefix를 불변 baseline ID와 대조하므로 태그만 신뢰하지 않는다.
    const baselineTag = `family-memory-ai/parser-baseline:${manifest.baselineImage.slice(7)}`;
    let tagged;
    try { tagged = run('docker', ['image', 'inspect', '--format', '{{.Id}}', baselineTag]); } catch { /* 아직 없는 전용 로컬 태그 */ }
    if (tagged && tagged !== manifest.baselineImage) throw new Error('maintenance_baseline_tag_changed');
    if (!tagged) run('docker', ['image', 'tag', manifest.baselineImage, baselineTag]);
    const dockerfile = `FROM ${baselineTag}\n${copied.map(file => `COPY ${file.source} ${file.target}`).join('\n')}\n`;
    writeFileSync(join(context, 'Dockerfile'), dockerfile, { flag: 'wx', mode: 0o600 });
    const iid = join(path, 'image-id.txt');
    writeFileSync(iid, '', { flag: 'wx', mode: 0o600 });
    run('docker', ['build', '--network', 'none', '--pull=false', '--iidfile', iid, context]);
    const candidateImage = readFileSync(iid, 'utf8').trim();
    if (!/^sha256:[a-f0-9]{64}$/u.test(candidateImage)) throw new Error('maintenance_invalid_image');
    const inspect = id => JSON.parse(run('docker', ['image', 'inspect', id]))[0];
    const old = inspect(manifest.baselineImage); const next = inspect(candidateImage);
    if (old.RootFS.Layers.some((hash, index) => next.RootFS.Layers[index] !== hash)
      || next.RootFS.Layers.length !== old.RootFS.Layers.length + copied.length
      || JSON.stringify(old.Config) !== JSON.stringify(next.Config)) throw new Error('maintenance_image_scope_mismatch');
    if (sourceHash(changes()) !== gate.candidateSourceHash || imageId() !== manifest.baselineImage) throw new Error('maintenance_candidate_changed');
    const receipt = { version: 1, baselineImage: manifest.baselineImage, candidateImage, candidateSourceHash: gate.candidateSourceHash,
      artifactHashes: gate.artifactHashes, dockerfileHash: maintenanceHash(dockerfile), copies: copied,
      baselineLayers: old.RootFS.Layers, candidateLayers: next.RootFS.Layers, status: 'overlay_built_not_deployed' };
    save(join(path, 'image-build.json'), receipt);
    return { status: receipt.status, candidateImage, productionWrites: 0, notification: 'none' };
  }
  if (command === 'plan-deploy') {
    if (args.length !== 3 || !args[2]?.startsWith('--candidate-image=')) throw new Error('maintenance_arguments');
    const candidateImage = args[2].slice('--candidate-image='.length);
    if (!/^sha256:[a-f0-9]{64}$/u.test(candidateImage)) throw new Error('maintenance_immutable_image_required');
    const { path, manifest } = manifestAt(option);
    const gate = JSON.parse(readFileSync(join(path, 'gate.json'), 'utf8'));
    const built = JSON.parse(readFileSync(join(path, 'image-build.json'), 'utf8'));
    if (gate.status !== 'parser_gate_passed_deployment_not_performed' || gate.verdict?.passed !== true
      || gate.baselineCommit !== manifest.baselineCommit || gate.baselineImage !== manifest.baselineImage
      || git(['rev-parse', 'HEAD']) !== manifest.baselineCommit || imageId() !== manifest.baselineImage
      || sourceHash(changes()) !== gate.candidateSourceHash || built.candidateImage !== candidateImage
      || built.baselineImage !== manifest.baselineImage || built.candidateSourceHash !== gate.candidateSourceHash
      || JSON.stringify(built.artifactHashes) !== JSON.stringify(gate.artifactHashes)) throw new Error('maintenance_gate_not_current');
    const bundleHash = run('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', candidateImage, '-e',
      'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync("/app/packages/card-parsers/dist/index.mjs")).digest("hex"))']);
    if (bundleHash !== gate.candidateBundleHash) throw new Error('maintenance_image_bundle_mismatch');
    const rows = collect(manifest.memberId, manifest.householdId);
    if (maintenanceHash(rows) !== gate.corpusHash) throw new Error('maintenance_corpus_changed');
    // 최종 이미지의 ESM/CJS를 각각 꺼내 신뢰 baseline과 별도 프로세스에서 비교한다.
    for (const name of ['index.mjs', 'index.js']) {
      const source = run('docker', ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', candidateImage, '-e', `process.stdout.write(require('node:fs').readFileSync('/app/packages/card-parsers/dist/${name}').toString('base64'))`]);
      const file = join(path, `final-${name}`);
      writeFileSync(file, Buffer.from(source, 'base64'), { flag: 'wx', mode: 0o600 });
      if (maintenanceHash(readFileSync(file, 'utf8')) !== gate.artifactHashes[name]) throw new Error('maintenance_image_bundle_mismatch');
      const evaluated = replay(manifest.baselineImage, rows, file);
      evaluated.forEach((value, index) => { value.suspicious ||= maintenanceSuspicious(rows[index].content); if (rows[index].memberId !== manifest.memberId) value.safeRecovery = false; });
      const verdict = evaluateMaintenanceGate(evaluated);
      if (!verdict.passed || verdict.recoverable !== gate.verdict.recoverable || verdict.blocked !== 0
        || maintenanceHash(evaluated) !== gate.replayHash) throw new Error('maintenance_final_replay_failed');
    }
    // 계획은 검증한 정확한 이미지 ID를 지정한다. 실행과 DB 재처리는 이 명령의 기능이 아니다.
    const plan = { version: 1, createdAt: new Date().toISOString(), gateHash: maintenanceHash(gate), baselineImage: manifest.baselineImage, candidateImage,
      candidateSourceHash: gate.candidateSourceHash, candidateBundleHash: bundleHash, corpusHash: gate.corpusHash,
      services: ['api', 'worker'], imageBuildHash: maintenanceHash(built), scopeHash: gate.scopeHash,
      protectedImageVerified: true, finalEsmCjsReplayVerified: true,
      status: 'deployment_plan_not_executed', notification: 'none', productionWrites: 0 };
    save(join(path, 'deploy-plan.json'), plan);
    writeFileSync(join(path, 'candidate.compose.json'), JSON.stringify({ services: { api: { image: candidateImage }, worker: { image: candidateImage } } }, null, 2), { flag: 'wx', mode: 0o600 });
    writeFileSync(join(path, 'rollback.compose.json'), JSON.stringify({ services: { api: { image: manifest.baselineImage }, worker: { image: manifest.baselineImage } } }, null, 2), { flag: 'wx', mode: 0o600 });
    return plan;
  }
  throw new Error('maintenance_arguments');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMaintenance(process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    const code = error instanceof Error && /^maintenance_[a-z_]+$/u.test(error.message) ? error.message : 'maintenance_failed';
    process.stderr.write(`${JSON.stringify({ status: 'held', code, notification: 'none', productionWrites: 0 })}\n`);
    process.exitCode = 1;
  });
}
