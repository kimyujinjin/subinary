import { z } from 'zod';
import { bankConnectionErrorSchema, bankObservationSchema } from './bank-connections.js';

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
/** 사용자에게 표시한 일회 조회 동의다. 로그인 정보 저장은 별도 설정 동의를 요구한다. */
export const MAC_BANK_RUNNER_CONSENT_TEXT = '내 명의의 신한 통장·대출을 연결한 Mac의 Codex로 이번에 한 번 조회하고, 확인한 원화 잔액·대출 원금·만기일을 모아에 본인 전용으로 저장하는 데 동의해요. 별도 저장 설정에 동의한 로그인 정보가 있으면 이번 작업을 맡은 본인 Mac에 전달해 정상 은행 로그인에 사용해요. 추가 은행 인증은 은행 화면에서 직접 진행하며, 이체·상환·정기 조회는 허용하지 않아요.';
export const MAC_BANK_RUNNER_CONSENT_VERSION = 2 as const;
/** 별도 저장 동의이며 일회 조회 동의나 Mac 연결 승인으로 대체하지 않는다. */
export const MAC_BANK_CREDENTIAL_CONSENT_TEXT = '신한은행 아이디와 비밀번호를 모아 서버에 암호화해 저장하고, 내가 조회를 요청한 작업을 맡은 본인 Mac에 정상 은행 로그인을 위해 전달하는 데 동의해요. 은행 추가 인증은 직접 진행하며, 연결 해제나 로그인 정보 삭제 시 저장한 정보가 폐기돼요.';
export const MAC_BANK_CREDENTIAL_CONSENT_VERSION = 1 as const;
const credentialVersion = z.number().int().min(1).max(2_147_483_646);
const loginId = z.string().min(1).max(100).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value));
const password = z.string().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
/** 저장 요청의 평문은 입력 경계에서만 사용하고 응답·로그에 복사하지 않는다. */
export const macBankCredentialSaveSchema = z.object({ householdId: uuid, runnerId: uuid, loginId, password,
  consentVersion: z.literal(1), expectedVersion: credentialVersion.nullable() }).strict();
export type MacBankCredentialSave = z.infer<typeof macBankCredentialSaveSchema>;
export const macBankCredentialDeleteSchema = z.object({ householdId: uuid, runnerId: uuid, expectedVersion: credentialVersion }).strict();
export type MacBankCredentialDelete = z.infer<typeof macBankCredentialDeleteSchema>;
/** 저장 상태에는 인증정보나 암호화 envelope를 포함하지 않는다. */
export const macBankCredentialStateSchema = z.object({ stored: z.boolean(), runnerId: uuid, version: credentialVersion, updatedAt: instant }).strict();
export type MacBankCredentialState = z.infer<typeof macBankCredentialStateSchema>;
export const macBankCredentialRequestSchema = z.object({ claimId: uuid, credentialVersion }).strict();
/** 이 응답은 HTTPS의 해당 claim 실행기에만 전달하며 일반 상태 DTO에 넣지 않는다. */
export const macBankCredentialResultSchema = z.object({ loginId, password, credentialVersion }).strict();
export type MacBankCredentialResult = z.infer<typeof macBankCredentialResultSchema>;
export const macBankPairSchema = z.object({ pairId: uuid, secret: z.string().regex(/^[0-9a-f]{64}$/),
  userCode: z.string().regex(/^[0-9a-f]{32}$/), label: z.string().trim().min(1).max(40) }).strict();
export type MacBankPair = z.infer<typeof macBankPairSchema>;
export const macBankApproveSchema = z.object({ householdId: uuid, pairId: uuid, userCode: z.string().regex(/^[0-9a-f]{32}$/),
  grantMode: z.enum(['seven_days', 'until_revoked']).optional() }).strict();
export type MacBankApprove = z.infer<typeof macBankApproveSchema>;
export const macBankScopeSchema = z.object({ householdId: uuid }).strict();
export const macBankJobRequestSchema = z.object({ householdId: uuid, requestId: uuid, consentVersion: z.union([z.literal(1), z.literal(2)]).optional() }).strict();
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
  state: macBankJobStateSchema, claimId: uuid.nullable(), credentialVersion: credentialVersion.nullable().default(null), consentVersion: z.union([z.literal(1), z.literal(2)]).default(1), continueVersion: z.number().int().min(0).max(2_147_483_647),
  errorCode: bankConnectionErrorSchema.nullable(), logoutConfirmed: z.boolean(), observations: z.array(bankObservationSchema).max(20),
  createdAt: instant, updatedAt: instant, expiresAt: instant,
  claimedAt: instant.nullable(), completedAt: instant.nullable() }).strict();
export type MacBankJob = z.infer<typeof macBankJobSchema>;
export const macBankRunnerSchema = z.object({ id: uuid, label: z.string().max(40), online: z.boolean(), lastSeenAt: instant.nullable(), expiresAt: instant.nullable() }).strict();
export type MacBankRunner = z.infer<typeof macBankRunnerSchema>;
export const macBankRunnerStateSchema = z.object({ runner: macBankRunnerSchema.nullable(), job: macBankJobSchema.nullable(), previousResult: previousResult.nullable(),
  credentials: macBankCredentialStateSchema.nullable().default(null), credentialStorageAvailable: z.boolean().default(false) }).strict();
export type MacBankRunnerState = z.infer<typeof macBankRunnerStateSchema>;
export const macBankHeartbeatSchema = z.object({ paired: z.boolean(), runnerId: uuid, pairExpiresAt: instant,
  grantExpiresAt: instant.nullable(), job: macBankJobSchema.nullable() }).strict();
export type MacBankHeartbeat = z.infer<typeof macBankHeartbeatSchema>;
export const macBankClaimResultSchema = z.object({ job: macBankJobSchema.nullable() }).strict();
export const macBankPairResultSchema = z.object({ runnerId: uuid, pairExpiresAt: instant }).strict();
