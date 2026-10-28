import { defineConfig } from 'tsup';

/**
 * stdio MCP 서버와 연결된 PC용 품질 조회 명령을 각각 독립 CJS 파일로 만든다.
 * SDK·검증기·내부 패키지는 번들에 포함하고 Node 내장 모듈만 외부로 둔다.
 * 실행 파일이므로 타입 선언 대신 소스맵과 shebang을 생성한다.
 */
export default defineConfig({
  entry: ['src/main.ts', 'src/check.ts', 'src/remote.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  // node:sqlite는 접두사 없는 sqlite 이름으로 불러올 수 없다.
  removeNodeProtocol: false,
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
  dts: false,
  // 두 실행 파일을 설치 디렉터리에 각각 복사해도 추가 의존성 없이 실행되게 한다.
  noExternal: [/@modelcontextprotocol\/sdk/, /^@family\//, 'zod'],
});
