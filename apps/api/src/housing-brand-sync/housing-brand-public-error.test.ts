import { describe, expect, it } from 'vitest';
import { publicErrorMessage } from './housing-brand-sync.service';

describe('publicErrorMessage', () => {
  it('does not claim table cells were emptied when layout is unsupported', () => {
    const message = publicErrorMessage('unsupported_layout');
    expect(message).not.toContain('표 구성');
    expect(message).not.toContain('비워 두');
    expect(message.toLowerCase()).not.toMatch(/table|emptied/i);
    // Covers login chrome and empty post-login tables — not login-only wording.
    expect(message).toMatch(/화면|구성|읽지/);
    expect(message).not.toContain('로그인 화면');
  });

  it('tells the user to register a unit on the official site when none is registered', () => {
    const message = publicErrorMessage('unit_not_registered');
    expect(message).toBe('수자인 사이트의 My 분양단지에 등록된 세대가 없어요. 사이트에서 먼저 등록해 주세요.');
    expect(message).not.toBe(publicErrorMessage('unsupported_layout'));
    expect(message).not.toBe(publicErrorMessage('operation_unknown'));
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
