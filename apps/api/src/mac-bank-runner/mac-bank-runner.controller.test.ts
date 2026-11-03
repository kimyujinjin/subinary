import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { MacBankRunnerController } from './mac-bank-runner.controller';
import { MacBankRunnerService } from './mac-bank-runner.service';

/** 서비스 응답·실패 어느 경우에도 입력 객체와 원본 요청 버퍼를 폐기한다. */
describe('Mac 로그인 정보 입력 경계', () => {
  const user = { userId: '00000001-1111-4111-8111-111111111111', email: 'synthetic@example.invalid' } as AuthenticatedUser;
  for (const failure of [false, true]) {
    it(failure ? '저장 실패에도 입력을 폐기한다' : '저장 성공 후 입력을 폐기한다', async () => {
      const saveCredentials = vi.fn(async () => { if (failure) throw new Error('fixed_storage_failure'); return { stored: true }; });
      const controller = new MacBankRunnerController({ saveCredentials } as unknown as MacBankRunnerService);
      const input = { loginId: 'synthetic-private-id', password: 'synthetic-private-password' };
      const rawBody = Buffer.from(JSON.stringify(input)), request = { rawBody } as unknown as FastifyRequest;
      if (failure) await expect(controller.saveCredentials(user, input, request)).rejects.toThrow('fixed_storage_failure');
      else expect(await controller.saveCredentials(user, input, request)).toEqual({ stored: true });
      expect(input.loginId === '' && input.password === '').toBe(true);
      expect(rawBody.every(value => value === 0)).toBe(true);
    });
  }
  it('JWT나 다른 형식의 bearer를 전용 credential 전달에 사용하지 않는다', () => {
    const retrieveCredentials = vi.fn(), controller = new MacBankRunnerController({ retrieveCredentials } as unknown as MacBankRunnerService);
    const request = { headers: { authorization: 'Bearer synthetic.invalid.jwt' } } as unknown as FastifyRequest;
    expect(() => controller.retrieveCredentials(request, user.userId, { claimId: user.userId, credentialVersion: 1 })).toThrow();
    expect(retrieveCredentials).not.toHaveBeenCalled();
  });
});
