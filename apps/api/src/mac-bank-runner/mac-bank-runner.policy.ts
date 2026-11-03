import { BadRequestException, ConflictException } from '@nestjs/common';
import { bankObservationSchema, type BankObservation, type MacBankJobState } from '@family/contracts';

export const MAC_BANK_ACTIVE_STATES = ['queued', 'claimed', 'running', 'authentication_required', 'reading', 'logging_out'] as const;
export const MAC_BANK_ONLINE_MS = 30_000;
export const MAC_BANK_JOB_TTL_MS = 600_000;
export const MAC_BANK_INTERVAL_MS = 900_000;

/** 소유자에 결박한 승인만 유효하며 만료 없음도 명시적 철회를 넘을 수 없다. */
export function macBankGrantActive(ownerBound: boolean, expiresAt: Date | null, revoked: boolean, now: Date): boolean {
  return ownerBound && !revoked && (expiresAt === null || expiresAt.getTime() > now.getTime());
}

/** 종료하지 않은 작업만 실행 권한을 갖는다. */
export function macBankActive(state: MacBankJobState): boolean {
  return MAC_BANK_ACTIVE_STATES.some(value => value === state);
}

/** 인증 대기는 앱의 continue만 해제하며, 워커는 이전 단계로 되돌아갈 수 없다. */
export function macBankTransition(from: MacBankJobState, to: MacBankJobState): boolean {
  if (!macBankActive(from)) return false;
  if (from === to) return true;
  const allowed: Partial<Record<MacBankJobState, readonly MacBankJobState[]>> = {
    claimed: ['running', 'authentication_required', 'logging_out'],
    running: ['authentication_required', 'reading', 'logging_out'],
    reading: ['authentication_required', 'logging_out'],
  };
  return allowed[from]?.includes(to) ?? false;
}

/** 실행 시작 뒤 만료된 claim은 소유자가 같아도 다시 실행하지 않는다. */
export function macBankClaimLive(state: MacBankJobState, storedClaim: string | null, claim: string, expiresAt: Date, now: Date): boolean {
  return state !== 'queued' && macBankActive(state) && storedClaim === claim && expiresAt.getTime() > now.getTime();
}

/** 재가입으로 같은 회원 ID가 남더라도 최초 승인 시점의 가입 세대를 확인한다. */
export function macBankMembershipMatches(storedId: string | null, storedJoined: Date | null, memberId: string, joinedAt: Date): boolean {
  return storedId === memberId && storedJoined?.getTime() === joinedAt.getTime();
}

/** 같은 requestId는 같은 본인·가구 요청에서만 기존 결과를 다시 보여준다. */
export function macBankRequestMatches(owner: string, household: string, requestedOwner: string, requestedHousehold: string): boolean {
  return owner === requestedOwner && household === requestedHousehold;
}

/** 성공 관측의 출처·자료형·개수·시각·계좌 중복을 검증한다. 금액을 계산하거나 합산하지 않는다. */
export function macBankObservations(input: readonly unknown[], now: Date): BankObservation[] {
  if (!input.length || input.length > 20) throw new BadRequestException('조회한 계좌 개수를 확인해 주세요.');
  const seen = new Set<string>();
  return input.map(value => {
    const parsed = bankObservationSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('은행 조회 결과 형식을 확인해 주세요.');
    const capture = parsed.data, age = now.getTime() - Date.parse(capture.capturedAt);
    if (age < -30_000 || age > 300_000 || seen.has(capture.accountFingerprint))
      throw new ConflictException('조회 결과의 시각과 선택 계좌를 다시 확인해 주세요.');
    seen.add(capture.accountFingerprint);
    return capture;
  });
}
