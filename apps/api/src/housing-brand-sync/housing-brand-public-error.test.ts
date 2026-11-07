import { describe, expect, it } from 'vitest';
import { publicErrorMessage } from './housing-brand-sync.service';

describe('publicErrorMessage', () => {
  it('does not claim table cells were emptied when layout/login control is unsupported', () => {
    const message = publicErrorMessage('unsupported_layout');
    expect(message).not.toContain('표 구성');
    expect(message).not.toContain('비워 두');
    expect(message.toLowerCase()).not.toMatch(/table|emptied/i);
    expect(message).toMatch(/로그인|화면|구성|읽지/);
  });

  it('keeps distinct copy for credentials and auth-required failures', () => {
    expect(publicErrorMessage('credentials_invalid')).toContain('로그인에 실패');
    expect(publicErrorMessage('authentication_required')).toContain('추가 인증');
    expect(new Set([
      publicErrorMessage('unsupported_layout'),
      publicErrorMessage('credentials_invalid'),
      publicErrorMessage('authentication_required'),
    ]).size).toBe(3);
  });
});
