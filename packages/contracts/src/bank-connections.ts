import { z } from 'zod';
import { shinhanLoanCaptureSchema } from './loan-import.js';

export const assetConnectionProviderSchema = z.enum(['shinhan_bank', 'toss_securities', 'toss_bank', 'kb_bank']);
export type AssetConnectionProvider = z.infer<typeof assetConnectionProviderSchema>;
export const bankConnectionErrorSchema = z.enum([
  'credentials_invalid', 'authentication_required', 'network_error', 'unsupported_layout',
  'account_not_found', 'account_ambiguous', 'account_changed', 'runtime_unavailable', 'operation_unknown', 'timeout',
]);
export type BankConnectionError = z.infer<typeof bankConnectionErrorSchema>;
const loanSelectorSchema = z.object({
  accountLast4: z.string().length(4).regex(/^[0-9]{4}$/),
  loanType: z.enum(['interim', 'jeonse']),
}).strict();
const depositSelectorSchema = z.object({
  accountLast4: z.string().length(4).regex(/^[0-9]{4}$/), accountType: z.literal('deposit'),
}).strict();
export const bankSelectorSchema = z.union([loanSelectorSchema, depositSelectorSchema]);
export type BankSelector = z.infer<typeof bankSelectorSchema>;
const uuid = z.string().uuid();
const version = z.number().int().positive().max(2_147_483_647);
const instant = z.string().datetime({ offset: true });
export const BANK_CONNECTION_CONSENT_VERSION = 2 as const;
export const bankConnectionConsentVersionSchema = z.union([z.literal(1), z.literal(2)]);
/** Keep old versions when revising this text; the form submits the version it displayed. */
export const bankConnectionConsentDocuments = {
  1: [
    '내 명의의 계좌이며 선택한 대출을 확인했어요.',
    '아이디와 비밀번호를 모아 서버에 암호화해 저장하는 데 동의해요. 연결을 해제하면 현재 연결에 저장한 로그인 정보를 삭제해요.',
    '저장한 정보로 신한은행에 자동 로그인해 선택한 대출의 원금·만기일을 모아 서버에 저장·갱신하는 데 동의해요.',
    '자산 또는 연결 화면을 열 때 자동 조회하는 데 동의해요. 앱을 닫아 둔 동안에는 조회하지 않아요.',
  ],
  2: [
    '내 명의의 계좌이며 가져올 통장 또는 대출을 확인했어요.',
    '아이디와 비밀번호를 모아 서버에 암호화해 저장하는 데 동의해요. 연결을 해제하면 현재 연결에 저장한 로그인 정보를 삭제해요.',
    '저장한 정보로 신한은행에 자동 로그인해 선택한 통장의 원화 잔액 또는 대출의 원금·만기일을 모아 서버에 저장·갱신하는 데 동의해요.',
    '자산 또는 연결 화면을 열 때 자동 조회하는 데 동의해요. 앱을 닫아 둔 동안에는 조회하지 않아요.',
  ],
} as const;

/** Ledger balance only: withdrawal limits/available credit are not bank deposits. */
export const shinhanDepositCaptureSchema = z.object({
  formatVersion: z.literal(1), provider: z.literal('shinhan'), source: z.literal('browser_assisted'),
  origin: z.literal('https://bank.shinhan.com'), pageKind: z.literal('deposit_account_list'), capturedAt: instant,
  accountFingerprint: z.string().length(64).regex(/^[0-9a-f]{64}$/), accountLast4: z.string().length(4).regex(/^[0-9]{4}$/),
  currency: z.literal('KRW'), balanceKind: z.literal('ledger'),
  balanceKrw: z.string().refine(value => /^(?:0|[1-9][0-9]{0,19}|-[1-9][0-9]{0,19})$/u.exec(value)?.[0] === value),
  bankAsOfDate: z.null(),
}).strict();
export const bankObservationSchema = z.union([shinhanLoanCaptureSchema, shinhanDepositCaptureSchema]);
export type BankObservation = z.infer<typeof bankObservationSchema>;
export function bankCaptureMatchesSelector(selector: BankSelector, capture: BankObservation): boolean {
  if (selector.accountLast4 !== capture.accountLast4) return false;
  return 'accountType' in selector ? capture.pageKind === 'deposit_account_list'
    : capture.pageKind === 'loan_account_list' && capture.loanType === selector.loanType;
}

/** Only the verified Shinhan loan flow accepts credentials. Other providers stay explicit capabilities. */
export const bankConnectionRegisterSchema = z.object({
  householdId: uuid, connectionId: uuid, provider: z.literal('shinhan_bank'),
  // Negated character classes also reject a terminal newline (JS `$` can match before it).
  loginId: z.string().min(1).max(64).refine(value => !/[^A-Za-z0-9._-]/u.test(value)),
  password: z.string().min(1).max(64).refine(value => !/[^\x21-\x7e]/u.test(value)), selector: bankSelectorSchema,
  consentVersion: bankConnectionConsentVersionSchema,
  consent: z.object({ ownAccount: z.literal(true), storeCredentials: z.literal(true),
    automaticLogin: z.literal(true), refreshOnOpen: z.literal(true) }).strict(),
}).strict().superRefine((value, context) => {
  if ('accountType' in value.selector && value.consentVersion !== 2)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['consentVersion'], message: '통장 잔액 조회 동의가 필요합니다.' });
});
export type BankConnectionRegister = z.infer<typeof bankConnectionRegisterSchema>;
export const bankConnectionRefreshSchema = z.object({ householdId: uuid, requestId: uuid, expectedVersion: version }).strict();
export type BankConnectionRefresh = z.infer<typeof bankConnectionRefreshSchema>;
export const bankConnectionDisconnectSchema = z.object({ householdId: uuid, expectedVersion: version }).strict();
export type BankConnectionDisconnect = z.infer<typeof bankConnectionDisconnectSchema>;

export const bankConnectionSchema = z.object({
  id: uuid, householdId: uuid, ownerUserId: uuid, provider: z.literal('shinhan_bank'), version,
  status: z.enum(['stored', 'refreshing', 'ready', 'error', 'reauth_required', 'disconnected']),
  selector: bankSelectorSchema,
  visibility: z.literal('owner_only'), includedInTotals: z.literal(false),
  refreshOnOpen: z.boolean(), credentialsStored: z.boolean(), consentedAt: instant,
  consentVersion: bankConnectionConsentVersionSchema,
  lastAttemptAt: instant.nullable(), lastSuccessAt: instant.nullable(),
  nextRefreshAt: instant.nullable(), canRefresh: z.boolean(), errorCode: bankConnectionErrorSchema.nullable(),
  /** Automatically collected page observation; never represented as bank-certified or user-reviewed. */
  snapshot: bankObservationSchema.nullable(), createdAt: instant, updatedAt: instant,
}).strict().superRefine((value, context) => {
  if ('accountType' in value.selector && value.consentVersion !== 2)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['consentVersion'], message: '통장 잔액 조회 동의가 필요합니다.' });
  if (value.snapshot && !bankCaptureMatchesSelector(value.selector, value.snapshot))
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['snapshot'], message: '선택한 계좌와 조회 결과가 다릅니다.' });
});
export type BankConnection = z.infer<typeof bankConnectionSchema>;
export const bankConnectionResultSchema = z.object({ item: bankConnectionSchema }).strict();
export type BankConnectionResult = z.infer<typeof bankConnectionResultSchema>;
export const bankConnectionListSchema = z.object({
  enabled: z.boolean(), disabledReason: z.enum(['not_configured', 'runtime_unavailable']).nullable(),
  items: z.array(bankConnectionSchema),
}).strict();
export type BankConnectionList = z.infer<typeof bankConnectionListSchema>;

export const assetConnectionCapabilitySchema = z.object({
  provider: assetConnectionProviderSchema,
  method: z.enum(['official_api', 'web_login', 'unverified']),
  credentialInputAvailable: z.boolean(),
  state: z.enum(['available', 'runtime_required', 'account_verification_required', 'integration_unverified']),
}).strict();
export const assetConnectionCatalogSchema = z.object({ items: z.array(assetConnectionCapabilitySchema).length(4) }).strict();
export type AssetConnectionCatalog = z.infer<typeof assetConnectionCatalogSchema>;
