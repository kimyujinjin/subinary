import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluateMaintenanceGate } from './lib/parser-maintenance-core.mjs';
import { replay, isolatedCommand } from './parser-maintenance.mjs';

const enabled = process.env.PARSER_MAINTENANCE_DOCKER_TEST === '1';
test('실제 격리 컨테이너에서 합성 원문 재생과 잘못된 후보 차단', { skip: !enabled }, () => {
  const image = execFileSync('docker', ['inspect', '--format', '{{.Image}}', 'family-memory-ai-worker-1'], { encoding: 'utf8' }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'fma-parser-test-'));
  const candidate = join(dir, 'candidate.mjs');
  writeFileSync(candidate, `import * as base from '/app/packages/card-parsers/dist/index.mjs';\nexport function parseCardSms(input, options) { const old=base.parseCardSms(input,options); return {...old, amount: (old.amount ?? 0)+1}; }\n`);
  const rows = [{ id: 'synthetic-one', status: 'parsed', sender: '15888700', content: '[Web발신]\n삼성카드 승인 (7777)\n예시님 12,345원 일시불\n01/02 03:04 예시상점', receivedAt: '2026-01-02T00:05:00.000Z' }];
  const run = changed => replay(image, rows, changed ? candidate : undefined);
  try {
    const baseline = run(false); assert.equal(baseline[0].changed, false); assert.equal(baseline[0].safeRecovery, true);
    const mutated = run(true); assert.equal(mutated[0].changed, true); assert.equal(mutated[0].safeRecovery, false);
    assert.equal(evaluateMaintenanceGate(mutated).passed, false);
    writeFileSync(candidate, `import * as base from '/app/packages/card-parsers/dist/index.mjs';\nexport function parseCardSms(input, options) { input.content=input.content.replace('12,345','98,765'); return base.parseCardSms(input,options); }\n`);
    const inputMutation = run(true); assert.equal(inputMutation[0].safeRecovery, false);
    assert.equal(evaluateMaintenanceGate(inputMutation).passed, false);
    writeFileSync(candidate, `import * as base from '/app/packages/card-parsers/dist/index.mjs';\nexport function parseCardSms(input, options) { return {...base.parseCardSms(input,options), nonTransactionReason:'savings_transfer'}; }\n`);
    assert.equal(run(true)[0].safeRecovery, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('fixture 실행 컨테이너의 자식 프로세스/산출물은 새 배포 빌드로 넘어가지 않는다', { skip: !enabled, timeout: 120000 }, () => {
  const image = execFileSync('docker', ['inspect', '--format', '{{.Image}}', 'family-memory-ai-worker-1'], { encoding: 'utf8' }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'fma-parser-build-isolation-'));
  const fixture = join(dir, 'maintenance-012345678abc.test.ts');
  const marker = 'SYNTHETIC_FIXTURE_POISON_DO_NOT_SHIP';
  // 격리 테스트 컨테이너의 map만 오염한다. 네트워크/호스트 쓰기는 허용되지 않는다.
  writeFileSync(fixture, `import {test,expect} from 'vitest';import {spawn} from 'node:child_process';\ntest('합성 자식 프로세스',()=>{const child=spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('node:fs');setInterval(()=>{try{fs.writeFileSync('/app/packages/card-parsers/dist/index.mjs.map',JSON.stringify({marker:${JSON.stringify(marker)}}))}catch{}},10);`)}],{detached:true,stdio:'ignore'});child.unref();expect(true).toBe(true);});\n`);
  try {
    const checks = isolatedCommand(image, 'parser-maintenance-build.mjs', {}, [[fixture, '/app/packages/card-parsers/src/fixtures/maintenance-012345678abc.test.ts']], true);
    assert.equal(checks.checks.length, 5); assert.equal(Object.hasOwn(checks, 'artifacts'), false);
    const artifact = isolatedCommand(image, 'parser-maintenance-build.mjs', {}, [[resolve('packages/card-parsers/src/parsers/generic.parser.ts'), '/app/packages/card-parsers/src/parsers/generic.parser.ts']], true, 'artifact');
    assert.equal(artifact.checks.length, 1);
    assert.ok(artifact.artifacts.some(file => file.name === 'index.mjs.map'));
    assert.ok(artifact.artifacts.every(file => !Buffer.from(file.base64, 'base64').toString('utf8').includes(marker)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
