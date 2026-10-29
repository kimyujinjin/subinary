#!/usr/bin/env node
/** 검증된 overlay와 본인 범위만 적용한다. 설정 enabled와 gate가 없으면 쓰기 전에 중단한다. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maintenanceHash } from './lib/parser-maintenance-core.mjs';
import { readMaintenanceConfig, updateMaintenanceConfig, assertMaintenanceSourceState, maintenanceCorpusHash } from './parser-maintenance.mjs';
import { validateSmsRepairScope } from './repair-sms-parsing.mjs';
import { executeMaintenanceApply } from './lib/parser-maintenance-apply-flow.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICES = ['family-memory-ai-api-1', 'family-memory-ai-worker-1'];
const delay = () => new Promise(resolve => setTimeout(resolve, 2000));
/** 실행 로그에는 환경/도구 원시 오류를 반환하지 않는다. */
function run(command, args, input) {
  try { return execFileSync(command, args, { cwd: ROOT, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 4 * 1024 * 1024 }).trim(); }
  catch { throw new Error('maintenance_apply_command_failed'); }
}
/** @param {string} path */
function read(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('maintenance_private_receipt_required');
  return JSON.parse(readFileSync(path, 'utf8'));
}
/** 실제 운영 적용. 테스트는 별도 순수 flow의 가짜 IO로만 실행한다. */
export async function applyMaintenance(directory) {
  const path = resolve(directory);
  if (dirname(path) !== join(ROOT, '.deploy-logs/parser-maintenance') || lstatSync(path).isSymbolicLink()) throw new Error('maintenance_invalid_run');
  const config = readMaintenanceConfig();
  if (config.applyEnabled !== true) throw new Error('maintenance_apply_not_enabled');
  const manifest = read(join(path, 'manifest.json')); const gate = read(join(path, 'gate.json'));
  const plan = read(join(path, 'deploy-plan.json')); const build = read(join(path, 'image-build.json'));
  const scope = validateSmsRepairScope(read(join(path, 'recovery-scope.json')));
  if (manifest.memberId !== config.memberId || manifest.householdId !== config.householdId || scope.memberId !== config.memberId || scope.householdId !== config.householdId
    || gate.verdict?.passed !== true || gate.scopeHash !== scope.digest || plan.scopeHash !== scope.digest
    || plan.gateHash !== maintenanceHash(gate) || plan.imageBuildHash !== maintenanceHash(build)
    || plan.protectedImageVerified !== true || plan.finalEsmCjsReplayVerified !== true
    || plan.candidateImage !== build.candidateImage || plan.baselineImage !== manifest.baselineImage
    || plan.candidateSourceHash !== gate.candidateSourceHash) throw new Error('maintenance_apply_receipt_mismatch');
  assertMaintenanceSourceState(manifest, gate);
  if (maintenanceCorpusHash(config.memberId, config.householdId) !== plan.corpusHash) throw new Error('maintenance_corpus_changed');
  const compose = config.compose;
  if (!compose || compose.project !== 'family-memory-ai' || !isAbsolute(compose.directory)
    || !Array.isArray(compose.files) || compose.files.length < 1 || compose.files.length > 10 || !compose.files.every(isAbsolute)
    || !Array.isArray(compose.envFiles) || compose.envFiles.length < 1 || compose.envFiles.length > 10 || !compose.envFiles.every(isAbsolute)) throw new Error('maintenance_compose_config_required');
  const configPaths = [...compose.files, ...compose.envFiles];
  const settingsHash = () => maintenanceHash(configPaths.map(file => [file, maintenanceHash(readFileSync(file, 'utf8'))]));
  const settings = settingsHash();
  let baseComposeFiles = [...compose.files];
  if (config.managedParserOverride) {
    const previous = config.managedParserOverride;
    const evidence = read(previous.receiptPath);
    if (previous.overridePath !== baseComposeFiles.at(-1) || previous.image !== manifest.baselineImage
      || evidence.effectiveImage !== manifest.baselineImage || !['verified', 'rolled_back'].includes(evidence.status)
      || maintenanceHash(evidence) !== previous.receiptHash
      || JSON.stringify(read(previous.overridePath)) !== JSON.stringify({ services: { api: { image: manifest.baselineImage }, worker: { image: manifest.baselineImage } } })) throw new Error('maintenance_previous_override_unverified');
    baseComposeFiles = baseComposeFiles.slice(0, -1);
  }
  for (const service of SERVICES) {
    const state = JSON.parse(run('docker', ['inspect', service]))[0];
    if (state.Image !== manifest.baselineImage || state.Config.Labels['com.docker.compose.project'] !== compose.project
      || state.Config.Labels['com.docker.compose.project.working_dir'] !== compose.directory
      || state.Config.Labels['com.docker.compose.project.config_files'] !== compose.files.join(',')
      || state.Config.Labels['com.docker.compose.project.environment_file'] !== compose.envFiles.join(',')) throw new Error('maintenance_compose_runtime_mismatch');
  }
  const actualBuild = JSON.parse(run('docker', ['image', 'inspect', plan.candidateImage]))[0];
  if (JSON.stringify(actualBuild.RootFS.Layers) !== JSON.stringify(build.candidateLayers)) throw new Error('maintenance_image_changed');
  const overrides = { candidate: join(path, 'candidate.compose.json'), rollback: join(path, 'rollback.compose.json') };
  for (const [kind, file] of Object.entries(overrides)) {
    const expected = kind === 'candidate' ? plan.candidateImage : plan.baselineImage;
    const override = read(file);
    if (JSON.stringify(override) !== JSON.stringify({ services: { api: { image: expected }, worker: { image: expected } } })) throw new Error('maintenance_compose_override_changed');
  }
  // flag wx는 결과 불명 또는 중복 요청의 재배포/재전송을 막는다. 삭제해서 재시도하지 않는다.
  writeFileSync(join(path, 'apply-started.json'), JSON.stringify({ startedAt: new Date().toISOString(), planHash: maintenanceHash(plan), settingsHash: settings }), { flag: 'wx', mode: 0o600 });
  const composeArgs = ['compose', '-p', compose.project, '--project-directory', compose.directory,
    ...compose.envFiles.flatMap(file => ['--env-file', file]), ...baseComposeFiles.flatMap(file => ['-f', file])];
  let expectedImage = plan.candidateImage;
  let pinnedWorkerId;
  const changeImage = async kind => {
    if (settingsHash() !== settings) throw new Error('maintenance_settings_changed');
    run('docker', [...composeArgs, '-f', overrides[kind], 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'worker']);
  };
  const healthy = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const states = SERVICES.map(service => JSON.parse(run('docker', ['inspect', service]))[0]);
        if (states.every(state => state.Image === expectedImage && state.State.Health?.Status === 'healthy')) {
          const response = await fetch('https://app.subinary.cloud/v1/health/live', { redirect: 'error', signal: AbortSignal.timeout(5000) });
          if (response.ok) { if (expectedImage === plan.candidateImage) pinnedWorkerId = states[1].Id; return true; }
        }
      } catch { /* 제한 시간 안에서만 health를 재확인한다. */ }
      await delay();
    }
    return false;
  };
  const repair = async command => {
    const worker = JSON.parse(run('docker', ['inspect', 'family-memory-ai-worker-1']))[0];
    if (!pinnedWorkerId || worker.Id !== pinnedWorkerId || worker.Image !== plan.candidateImage) throw new Error('maintenance_worker_replaced');
    const controller = build.copies.find(file => file.target === '/app/scripts/repair-sms-parsing.mjs');
    if (!controller) throw new Error('maintenance_repair_controller_missing');
    const script = `let text='';for await(const chunk of process.stdin) text+=chunk;const task=JSON.parse(text);const fs=await import('node:fs');const crypto=await import('node:crypto');for(const [file,hash] of Object.entries(task.hashes)){if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error('runtime_changed');}const tool=await import('/app/scripts/repair-sms-parsing.mjs');tool.validateSmsRepairScope(task.scope);const dir='/tmp/parser-maintenance-'+task.scope.digest;fs.mkdirSync(dir,{recursive:true,mode:448});const scopeFile=dir+'/scope.json';if(!fs.existsSync(scopeFile))fs.writeFileSync(scopeFile,JSON.stringify(task.scope),{flag:'wx',mode:384});else if(JSON.stringify(JSON.parse(fs.readFileSync(scopeFile,'utf8')))!==JSON.stringify(task.scope))throw Error('scope_changed');const args=[task.command,dir+'/plan.json','--scope-file='+scopeFile];if(task.command==='apply')args.push('--expected-count='+task.scope.entries.length);const result=await tool.runSmsRepairCli(args);process.stdout.write(JSON.stringify(result));`;
    const hashes = { '/app/scripts/repair-sms-parsing.mjs': controller.hash, '/app/packages/card-parsers/dist/index.mjs': gate.artifactHashes['index.mjs'], '/app/packages/card-parsers/dist/index.js': gate.artifactHashes['index.js'] };
    return JSON.parse(run('docker', ['exec', '-i', pinnedWorkerId, 'node', '--input-type=module', '-e', script], JSON.stringify({ command, scope, hashes })));
  };
  const result = await executeMaintenanceApply({
    deploy: async () => { assertMaintenanceSourceState(manifest, gate); await changeImage('candidate'); },
    healthy,
    rollback: async () => { expectedImage = plan.baselineImage; await changeImage('rollback'); },
    plan: async () => repair('plan'), enqueue: async () => repair('apply'), verify: async () => repair('verify'), wait: delay, targets: scope.entries.length,
  });
  const receipt = { ...result, completedAt: new Date().toISOString(), planHash: maintenanceHash(plan), scopeHash: scope.digest, effectiveImage: expectedImage };
  const receiptPath = join(path, 'apply-result.json');
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  if (result.status === 'verified' || result.status === 'rolled_back') {
    const overridePath = result.status === 'verified' ? overrides.candidate : overrides.rollback;
    const files = [...baseComposeFiles, overridePath];
    for (const service of SERVICES) {
      const state = JSON.parse(run('docker', ['inspect', service]))[0];
      if (state.Image !== expectedImage || state.Config.Labels['com.docker.compose.project.config_files'] !== files.join(',')) throw new Error('maintenance_config_successor_unverified');
    }
    updateMaintenanceConfig(config, { ...config, compose: { ...compose, files }, managedParserOverride: { overridePath, image: expectedImage, receiptPath, receiptHash: maintenanceHash(receipt) } });
  }
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { process.stderr.write('{"status":"held","code":"maintenance_arguments"}\n'); process.exitCode = 1; }
  else applyMaintenance(process.argv[2]).then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); if (result.status !== 'verified') process.exitCode = 1; }).catch(error => {
    const code = error instanceof Error && /^maintenance_[a-z_]+$/u.test(error.message) ? error.message : 'maintenance_apply_held';
    process.stderr.write(`${JSON.stringify({ status: 'held', code, notification: 'none' })}\n`); process.exitCode = 1;
  });
}
