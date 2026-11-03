import { z } from 'zod';

const uuid = z.string().uuid();
const version = z.number().int().positive().max(2_147_483_647);
const instant = z.string().datetime({ offset: true });
// Provider amounts remain decimal strings; never round through a JS number.
export const financeConnectionDecimalSchema = z.string().max(30).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const financeConnectionErrorSchema = z.enum([
  'provider_unavailable', 'provider_denied', 'token_expired', 'rate_limited',
  'invalid_response', 'token_uncertain', 'account_unavailable', 'operation_unknown',
  'configuration_unavailable',
]);
export type FinanceConnectionError = z.infer<typeof financeConnectionErrorSchema>;
export const financeConnectionStatusSchema = z.enum([
  'connecting', 'select_account', 'ready', 'refreshing', 'error', 'reauth_required', 'disconnected',
]);
export type FinanceConnectionStatus = z.infer<typeof financeConnectionStatusSchema>;

export const financeConnectionQuerySchema = z.object({ householdId: uuid }).strict();
export const financeConnectionRegisterSchema = z.object({
  householdId: uuid,
  /** Client-generated idempotency identity. Reconcile this ID after an unknown response. */
  connectionId: uuid,
  clientId: z.string().min(1).max(512).regex(/^\S+$/),
  clientSecret: z.string().min(1).max(2048).regex(/^\S+$/),
  consent: z.object({ storeCredentials: z.literal(true), refreshOnOpen: z.literal(true), ownAccount: z.literal(true) }).strict(),
}).strict();
export type FinanceConnectionRegister = z.infer<typeof financeConnectionRegisterSchema>;
export const financeConnectionSelectAccountSchema = z.object({
  householdId: uuid, expectedVersion: version, accountId: z.string().length(64).regex(/^[0-9a-f]{64}$/),
}).strict();
export type FinanceConnectionSelectAccount = z.infer<typeof financeConnectionSelectAccountSchema>;
export const financeConnectionRefreshSchema = z.object({
  householdId: uuid, requestId: uuid, expectedVersion: version,
}).strict();
export type FinanceConnectionRefresh = z.infer<typeof financeConnectionRefreshSchema>;
export const financeConnectionDisconnectSchema = z.object({ householdId: uuid, expectedVersion: version }).strict();
export type FinanceConnectionDisconnect = z.infer<typeof financeConnectionDisconnectSchema>;

export const financeConnectionSnapshotSchema = z.object({
  observedAt: instant,
  /** The provider does not supply an authoritative valuation instant in this contract. */
  valuationAt: z.null(),
  totals: z.array(z.object({ currency: z.enum(['KRW', 'USD']), marketValue: financeConnectionDecimalSchema,
    afterCostValue: financeConnectionDecimalSchema }).strict()).min(1).max(2)
    .refine(items => new Set(items.map(item => item.currency)).size === items.length),
  items: z.array(z.object({ symbol: z.string().min(1).max(128), name: z.string().min(1).max(512),
    currency: z.enum(['KRW', 'USD']), quantity: financeConnectionDecimalSchema,
    marketValue: financeConnectionDecimalSchema, afterCostValue: financeConnectionDecimalSchema }).strict()).max(10_000),
}).strict();
export type FinanceConnectionSnapshot = z.infer<typeof financeConnectionSnapshotSchema>;
export const financeConnectionSchema = z.object({
  id: uuid, householdId: uuid, ownerUserId: uuid, provider: z.literal('toss_securities'), version,
  status: financeConnectionStatusSchema,
  visibility: z.literal('owner_only'), includedInTotals: z.literal(false),
  refreshOnOpen: z.boolean(), consentedAt: instant,
  accountOptions: z.array(z.object({ id: z.string().length(64).regex(/^[0-9a-f]{64}$/),
    type: z.literal('BROKERAGE'), label: z.string().max(100) }).strict()).max(100),
  selectedAccountId: z.string().length(64).regex(/^[0-9a-f]{64}$/).nullable(),
  lastSuccessAt: instant.nullable(), lastAttemptAt: instant.nullable(),
  canRefresh: z.boolean(), nextRefreshAt: instant.nullable(),
  errorCode: financeConnectionErrorSchema.nullable(),
  snapshot: financeConnectionSnapshotSchema.nullable(),
  createdAt: instant, updatedAt: instant,
}).strict();
export type FinanceConnection = z.infer<typeof financeConnectionSchema>;
export const financeConnectionResultSchema = z.object({ item: financeConnectionSchema }).strict();
export type FinanceConnectionResult = z.infer<typeof financeConnectionResultSchema>;
export const financeConnectionListSchema = z.object({
  enabled: z.boolean(), disabledReason: z.literal('not_configured').nullable(), items: z.array(financeConnectionSchema),
}).strict();
export type FinanceConnectionList = z.infer<typeof financeConnectionListSchema>;
