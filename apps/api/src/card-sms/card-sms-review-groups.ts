import { scopedTemplateFingerprint } from '@family/card-parsers';
import type { CardSmsReviewGroup, CardSmsReviewGroupsResponse } from '@family/contracts';
import type { schema } from '@family/database';

type ReviewEvent = Pick<schema.CardSmsEvent, 'id' | 'householdId' | 'memberId' | 'sender' | 'rawContent' | 'parseStatus' | 'receivedAt'>;

/** 원문은 지문 계산에만 쓰고 본인의 미승격 문자 요약만 반환한다. */
export function groupReviewEvents(events: readonly ReviewEvent[], householdId: string, memberId: string, truncated: boolean): CardSmsReviewGroupsResponse {
  const groups = new Map<string, CardSmsReviewGroup>();
  let scannedCount = 0;
  for (const event of events) {
    if (event.householdId !== householdId || event.memberId !== memberId ||
        (event.parseStatus !== 'parse_failed' && event.parseStatus !== 'quarantined')) continue;
    scannedCount += 1;
    const groupId = scopedTemplateFingerprint(householdId, memberId, event.sender, event.rawContent);
    const receivedAt = event.receivedAt.toISOString();
    let group = groups.get(groupId);
    if (!group) {
      group = { groupId, sender: event.sender, count: 0, parseFailed: 0, quarantined: 0,
        latestReceivedAt: receivedAt, representativeEventId: event.id, reviewPath: `/todo?reviewSms=${event.id}` };
      groups.set(groupId, group);
    }
    group.count += 1;
    if (event.parseStatus === 'parse_failed') group.parseFailed += 1;
    else group.quarantined += 1;
    if (receivedAt > group.latestReceivedAt) {
      group.latestReceivedAt = receivedAt;
      group.representativeEventId = event.id;
      group.reviewPath = `/todo?reviewSms=${event.id}`;
    }
  }
  return { scope: 'own_member', scannedCount, truncated, policies: [],
    items: [...groups.values()].sort((a, b) => b.latestReceivedAt.localeCompare(a.latestReceivedAt) || a.groupId.localeCompare(b.groupId)) };
}
