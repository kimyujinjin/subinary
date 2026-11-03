import { z } from 'zod';
import { bankConnectionErrorSchema, bankObservationSchema } from './bank-connections.js';

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
/** 사용자에게 표시한 일회 조회·저장 동의다. 인증정보 저장이나 예약 동의는 포함하지 않는다. */
export const MAC_BANK_RUNNER_CONSENT_TEXT = '내 명의의 신한 통장·대출을 연결한 Mac의 Codex로 한 번 조회하고, 확인한 원화 잔액·대출 원금·만기일을 모아에 본인 전용으로 저장하는 데 동의해요. 은행 인증은 은행 화면에서 직접 진행하며, 로그인 정보 저장·이체·상환·정기 조회는 허용하지 않아요.';
export const MAC_BANK_RUNNER_CONSENT_VERSION = 1 as const;
export const macBankPairSchema = z.object({ pairId: uuid, secret: z.string().regex(/^[0-9a-f]{64}$/),
  userCode: z.string().regex(/^[0-9a-f]{32}$/), label: z.string().trim().min(1).max(40) }).strict();
export type MacBankPair = z.infer<typeof macBankPairSchema>;
export const macBankApproveSchema = z.object({ householdId: uuid, pairId: uuid, userCode: z.string().regex(/^[0-9a-f]{32}$/),
  grantMode: z.enum(['seven_days', 'until_revoked']).optional() }).strict();
export type MacBankApprove = z.infer<typeof macBankApproveSchema>;
export const macBankScopeSchema = z.object({ householdId: uuid }).strict();
export const macBankJobRequestSchema = z.object({ householdId: uuid, requestId: uuid, consentVersion: z.literal(1).optional() }).strict();
export type MacBankJobRequest = z.infer<typeof macBankJobRequestSchema>;
export const macBankClaimSchema = z.object({ claimId: uuid }).strict();
export type MacBankClaim = z.infer<typeof macBankClaimSchema>;
export const macBankProgressStateSchema = z.enum(['running', 'authentication_required', 'reading', 'logging_out']);
export const macBankProgressSchema = z.object({ claimId: uuid, state: macBankProgressStateSchema }).strict();
export type MacBankProgress = z.infer<typeof macBankProgressSchema>;
export const macBankCompleteSchema = z.object({ claimId: uuid,
  outcome: z.enum(['succeeded', 'authentication_required', 'failed']), errorCode: bankConnectionErrorSchema.optional(),
  logoutConfirmed: z.boolean(), observations: z.array(bankObservationSchema).max(20) }).strict().superRefine((value, context) => {
  if (value.outcome === 'succeeded' && (!value.logoutConfirmed || !value.observations.length || value.errorCode !== undefined))
    context.addIssue({ code: 'custom', message: '조회 결과와 정상 로그아웃 확인이 필요합니다.' });
  if (value.outcome !== 'succeeded' && value.observations.length)
    context.addIssue({ code: 'custom', message: '완료하지 않은 조회 결과는 저장하지 않습니다.' });
  if (value.outcome === 'authentication_required' && value.errorCode !== undefined && value.errorCode !== 'authentication_required')
    context.addIssue({ code: 'custom', message: '인증 대기 상태를 확인해 주세요.' });
});
export type MacBankComplete = z.infer<typeof macBankCompleteSchema>;
export const macBankJobStateSchema = z.enum(['queued', 'claimed', 'running', 'authentication_required', 'reading', 'logging_out',
  'succeeded', 'failed', 'cancelled', 'expired', 'operation_unknown']);
export type MacBankJobState = z.infer<typeof macBankJobStateSchema>;
const previousResult = z.object({ jobId: uuid, completedAt: instant, observations: z.array(bankObservationSchema).min(1).max(20) }).strict();
export const macBankJobSchema = z.object({ id: uuid, householdId: uuid, ownerUserId: uuid, runnerId: uuid,
  state: macBankJobStateSchema, claimId: uuid.nullable(), continueVersion: z.number().int().min(0).max(2_147_483_647),
  errorCode: bankConnectionErrorSchema.nullable(), logoutConfirmed: z.boolean(), observations: z.array(bankObservationSchema).max(20),
  createdAt: instant, updatedAt: instant, expiresAt: instant,
  claimedAt: instant.nullable(), completedAt: instant.nullable() }).strict();
export type MacBankJob = z.infer<typeof macBankJobSchema>;
export const macBankRunnerSchema = z.object({ id: uuid, label: z.string().max(40), online: z.boolean(), lastSeenAt: instant.nullable(), expiresAt: instant.nullable() }).strict();
export type MacBankRunner = z.infer<typeof macBankRunnerSchema>;
export const macBankRunnerStateSchema = z.object({ runner: macBankRunnerSchema.nullable(), job: macBankJobSchema.nullable(), previousResult: previousResult.nullable() }).strict();
export type MacBankRunnerState = z.infer<typeof macBankRunnerStateSchema>;
export const macBankHeartbeatSchema = z.object({ paired: z.boolean(), runnerId: uuid, pairExpiresAt: instant,
  grantExpiresAt: instant.nullable(), job: macBankJobSchema.nullable() }).strict();
export type MacBankHeartbeat = z.infer<typeof macBankHeartbeatSchema>;
export const macBankClaimResultSchema = z.object({ job: macBankJobSchema.nullable() }).strict();
export const macBankPairResultSchema = z.object({ runnerId: uuid, pairExpiresAt: instant }).strict();
