import { describe, expect, it } from 'vitest';
import {
  assertCardSmsRepairGuard, evaluateCardSmsRepair, type CardSmsRepairSnapshot,
} from './repair-guard';

const event: CardSmsRepairSnapshot = {
  id: '00000000-0000-4000-8000-000000000001', householdId: 'household', memberId: 'member',
  sender: 'card-test', receivedAt: new Date('2026-10-10T20:46:30+09:00'),
  updatedAt: new Date('2026-10-11T00:00:00Z'), parseStatus: 'parse_failed',
  rawContent: '[현대카드]해외원화결제차단신청으로 승인거절되었습니다.',
};

describe('문자 재처리의 결정적 가드', () => {
  it('금액 없는 거절은 거래 생성 없이 확정한다', () => {
    const evaluation = evaluateCardSmsRepair(event);
    expect(evaluation.disposition).toEqual({ parseStatus: 'parsed', parseError: null, promotable: false });
    expect(() => assertCardSmsRepairGuard(event, evaluation.guard)).not.toThrow();
  });

  it('저금 안내는 ignored로 확정하고 거래를 생성하지 않는다', () => {
    const evaluation = evaluateCardSmsRepair({ ...event, rawContent: '토스뱅크 [모임통장 안내]\n가족통장 모임통장 모임금고에 123,456원이 저금됐어요.' });
    expect(evaluation.disposition).toEqual({ parseStatus: 'ignored', parseError: null, promotable: false });
  });

  it.each(['원문 변경', 'parseStatus', 'updatedAt', 'memberId'])('검토 이후 %s을 감지한다', field => {
    const { guard } = evaluateCardSmsRepair(event);
    const changed = field === '원문 변경' ? { ...event, rawContent: `${event.rawContent} 변경` }
      : field === 'parseStatus' ? { ...event, parseStatus: 'parsed' }
        : field === 'updatedAt' ? { ...event, updatedAt: new Date('2026-10-12T00:00:00Z') }
          : { ...event, memberId: 'other-member' };
    expect(() => assertCardSmsRepairGuard(changed, guard)).toThrow();
  });

  it('해석되지 않는 문자와 계획 결과 변경을 거절한다', () => {
    expect(() => evaluateCardSmsRepair({ ...event, rawContent: '해석할 수 없는 새로운 메시지입니다.' })).toThrow('repair_requires_manual_review');
    const { guard } = evaluateCardSmsRepair(event);
    expect(() => assertCardSmsRepairGuard(event, { ...guard, resultHash: '0'.repeat(64) })).toThrow('repair_snapshot_or_parser_changed');
  });
});
