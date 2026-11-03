import { describe, expect, it } from 'vitest';
import { macBankCompleteSchema, macBankPairSchema, macBankJobRequestSchema } from '@family/contracts';
import { macBankActive, macBankTransition, macBankClaimLive, macBankMembershipMatches, macBankRequestMatches, macBankObservations } from './mac-bank-runner.policy';

const now = new Date('2026-11-03T06:00:00.000Z');
const capture = (fingerprint = 'a'.repeat(64), at = now.toISOString()) => ({ formatVersion: 1, provider: 'shinhan', source: 'browser_assisted',
  origin: 'https://bank.shinhan.com', pageKind: 'deposit_account_list', capturedAt: at, accountFingerprint: fingerprint,
  accountLast4: '1234', currency: 'KRW', balanceKind: 'ledger', balanceKrw: '0', bankAsOfDate: null });
const id = '11111111-1111-4111-8111-111111111111';

describe('Mac 조회 실행의 종료·권한 경계', () => {
  it('인증 대기는 워커 단계 전환으로 해제할 수 없다', () => {
    expect(macBankTransition('claimed', 'running')).toBe(true);
    expect(macBankTransition('reading', 'logging_out')).toBe(true);
    expect(macBankTransition('authentication_required', 'running')).toBe(false);
    expect(macBankTransition('logging_out', 'reading')).toBe(false);
  });
  it.each(['succeeded', 'failed', 'cancelled', 'expired', 'operation_unknown'] as const)('종료 %s는 늦은 응답으로 다시 실행하지 않는다', state => {
    expect(macBankActive(state)).toBe(false);
    expect(macBankTransition(state, 'running')).toBe(false);
    expect(macBankClaimLive(state, id, id, new Date(now.getTime() + 60_000), now)).toBe(false);
  });
  it('같은 살아 있는 claim만 재전송할 수 있고 만료 경계는 다시 실행하지 않는다', () => {
    expect(macBankClaimLive('reading', id, id, new Date(now.getTime() + 1), now)).toBe(true);
    expect(macBankClaimLive('reading', id, id, now, now)).toBe(false);
    expect(macBankClaimLive('reading', id, 'other', new Date(now.getTime() + 1), now)).toBe(false);
    expect(macBankClaimLive('queued', null, id, new Date(now.getTime() + 1), now)).toBe(false);
  });
  it('다른 사용자·가구·가입 세대는 기존 요청을 재사용하지 않는다', () => {
    expect(macBankRequestMatches('owner', 'home', 'owner', 'home')).toBe(true);
    expect(macBankRequestMatches('owner', 'home', 'other', 'home')).toBe(false);
    expect(macBankRequestMatches('owner', 'home', 'owner', 'other')).toBe(false);
    expect(macBankMembershipMatches(id, now, id, now)).toBe(true);
    expect(macBankMembershipMatches(id, now, id, new Date(now.getTime() + 1))).toBe(false);
    expect(macBankMembershipMatches(null, null, id, now)).toBe(false);
  });
});

describe('실제 관측 저장의 자료형·로그아웃 경계', () => {
  it('실제 관측 0원은 보존하고 실패·미조회와 구분한다', () => {
    expect(macBankObservations([capture()], now)[0]).toMatchObject({ balanceKrw: '0' });
    expect(() => macBankObservations([], now)).toThrow();
  });
  it('음수·큰 원화 정수와 최대 20계좌를 손실 없이 보존한다', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ ...capture(index.toString(16).padStart(64, '0')),
      balanceKrw: index ? '9007199254740993' : '-1234' }));
    expect(macBankObservations(rows, now)).toHaveLength(20);
    expect(macBankObservations(rows, now)[0]).toMatchObject({ balanceKrw: '-1234' });
    expect(() => macBankObservations([...rows, capture('f'.repeat(64))], now)).toThrow();
  });
  it('중복·과거·미래·다른 통화·잘못된 출처를 저장하지 않는다', () => {
    for (const rows of [[capture(), capture()], [capture('b'.repeat(64), new Date(now.getTime() - 300_001).toISOString())],
      [capture('b'.repeat(64), new Date(now.getTime() + 30_001).toISOString())], [{ ...capture(), currency: 'USD' }],
      [{ ...capture(), origin: 'https://example.com' }]]) expect(() => macBankObservations(rows, now)).toThrow();
  });
  it('성공은 정상 로그아웃과 관측이 모두 필요하며 실패에 관측을 섞지 않는다', () => {
    const value = { claimId: id, outcome: 'succeeded', logoutConfirmed: true, observations: [capture()] };
    expect(macBankCompleteSchema.safeParse(value).success).toBe(true);
    expect(macBankCompleteSchema.safeParse({ ...value, logoutConfirmed: false }).success).toBe(false);
    expect(macBankCompleteSchema.safeParse({ ...value, observations: [] }).success).toBe(false);
    expect(macBankCompleteSchema.safeParse({ ...value, outcome: 'failed' }).success).toBe(false);
  });
  it('은행 비밀번호·예약 동의·임의 필드를 등록 계약으로 받지 않는다', () => {
    const pair = { pairId: id, secret: 'a'.repeat(64), userCode: 'b'.repeat(32), label: '내 Mac' };
    expect(macBankPairSchema.safeParse(pair).success).toBe(true);
    expect(macBankPairSchema.safeParse({ ...pair, password: 'synthetic' }).success).toBe(false);
    expect(macBankPairSchema.safeParse({ ...pair, secret: 'short' }).success).toBe(false);
    expect(macBankJobRequestSchema.safeParse({ householdId: id, requestId: id, dailyConsent: true }).success).toBe(false);
  });
});
