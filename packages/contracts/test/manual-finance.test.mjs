import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { manualAssetCreateRequestSchema, manualAssetUpdateRequestSchema, manualFinanceListQuerySchema, manualHousingPlanCreateRequestSchema, manualHousingPlanUpdateRequestSchema, manualHousingPaymentInputSchema, manualFinanceDeleteRequestSchema, manualKrwAmountSchema } from '../dist/index.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const householdId = '22222222-2222-4222-8222-222222222222';
const asset = { id, householdId, kind: 'account', label: '합성 계좌', amount: null, asOfDate: null, source: null, legalOwnerLabel: null, note: null };
const payment = { id, kind: 'balance', installment: null, dueDate: null, amount: null, paidAmount: null, paidDate: null };
const plan = { id, householdId, label: '합성 입주', occupancyYear: null, contractStage: null, fundingNote: null, payments: [] };
const valid = (schema, input) => assert.equal(schema.safeParse(input).success, true);
const invalid = (schema, input) => assert.equal(schema.safeParse(input).success, false);

describe('수동 기록 요청 계약', () => {
  it('공유 생략은 private이고 owner·currency·계좌연결 등 미승인 필드는 거부한다', () => {
    assert.equal(manualAssetCreateRequestSchema.parse(asset).visibility, 'private');
    for (const field of ['ownerUserId', 'currency', 'accountId', 'shareRatio', 'expectedVersion']) invalid(manualAssetCreateRequestSchema, { ...asset, [field]: field === 'expectedVersion' ? 1 : id });
  });
  it('금액은 canonical 0 이상 정수 문자열만 받는다', () => {
    for (const amount of ['0', '1', '99999999999999999999']) valid(manualKrwAmountSchema, amount);
    for (const amount of [0, 1, 9007199254740993, '-1', '+1', '1.0', '1e3', '01', ' 1', '1 ', '100000000000000000000', '', 'NaN', null]) invalid(manualKrwAmountSchema, amount);
  });
  it('금액·기준일·manual 출처는 함께 입력하거나 함께 미입력이다', () => {
    valid(manualAssetCreateRequestSchema, asset);
    valid(manualAssetCreateRequestSchema, { ...asset, amount: '0', asOfDate: '2000-01-01', source: 'manual' });
    for (const change of [{ amount: '1' }, { source: 'manual' }, { asOfDate: '2000-01-01' }, { amount: '1', asOfDate: '2000-01-01' }, { amount: '1', source: 'manual' }]) invalid(manualAssetCreateRequestSchema, { ...asset, ...change });
  });
  it('불가능 날짜·연도0·미래 기록일을 거부한다', () => {
    for (const asOfDate of ['1900-02-29', '2026-02-29', '2026-04-31', '0000-01-01', '9999-12-31', '2026-1-01']) invalid(manualAssetCreateRequestSchema, { ...asset, amount: '1', source: 'manual', asOfDate });
    valid(manualAssetCreateRequestSchema, { ...asset, amount: '1', source: 'manual', asOfDate: '2000-02-29' });
  });
  it('서울 기준 오늘은 UTC 날짜와 달라도 허용한다', () => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const today = ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
    valid(manualAssetCreateRequestSchema, { ...asset, amount: '1', asOfDate: today, source: 'manual' });
  });
  it('수정은 expectedVersion과 전체 입력을 요구하고 소유자·가구 변경을 거부한다', () => {
    const { id: _id, householdId: _householdId, ...fields } = asset;
    const update = { ...fields, visibility: 'private', expectedVersion: 1 };
    valid(manualAssetUpdateRequestSchema, update);
    invalid(manualAssetUpdateRequestSchema, { ...update, expectedVersion: 0 });
    invalid(manualAssetUpdateRequestSchema, { ...update, ownerUserId: id });
    invalid(manualAssetUpdateRequestSchema, { ...update, householdId });
    const { note: _note, ...missing } = update;
    invalid(manualAssetUpdateRequestSchema, missing);
  });
  it('가족/개인 이외 scope와 타인 소유자 query를 거부한다', () => {
    assert.equal(manualFinanceListQuerySchema.parse({ householdId }).scope, 'household');
    valid(manualFinanceListQuerySchema, { householdId, scope: 'private' });
    invalid(manualFinanceListQuerySchema, { householdId, scope: 'all' });
    invalid(manualFinanceListQuerySchema, { householdId, ownerUserId: id });
  });
  it('주택 미입력·무지급 계획은 그대로 허용하고 private을 기본으로 둔다', () => {
    const result = manualHousingPlanCreateRequestSchema.parse(plan);
    assert.equal(result.occupancyYear, null); assert.equal(result.visibility, 'private'); assert.deepEqual(result.payments, []);
  });
  it('미입력 표시 문구의 빈 문자열은 null로 보내야 하며 버전은 DB 정수 범위를 따른다', () => {
    invalid(manualAssetCreateRequestSchema, { ...asset, legalOwnerLabel: '   ' });
    invalid(manualAssetCreateRequestSchema, { ...asset, note: '' });
    invalid(manualHousingPlanCreateRequestSchema, { ...plan, contractStage: '' });
    invalid(manualHousingPlanCreateRequestSchema, { ...plan, fundingNote: '   ' });
    invalid(manualFinanceDeleteRequestSchema, { expectedVersion: 2147483648 });
  });
  it('미래 지급 예정일은 허용하지만 미래 실제 지급일은 거부한다', () => {
    valid(manualHousingPaymentInputSchema, { ...payment, dueDate: '9999-12-31' });
    invalid(manualHousingPaymentInputSchema, { ...payment, amount: '10', paidAmount: '1', paidDate: '9999-12-31' });
  });
  it('지급액은 예정액 이하이며 실제 양수 지급에는 지급일이 필요하다', () => {
    valid(manualHousingPaymentInputSchema, { ...payment, amount: '10', paidAmount: '10', paidDate: '2000-01-01' });
    valid(manualHousingPaymentInputSchema, { ...payment, amount: '0', paidAmount: '0' });
    for (const change of [{ paidAmount: '0' }, { amount: '10', paidAmount: '11', paidDate: '2000-01-01' }, { amount: '10', paidAmount: '1' }, { paidDate: '2000-01-01' }, { amount: '10', paidAmount: '0', paidDate: '2000-01-01' }]) invalid(manualHousingPaymentInputSchema, { ...payment, ...change });
  });
  it('잘못된 금액 문자열은 검사 결과 false이며 BigInt 예외를 던지지 않는다', () => {
    for (const value of ['abc', '1.5', '1e6', '-1', '']) assert.doesNotThrow(() => invalid(manualHousingPaymentInputSchema, { ...payment, amount: value, paidAmount: value }));
  });
  it('지급 ID 중복(대소문자 포함)·100개 초과·외부 planId를 거부한다', () => {
    const letterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    invalid(manualHousingPlanCreateRequestSchema, { ...plan, payments: [{ ...payment, id: letterId }, { ...payment, id: letterId.toUpperCase() }] });
    invalid(manualHousingPlanCreateRequestSchema, { ...plan, payments: Array.from({ length: 101 }, () => payment) });
    invalid(manualHousingPaymentInputSchema, { ...payment, planId: id });
  });
  it('주택 변경은 전체 지급 목록·CAS를 요구한다', () => {
    const { id: _id, householdId: _householdId, ...fields } = plan;
    valid(manualHousingPlanUpdateRequestSchema, { ...fields, visibility: 'private', expectedVersion: 1 });
    invalid(manualHousingPlanUpdateRequestSchema, { ...fields, visibility: 'private' });
    invalid(manualHousingPlanUpdateRequestSchema, { label: '이름만', expectedVersion: 1 });
  });
  it('삭제는 양의 expectedVersion만 받는다', () => {
    valid(manualFinanceDeleteRequestSchema, { expectedVersion: 1 });
    invalid(manualFinanceDeleteRequestSchema, {}); invalid(manualFinanceDeleteRequestSchema, { expectedVersion: 0 });
    invalid(manualFinanceDeleteRequestSchema, { expectedVersion: 1, force: true });
  });
});
