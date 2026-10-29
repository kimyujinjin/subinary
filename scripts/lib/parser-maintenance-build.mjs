// 테스트 컨테이너와 artifact 전용 컨테이너는 별도 호출·수명으로 분리한다.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
const artifactOnly = process.argv[2] === 'artifact';
const build = ['--filter', '@family/card-parsers', 'exec', 'tsup', 'src/index.ts', '--no-config', '--format', 'esm,cjs', '--dts', '--sourcemap', '--clean', '--out-dir', 'dist'];
const commands = artifactOnly ? [build] : [
  ['--filter', '@family/card-parsers', 'test'],
  ['--filter', '@family/card-parsers', 'typecheck'],
  build,
  ['--filter', '@family/worker', 'test'],
  ['--filter', '@family/worker', 'typecheck'],
];
for (const args of commands) execFileSync('pnpm', args, { cwd: '/app', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
process.stdout.write(JSON.stringify({ checks: commands.map(args => args.join(' ')), ...(artifactOnly ? { artifacts: readdirSync('/app/packages/card-parsers/dist').sort().map(name => ({ name, base64: readFileSync(`/app/packages/card-parsers/dist/${name}`).toString('base64') })) } : {}) }));
