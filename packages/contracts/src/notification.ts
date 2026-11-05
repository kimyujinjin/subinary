import { z } from 'zod';

/** 푸시 구독 플랫폼(FCM 토큰 발급처). */
export const pushPlatformSchema = z.enum(['android', 'ios', 'web']);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

/**
 * 알림 유형(@family/shared NotificationKind와 일치). 알림함 항목과 종류별 끄기
 * (`disabledKinds`)가 함께 쓰므로 요청 스키마보다 먼저 선언한다.
 */
export const notificationKindSchema = z.enum([
  'transaction',
  'budget',
  'reminder',
  'summary',
  'decline',
  // 정기 결제 예고(금액 레이어 S3). `reminder`와 나눈 이유는 @family/shared의
  // NOTIFICATION_CHANNELS 주석 참조 — 사용자가 따로 끌 수 있어야 한다.
  'upcoming',
  // 가족 확인 요청(2026-11-04). 사람이 사람에게 보내는 알림.
  'review',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** `minAmount`의 상한 — DB `integer` 컬럼 범위. 넘으면 저장이 500으로 실패한다. */
const NOTIFICATION_MIN_AMOUNT_MAX = 2_147_483_647;

// --- Requests ---

/**
 * `POST /v1/notifications/subscriptions` — FCM 토큰 등록/갱신.
 * 같은 token 재등록은 소유 userId를 호출자로 교체(기기 양도)하고 되살린다.
 */
export const pushSubscriptionRegisterRequestSchema = z.object({
  token: z.string().min(1).max(4096),
  platform: pushPlatformSchema,
});
export type PushSubscriptionRegisterRequest = z.infer<
  typeof pushSubscriptionRegisterRequestSchema
>;

/**
 * `PUT /v1/notifications/preferences` — 알림 선호 갱신(부분 아님, 전체 대체).
 * minAmount는 KRW 정수(0 이상). 무음 시간대는 분 단위(0~1439), 자정 넘김 허용.
 * 켜려면 start/end 둘 다 지정, 끄려면 둘 다 null. 시작과 끝이 같으면 거절한다 —
 * 발송 쪽은 그 값을 "무음 없음"으로 읽어서, 켰다고 믿는 사용자에게 밤에 알림이 간다.
 *
 * `disabledKinds`(종류별 끄기)만 **생략할 수 있다**: 이 필드를 모르는 옛 앱 번들도 같은
 * PUT을 보내므로, 생략하면 서버가 저장된 값을 그대로 둔다(빈 배열로 덮으면 옛 번들에서
 * 스위치 하나만 바꿔도 새 번들에서 끈 종류가 전부 되살아난다).
 */
export const notificationPreferencesUpdateRequestSchema = z
  .object({
    pushEnabled: z.boolean(),
    minAmount: z
      .number()
      .int()
      .min(0)
      .max(NOTIFICATION_MIN_AMOUNT_MAX)
      .nullable(),
    quietStartMinute: z.number().int().min(0).max(1439).nullable(),
    quietEndMinute: z.number().int().min(0).max(1439).nullable(),
    notifyOwnCollected: z.boolean(),
    /** 푸시를 보내지 않을 알림 종류. 알림함 기록은 그대로 남는다. */
    disabledKinds: z
      .array(notificationKindSchema)
      .max(notificationKindSchema.options.length)
      .optional(),
  })
  .refine(
    (v) =>
      (v.quietStartMinute === null) === (v.quietEndMinute === null),
    {
      message: '무음 시간대는 시작과 끝을 함께 지정하거나 함께 비워야 해요',
      path: ['quietEndMinute'],
    },
  )
  .refine(
    (v) =>
      v.quietStartMinute === null || v.quietStartMinute !== v.quietEndMinute,
    {
      message: '무음 시간대의 시작과 끝을 다르게 정해 주세요',
      path: ['quietEndMinute'],
    },
  );
export type NotificationPreferencesUpdateRequest = z.infer<
  typeof notificationPreferencesUpdateRequestSchema
>;

// --- Responses ---

/** 구독 등록 결과. */
export const pushSubscriptionResponseSchema = z.object({
  registered: z.literal(true),
});
export type PushSubscriptionResponse = z.infer<
  typeof pushSubscriptionResponseSchema
>;

/**
 * 현재 알림 선호(행이 없으면 기본값으로 채워 반환).
 *
 * `z.object`(strict 아님)로 둔다 — 키를 더해도 옛 클라이언트가 응답을 거절하지 않게.
 * 웹은 응답을 이 스키마로 파싱하지 않지만(타입으로만 쓴다), 파싱하는 소비자가 생겨도
 * 모르는 키는 버려질 뿐이다.
 */
export const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  minAmount: z.number().int().nullable(),
  quietStartMinute: z.number().int().nullable(),
  quietEndMinute: z.number().int().nullable(),
  notifyOwnCollected: z.boolean(),
  /** 푸시를 끈 알림 종류(유형 순서로 정렬, 중복 없음). 없으면 빈 배열. */
  disabledKinds: z.array(notificationKindSchema),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

// --- 인앱 알림함 (알림 센터) ---

/** 알림함 항목 1건. */
export const notificationItemSchema = z.object({
  id: z.string().uuid(),
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string(),
  deepLink: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** `GET /v1/notifications` — 커서 페이지네이션 목록(최신순). */
export const notificationListResponseSchema = z.object({
  items: z.array(notificationItemSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationListResponse = z.infer<
  typeof notificationListResponseSchema
>;

/** `GET /v1/notifications/unread-count`. */
export const notificationUnreadCountSchema = z.object({
  count: z.number().int(),
});
export type NotificationUnreadCount = z.infer<
  typeof notificationUnreadCountSchema
>;
