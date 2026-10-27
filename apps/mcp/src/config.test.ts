import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';

const directories: string[] = [];

/** 실제 인증 정보를 사용하지 않는 임시 인증 파일을 만든다. */
function fixture(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'fma-config-test-'));
  directories.push(directory);
  const path = join(directory, 'credentials.json');
  writeFileSync(path, contents, { mode: 0o600 });
  return path;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('로컬 금융 인증 설정', () => {
  it('소유자 전용 인증 파일과 금융 조회 기본값을 사용한다', () => {
    const path = fixture(JSON.stringify({ email: 'fixture@example.com', password: 'fixture-only' }));
    const config = loadConfig({ FAMILY_CREDENTIALS_FILE: path });
    expect(config.email).toBe('fixture@example.com');
    expect(config.password).toBe('fixture-only');
    expect(config.toolMode).toBe('finance-readonly');
  });

  it('다른 사용자가 읽을 수 있는 파일을 거부한다', () => {
    const path = fixture(JSON.stringify({ email: 'fixture@example.com', password: 'fixture-only' }));
    chmodSync(path, 0o644);
    expect(() => loadConfig({ FAMILY_CREDENTIALS_FILE: path })).toThrow('권한 600');
  });

  it('손상된 파일의 내용이나 비밀번호를 에러에 포함하지 않는다', () => {
    const path = fixture('{password: fixture-secret-do-not-echo}');
    try {
      loadConfig({ FAMILY_CREDENTIALS_FILE: path });
      expect.unreachable('손상된 JSON은 거부해야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('fixture-secret-do-not-echo');
      expect(String(error)).toContain('FAMILY_CREDENTIALS_FILE');
    }
  });

  it('알 수 없는 도구 모드를 거부한다', () => {
    expect(() => loadConfig({ FAMILY_EMAIL: 'fixture@example.com', FAMILY_PASSWORD: 'fixture-only', FAMILY_TOOL_MODE: 'unrestricted' })).toThrow('FAMILY_TOOL_MODE');
  });
});
