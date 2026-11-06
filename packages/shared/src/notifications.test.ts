import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_CHANNEL_META,
  NOTIFICATION_CHANNELS,
} from './notifications.js';

describe('알림 채널', () => {
  it('채널 id는 그대로다 — 바뀌면 사용자가 Android 설정에서 끈 채널이 새로 생겨 다시 켜진다', () => {
    expect(NOTIFICATION_CHANNELS).toEqual({
      transaction: 'txn',
      budget: 'budget',
      reminder: 'reminder',
      summary: 'summary',
      decline: 'decline',
      upcoming: 'upcoming',
      review: 'review',
    });
    expect(NOTIFICATION_CHANNEL_META.map((meta) => meta.id)).toEqual([
      'txn',
      'budget',
      'reminder',
      'summary',
      'decline',
      'upcoming',
      'review',
    ]);
  });

  it('이름은 할 일 화면 섹션 이름과 같고, 설명은 화면 이름 규칙을 따른다', () => {
    const byId = new Map(NOTIFICATION_CHANNEL_META.map((meta) => [meta.id, meta]));
    expect(byId.get(NOTIFICATION_CHANNELS.reminder)).toMatchObject({
      name: '확인할 거래',
      description: '확인 필요·중복 의심으로 남은 거래',
    });
    expect(byId.get(NOTIFICATION_CHANNELS.review)?.name).toBe('가족이 물어본 결제');
    expect(byId.get(NOTIFICATION_CHANNELS.transaction)?.description).toBe(
      '새 결제·환불 알림',
    );
    expect(byId.get(NOTIFICATION_CHANNELS.decline)?.description).toBe(
      '반복 실패한 결제 알림',
    );
    // 옛 이름·내부 말(리마인더·요청·취소·거절)이 시스템 설정에 다시 나오지 않는다.
    for (const meta of NOTIFICATION_CHANNEL_META) {
      expect(`${meta.name} ${meta.description}`).not.toMatch(/리마인더|확인 요청|취소|거절/);
    }
  });
});
