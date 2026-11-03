import { describe, expect, it } from 'vitest';
import { reconcileCandidateIdentity } from './candidate-identity';

describe('자동 갱신 후보 신원', () => {
  it('같은 근거와 새 결제가 추가된 후보의 UUID를 유지한다', () => {
    const result = reconcileCandidateIdentity(
      [{ id: 'candidate-a', transactionIds: ['a', 'b', 'c'] }],
      [{ transactionIds: ['d', 'c', 'b', 'a'] }], [0],
    );
    expect(result).toEqual({ updates: [{ seriesId: 'candidate-a', candidateIndex: 0 }], deletes: [], inserts: [] });
  });
  it('사용자가 결정한 series에 배정된 후보는 중복 생성하지 않는다', () => {
    expect(reconcileCandidateIdentity(
      [{ id: 'old', transactionIds: ['a'] }], [{ transactionIds: ['a'] }], [],
    )).toEqual({ updates: [], deletes: ['old'], inserts: [] });
  });
  it('병합된 미확정 후보에는 임의의 기존 신원을 고르지 않는다', () => {
    expect(reconcileCandidateIdentity(
      [{ id: 'a', transactionIds: ['1'] }, { id: 'b', transactionIds: ['2'] }],
      [{ transactionIds: ['1', '2'] }], [0],
    )).toEqual({ updates: [], deletes: ['a', 'b'], inserts: [0] });
  });
  it('분할된 후보도 새 판단 대상으로 구분한다', () => {
    expect(reconcileCandidateIdentity(
      [{ id: 'a', transactionIds: ['1', '2'] }],
      [{ transactionIds: ['1'] }, { transactionIds: ['2'] }], [0, 1],
    )).toEqual({ updates: [], deletes: ['a'], inserts: [0, 1] });
  });
  it('빈 근거를 가진 후보와 실제로 사라진 후보는 삭제한다', () => {
    expect(reconcileCandidateIdentity(
      [{ id: 'empty', transactionIds: [] }, { id: 'gone', transactionIds: ['1'] }], [], [],
    )).toEqual({ updates: [], deletes: ['empty', 'gone'], inserts: [] });
  });
});
