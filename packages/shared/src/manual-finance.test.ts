import { describe, expect, it } from 'vitest';
import { assertManualFinanceNotFuture, manualFinanceCanRead, manualFinanceCanWrite, manualFinanceSeoulDate, summarizeManualAssets, summarizeManualHousingPlans, type ManualAssetSummaryInput, type ManualFinancePolicyRecord, type ManualHousingSummaryInput } from './manual-finance.js';

const actor = { userId: 'alice', householdId: 'family', activeMembership: true };
const own: ManualFinancePolicyRecord = { householdId: 'family', ownerUserId: 'alice', visibility: 'private', ownerActiveMembership: true };
const asset = (id: string, value: string | null, kind: ManualAssetSummaryInput['kind'] = 'account', date = '2000-01-01'): ManualAssetSummaryInput => ({ id, kind, amount: value, currency: 'KRW', asOfDate: value === null ? null : date, source: value === null ? null : 'manual' });
const payment = (id: string, dueDate: string | null, value: string | null = '100', paid: string | null = '0'): ManualHousingSummaryInput['payments'][number] => ({ id, kind: 'balance', installment: null, dueDate, amount: value, paidAmount: paid, paidDate: paid !== null && BigInt(paid) > 0n ? '2000-01-01' : null });
const plan = (payments: ManualHousingSummaryInput['payments'], id = 'plan'): ManualHousingSummaryInput => ({ id, label: '합성 계획', payments });

describe('수동 기록 scope·작성 권한', () => {
  it('개인 scope는 본인 개인 기록만 읽는다', () => {
    expect(manualFinanceCanRead(actor, own, 'private')).toBe(true);
    expect(manualFinanceCanRead(actor, { ...own, ownerUserId: 'bob' }, 'private')).toBe(false);
    expect(manualFinanceCanRead(actor, { ...own, visibility: 'household' }, 'private')).toBe(false);
  });
  it('가족 scope는 명시 공유 기록만 읽는다', () => {
    expect(manualFinanceCanRead(actor, own, 'household')).toBe(false);
    expect(manualFinanceCanRead(actor, { ...own, ownerUserId: 'bob', visibility: 'household' }, 'household')).toBe(true);
  });
  it('다른 가구·제거된 독자·제거된 작성자·삭제 기록은 읽기/쓰기 모두 거부한다', () => {
    for (const row of [{ ...own, householdId: 'other' }, { ...own, ownerActiveMembership: false }, { ...own, deletedAt: new Date() }]) {
      expect(manualFinanceCanRead(actor, row, 'private')).toBe(false);
      expect(manualFinanceCanWrite(actor, row)).toBe(false);
    }
    expect(manualFinanceCanRead({ ...actor, activeMembership: false }, own, 'private')).toBe(false);
    expect(manualFinanceCanWrite({ ...actor, activeMembership: false }, own)).toBe(false);
  });
  it('공유 기록도 타인은 쓸 수 없다', () => {
    expect(manualFinanceCanWrite(actor, own)).toBe(true);
    expect(manualFinanceCanWrite(actor, { ...own, ownerUserId: 'bob', visibility: 'household' })).toBe(false);
  });
  it('조회 전용 viewer는 본인 기록을 읽어도 쓰기 권한을 갖지 않는다', () => {
    const viewer = { ...actor, role: 'viewer' as const };
    expect(manualFinanceCanRead(viewer, own, 'private')).toBe(true);
    expect(manualFinanceCanRead(viewer, { ...own, visibility: 'household' }, 'household')).toBe(true);
    expect(manualFinanceCanWrite(viewer, own)).toBe(false);
    expect(manualFinanceCanWrite(viewer, { ...own, visibility: 'household' })).toBe(false);
  });
  it('owner·admin·member도 본인 기록만 쓸 수 있다', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(manualFinanceCanWrite({ ...actor, role }, own)).toBe(true);
      expect(manualFinanceCanWrite({ ...actor, role }, { ...own, ownerUserId: 'bob' })).toBe(false);
    }
  });
  it('UUID 대소문자가 권한의 다른 신원이 되지 않는다', () => {
    expect(manualFinanceCanRead({ ...actor, userId: 'ALICE', householdId: 'FAMILY' }, own, 'private')).toBe(true);
  });
  it('개인 금액·개수 변경이 가족 합계를 바꾸지 않는다', () => {
    const records = [{ ...own, ...asset('shared', '100'), visibility: 'household' as const }, { ...own, ...asset('private', '900') }];
    const visible = (rows: typeof records) => rows.filter((row) => manualFinanceCanRead(actor, row, 'household'));
    const before = summarizeManualAssets(visible(records));
    const changed = [...records.slice(0, 1), { ...records[1]!, amount: '99999999999999999999' }, { ...own, ...asset('private2', '200') }];
    expect(summarizeManualAssets(visible(changed))).toEqual(before);
  });
});

describe('서울 기준 기록일', () => {
  it('UTC 15시 경계에서 서울 날짜가 바뀐다', () => {
    expect(manualFinanceSeoulDate(new Date('2026-10-30T14:59:59Z'))).toBe('2026-10-30');
    expect(manualFinanceSeoulDate(new Date('2026-10-30T15:00:00Z'))).toBe('2026-10-31');
  });
  it('미래·불가능 날짜·연도0을 거부하고 윤년·null은 허용한다', () => {
    for (const value of ['2026-11-01', '2026-02-29', '1900-02-29', '0000-01-01', '2026-04-31', '2026-1-01']) expect(() => assertManualFinanceNotFuture(value, '2026-10-31')).toThrow();
    expect(() => assertManualFinanceNotFuture('2000-02-29', '2026-10-31')).not.toThrow();
    expect(() => assertManualFinanceNotFuture('2026-10-31', '2026-10-31')).not.toThrow();
    expect(() => assertManualFinanceNotFuture(null, '2026-10-31')).not.toThrow();
  });
});

describe('수동 자산 부분합', () => {
  it('행 없음은 0원이 아닌 empty/null이다', () => {
    expect(summarizeManualAssets([])).toMatchObject({ grossAssets: null, debt: null, netAssets: null, completeness: 'empty', assetsCompleteness: 'empty', debtCompleteness: 'empty', asOfDate: null });
  });
  it('전부 미입력은 부분 상태이며 순자산을 만들지 않는다', () => {
    expect(summarizeManualAssets([asset('a', null), asset('l', null, 'loan')])).toMatchObject({ grossAssets: null, debt: null, netAssets: null, completeness: 'partial' });
  });
  it('명시 0은 알려진 값이며 두 집합의 0 순자산을 산출한다', () => {
    expect(summarizeManualAssets([asset('a', '0'), asset('l', '0', 'loan')])).toMatchObject({ grossAssets: '0', debt: '0', netAssets: '0', completeness: 'complete', asOfDate: '2000-01-01' });
  });
  it('부채 집합이 없으면 부채0·순자산으로 추정하지 않는다', () => {
    expect(summarizeManualAssets([asset('a', '100')])).toMatchObject({ grossAssets: '100', debt: null, netAssets: null, assetsCompleteness: 'complete', debtCompleteness: 'empty', completeness: 'partial' });
  });
  it('큰 금액과 음수 순자산을 Number 손실 없이 계산한다', () => {
    expect(summarizeManualAssets([asset('a', '99999999999999999999'), asset('b', '99999999999999999999', 'stock'), asset('l', '1', 'loan')])).toMatchObject({ grossAssets: '199999999999999999998', netAssets: '199999999999999999997' });
    expect(summarizeManualAssets([asset('a', '1'), asset('l', '2', 'loan')]).netAssets).toBe('-1');
  });
  it('일부 미입력은 알려진 부분합만 표시하고 순자산을 보류한다', () => {
    expect(summarizeManualAssets([asset('a', '100'), asset('u', null, 'saving'), asset('l', '5', 'loan')])).toMatchObject({ grossAssets: '100', debt: '5', netAssets: null, assetsCompleteness: 'partial', asOfDate: null });
  });
  it('혼합 기준일을 단일 기준일로 표시하지 않는다', () => {
    expect(summarizeManualAssets([asset('a', '10'), asset('l', '2', 'loan', '2000-02-01')])).toMatchObject({ asOfDate: null, oldestAsOfDate: '2000-01-01', newestAsOfDate: '2000-02-01', mixedAsOfDates: true });
  });
  it('동일 ID의 중복은 한 번만 계산하고 충돌은 거부한다', () => {
    const a = asset('a', '100');
    expect(summarizeManualAssets([a, { ...a, id: 'A' }]).grossAssets).toBe('100');
    expect(() => summarizeManualAssets([a, { ...a, amount: '101' }])).toThrow('manual_finance_conflicting_record');
  });
  it('외화·불완전 출처·소수·지수·JS Number를 거부한다', () => {
    for (const row of [{ ...asset('a', '1'), currency: 'USD' }, { ...asset('a', '1'), source: null }, { ...asset('a', null), asOfDate: '2000-01-01' }, asset('a', '1.2'), asset('a', '1e2'), asset('a', 9007199254740993 as unknown as string)]) expect(() => summarizeManualAssets([row])).toThrow();
  });
});

describe('입력된 미지급 일정', () => {
  it('계획 없음과 지급 미입력을 구분한다', () => {
    expect(summarizeManualHousingPlans([])).toEqual({ nextPayment: null, hasIncompletePayments: false });
    expect(summarizeManualHousingPlans([plan([])])).toEqual({ nextPayment: null, hasIncompletePayments: true });
  });
  it('금액·지급액·기일 미입력을 완납 또는 0으로 바꾸지 않는다', () => {
    for (const p of [payment('p', '2030-01-01', null, null), payment('p', '2030-01-01', '100', null), payment('p', null)]) expect(summarizeManualHousingPlans([plan([p])])).toEqual({ nextPayment: null, hasIncompletePayments: true });
  });
  it('불완전 항목이 있어도 알려진 일정 중 가장 이른 미지급을 명시한다', () => {
    expect(summarizeManualHousingPlans([plan([payment('future', '2030-01-01'), payment('late', '2000-01-02', '100', '10'), payment('unknown', null)])])).toMatchObject({ nextPayment: { paymentId: 'late', dueDate: '2000-01-02', remainingAmountKrw: '90' }, hasIncompletePayments: true });
  });
  it('명시 완납과 명시 0원은 다음 미지급에서 제외한다', () => {
    expect(summarizeManualHousingPlans([plan([payment('paid', '2030-01-01', '100', '100'), payment('zero', '2030-01-02', '0', '0')])])).toEqual({ nextPayment: null, hasIncompletePayments: false });
  });
  it('큰 금액 잔액도 정확하다', () => {
    expect(summarizeManualHousingPlans([plan([payment('p', '2030-01-01', '99999999999999999999', '1')])]).nextPayment?.remainingAmountKrw).toBe('99999999999999999998');
  });
  it('동일 기일의 결과가 입력 순서와 무관하다', () => {
    const a = plan([payment('b', '2030-01-01')], 'a'); const b = plan([payment('a', '2030-01-01')], 'b');
    expect(summarizeManualHousingPlans([a, b])).toEqual(summarizeManualHousingPlans([b, a]));
  });
  it('동일 계획 중복은 결과를 바꾸지 않으며 다른 계획의 같은 지급 ID는 거부한다', () => {
    const a = plan([payment('p', '2030-01-01')]);
    expect(summarizeManualHousingPlans([a, a])).toEqual(summarizeManualHousingPlans([a]));
    expect(() => summarizeManualHousingPlans([a, { ...a, id: 'other' }])).toThrow('manual_finance_conflicting_record');
  });
  it('초과 지급·금액 없이 지급·지급일 누락·날짜만 기재는 거부한다', () => {
    for (const p of [payment('p', '2030-01-01', '100', '101'), payment('p', '2030-01-01', null, '1'), { ...payment('p', '2030-01-01', '100', '1'), paidDate: null }, { ...payment('p', '2030-01-01'), paidDate: '2000-01-01' }]) expect(() => summarizeManualHousingPlans([plan([p])])).toThrow();
  });
  it('개인 계획·기록 변경을 인가된 가족 입력에 섞지 않는다', () => {
    const rows = [{ ...own, ...plan([payment('public', '2030-01-01')], 's'), visibility: 'household' as const }, { ...own, ...plan([payment('private', '2000-01-01')], 'p') }];
    expect(summarizeManualHousingPlans(rows.filter((row) => manualFinanceCanRead(actor, row, 'household'))).nextPayment?.paymentId).toBe('public');
  });
});
