import { describe, expect, it } from 'vitest';
import {
  isSujainUnsupportedLayout,
  matchFetchedItems,
  parseSujainRows,
  splitSujainOptionItems,
  type SujainRawRow,
} from './sujain-parse';

describe('sujain parse (synthetic only)', () => {
  it('reads payment and option rows together without inventing missing numbers', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['구분', '회차', '예정금액', '납부예정일', '납부액', '수납일'],
        cells: ['중도금', '2회', '10,000,000', '2026-12-01', '0', ''],
      },
      {
        sourcePage: 'payment',
        headers: ['구분', '회차', '예정금액', '납부예정일', '납부액', '수납일'],
        cells: ['잔금', '', '50,000,000', '2028-03-01', '', ''],
      },
      {
        sourcePage: 'unit-items',
        headers: ['품목', '금액'],
        cells: ['합성 옵션 A', '1,200,000'],
      },
    ]);
    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.kind)).toEqual(['interim', 'balance', 'option']);
    expect(result.items[0]).toMatchObject({
      installment: 2,
      scheduledAmount: '10000000',
      dueDate: '2026-12-01',
      paidAmount: '0',
    });
    expect(result.items[1]?.paidAmount).toBeNull();
    expect(result.items[1]?.dueDate).toBe('2028-03-01');
    expect(result.items[2]).toMatchObject({
      label: '합성 옵션 A',
      scheduledAmount: '1200000',
    });
    expect(JSON.stringify(result)).not.toMatch(/password|비밀번호|SYNTHETIC_SECRET/i);
  });

  it('leaves unknown payment columns empty with a reason', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['항목'],
        cells: ['계약금'],
      },
    ]);
    expect(result.items[0]?.scheduledAmount).toBeNull();
    expect(result.unreadCount).toBeGreaterThan(0);
    expect(result.unreadReasons[0]).toMatch(/예정 금액|칸/);
  });

  it('does not invent a scheduled amount from a numeric-looking cell when headers are missing', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        cells: ['계약금', '12,000,000', '2026-05-01'],
      },
    ]);
    expect(result.items[0]?.scheduledAmount).toBeNull();
    expect(result.items[0]?.dueDate).toBeNull();
    expect(result.items[0]?.unreadFields.some((field) => field.field === 'scheduledAmount')).toBe(true);
  });

  it('does not invent an option label from the first non-numeric cell when name headers are missing', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'unit-items',
        headers: ['비고', '금액'],
        cells: ['합성 추정 금지 품목', '900,000'],
      },
    ]);
    expect(result.items[0]?.label).toBeNull();
    expect(result.items[0]?.scheduledAmount).toBe('900000');
    expect(result.items[0]?.unreadFields.some((field) => field.field === 'label')).toBe(true);
    expect(result.unreadReasons.some((reason) => /옵션 이름/.test(reason))).toBe(true);
  });

  it('prefers the more specific amount header when several synthetic headers match', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['구분', '금액', '예정금액', '납부예정일'],
        cells: ['계약금', '1', '12,000,000', '2026-06-01'],
      },
    ]);
    expect(result.items[0]?.scheduledAmount).toBe('12000000');
  });

  it('does not treat a date header as the amount column when a synthetic amount header follows', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['구분', '납부예정일', '예정금액'],
        cells: ['계약금', '2026-06-01', '12,000,000'],
      },
    ]);
    expect(result.items[0]?.scheduledAmount).toBe('12000000');
    expect(result.items[0]?.dueDate).toBe('2026-06-01');
  });

  it('shows only changed fields for an existing matched record', () => {
    const parsed = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['구분', '회차', '예정금액', '납부예정일', '납부액'],
        cells: ['중도금', '1회', '20,000,000', '2027-01-15', '5,000,000'],
      },
    ]);
    const matched = matchFetchedItems(parsed.items, [
      {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'interim',
        installment: 1,
        label: null,
        amount: '20000000',
        dueDate: '2027-01-15',
        paidAmount: '0',
        paidDate: null,
      },
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.matchedPaymentId).toBe('11111111-1111-4111-8111-111111111111');
    expect(matched[0]?.changedFields).toEqual(['paidAmount']);
  });

  it('drops unchanged existing rows from the confirmation list', () => {
    const parsed = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['구분', '예정금액', '납부예정일', '납부액'],
        cells: ['계약금', '1000', '2026-01-01', '1000'],
      },
    ]);
    const matched = matchFetchedItems(parsed.items, [
      {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'contract',
        installment: null,
        label: null,
        amount: '1000',
        dueDate: '2026-01-01',
        paidAmount: '1000',
        paidDate: null,
      },
    ]);
    expect(matched).toEqual([]);
  });

  it('keeps a matched option whose label matches but whose amount was unread', () => {
    // Existing named option with null amount: scrape finds the same label but cannot
    // map an amount column. That must stay on the confirm list (미확인), not vanish as
    // «unchanged» — otherwise the user sees an empty list after a successful runner.
    const parsed = parseSujainRows([
      {
        sourcePage: 'unit-items',
        headers: ['품목', '비고'],
        cells: ['합성 옵션 라벨', ''],
      },
    ]);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.label).toBe('합성 옵션 라벨');
    expect(parsed.items[0]?.scheduledAmount).toBeNull();
    expect(parsed.items[0]?.unreadFields.some((field) => field.field === 'scheduledAmount')).toBe(true);

    const matched = matchFetchedItems(parsed.items, [
      {
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'option',
        installment: null,
        label: '합성 옵션 라벨',
        amount: null,
        dueDate: null,
        paidAmount: null,
        paidDate: null,
      },
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.matchedPaymentId).toBe('33333333-3333-4333-8333-333333333333');
    expect(matched[0]?.changedFields).toEqual([]);
    expect(matched[0]?.unreadFields.some((field) => field.field === 'scheduledAmount')).toBe(true);
    expect(matched[0]?.scheduledAmount).toBeNull();
  });

  it('does not treat a unit-items member-profile/contact table as options', () => {
    // Name-like headers alone are not enough to call every unit-items table an option list.
    const result = parseSujainRows([
      {
        sourcePage: 'unit-items',
        headers: ['항목', '내용'],
        cells: ['이름', '합성 회원'],
      },
      {
        sourcePage: 'unit-items',
        headers: ['항목', '내용'],
        cells: ['휴대전화', '000-0000-0000'],
      },
      {
        sourcePage: 'unit-items',
        headers: ['항목', '내용'],
        cells: ['주소', '합성 주소'],
      },
      {
        sourcePage: 'unit-items',
        headers: ['항목', '내용'],
        cells: ['이메일', 'synthetic@example.com'],
      },
    ]);
    expect(result.items).toEqual([]);
    expect(result.unreadCount).toBe(0);
    expect(result.unreadReasons).toEqual([]);
    expect(result.eligibleRowCount).toBe(0);
  });

  it('still reads a synthetic option table with 품목 and 금액 on unit-items', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'unit-items',
        headers: ['품목', '금액'],
        cells: ['합성 항목 A', '500,000'],
      },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: 'option',
      label: '합성 항목 A',
      scheduledAmount: '500000',
    });
    expect(result.eligibleRowCount).toBe(1);
  });

  it('does not turn a payment-page contact table into items or kind-unreads', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['항목', '내용'],
        cells: ['이름', '합성 회원'],
      },
      {
        sourcePage: 'payment',
        headers: ['항목', '내용'],
        cells: ['휴대전화', '000-0000-0000'],
      },
      {
        sourcePage: 'payment',
        headers: ['항목', '내용'],
        cells: ['주소', '합성 주소'],
      },
      {
        sourcePage: 'payment',
        headers: ['항목', '내용'],
        cells: ['이메일', 'synthetic@example.com'],
      },
    ]);
    expect(result.items).toEqual([]);
    expect(result.unreadCount).toBe(0);
    expect(result.unreadReasons.some((reason) => /계약금·중도금·잔금·옵션/.test(reason))).toBe(false);
    expect(result.eligibleRowCount).toBe(0);
  });

  it('marks junk-only scrape rows as an unsupported layout (no silent empty success)', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['이름'],
        cells: ['합성 회원'],
      },
      {
        sourcePage: 'unit-items',
        headers: ['항목', '내용'],
        cells: ['이메일', 'synthetic@example.com'],
      },
    ]);
    expect(result.items).toEqual([]);
    expect(result.eligibleRowCount).toBe(0);
    expect(isSujainUnsupportedLayout(result)).toBe(true);
  });

  it('does not treat a readable option scrape as unsupported layout', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'unit-items',
        headers: ['품목', '금액'],
        cells: ['합성 항목 A', '1'],
      },
    ]);
    expect(isSujainUnsupportedLayout(result)).toBe(false);
  });

  it('maps live 분양대금 headers 약정금액/납부원금/실납부금/약정일자/납부일자', () => {
    // Kind text is synthetic cell content for detectKind only — not inventing 회차→계약금.
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['회차', '약정일자', '약정금액', '납부일자', '납부원금', '연체료', '할인료', '실납부금'],
        cells: ['계약금', '2026-06-01', '10,000,000', '2026-06-02', '9,000,000', '0', '0', '9,000,000'],
      },
    ]);
    expect(result.eligibleRowCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: 'contract',
      scheduledAmount: '10000000',
      dueDate: '2026-06-01',
      paidAmount: '9000000',
      paidDate: '2026-06-02',
      actualPaidDate: '2026-06-02',
    });
  });

  it('does not invent kind from 회차 alone on a live-shaped payment row', () => {
    const result = parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['회차', '약정일자', '약정금액', '납부일자', '납부원금', '연체료', '할인료', '실납부금'],
        cells: ['1', '2026-06-01', '10,000,000', '2026-06-02', '9,000,000', '0', '0', '9,000,000'],
      },
    ]);
    expect(result.eligibleRowCount).toBe(1);
    expect(result.items).toEqual([]);
    expect(result.unreadReasons.some((reason) => /계약금·중도금·잔금·옵션/.test(reason))).toBe(true);
  });

  it('keeps 이름* contact rows ineligible', () => {
    expect(parseSujainRows([
      {
        sourcePage: 'payment',
        headers: ['이름*'],
        cells: ['합성 회원'],
      },
    ]).eligibleRowCount).toBe(0);
  });
});

describe('sujain parse — confirmed 분양대금조회 tables (synthetic values)', () => {
  const HEADERS = ['회차', '약정일자', '약정금액', '납부일자', '납부원금', '연체료', '할인료', '실납부금'];
  const pay = (cells: string[]): SujainRawRow => ({ sourcePage: 'payment', section: 'payment', headers: HEADERS, cells });
  const opt = (itemLabel: string, cells: string[]): SujainRawRow => ({
    sourcePage: 'payment',
    section: 'option',
    itemLabel,
    headers: HEADERS,
    cells,
  });
  const OPTION_A = '합성 발코니 확장, [합성벽체]-침실2.3 분리형, [합성공기청정기]-미선택';
  const OPTION_B = '[합성에어컨]-거실,침실1,2,3(4개소)-합성전자, [합성가전]합성 냉장고';
  const optionRows = (label: string, first: string) => [
    opt(label, [first, '2024-01-10', '100,000', '2024-01-10', '100,000', '0', '0', '100,000']),
    opt(label, ['중도금', '2025-01-10', '200,000', '', '0', '0', '0', '0']),
    opt(label, ['잔금', '2027-03-31', '700,000', '', '0', '0', '0', '0']),
    opt(label, ['계', '', '1,000,000', '', '100,000', '0', '0', '100,000']),
  ];
  const liveRows = (): SujainRawRow[] => [
    pay(['계약금1차', '2024-01-10', '1,000,000', '2024-01-10', '1,000,000', '0', '0', '1,000,000']),
    pay(['계약금2차', '2024-02-10', '2,000,000', '2024-02-09', '2,000,000', '0', '0', '2,000,000']),
    ...[1, 2, 3, 4, 5, 6].map((n) => pay([
      `중도금${n}차`, `2024-0${n + 2}-15`, '3,000,000', `2024-0${n + 2}-14`, '3,000,000', '0', '0', '3,000,000',
    ])),
    pay(['잔금', '2027-03-31', '9,000,000', '', '0', '0', '0', '0']),
    pay(['계', '', '30,000,000', '', '21,000,000', '0', '0', '21,000,000']),
    ...optionRows(OPTION_A, '계약금'),
    ...optionRows(OPTION_B, '계약금1차'),
  ];

  it('reads 계약금1·2차, 중도금1~6차, 잔금 with installments and skips the 계 total silently', () => {
    const result = parseSujainRows(liveRows());
    expect(result.unreadCount).toBe(0);
    expect(result.unreadReasons).toEqual([]);
    const apartment = result.items.filter((item) => item.kind !== 'option');
    expect(apartment.map((item) => [item.kind, item.installment])).toEqual([
      ['contract', 1],
      ['contract', 2],
      ['interim', 1],
      ['interim', 2],
      ['interim', 3],
      ['interim', 4],
      ['interim', 5],
      ['interim', 6],
      ['balance', null],
    ]);
    expect(apartment[1]).toMatchObject({
      scheduledAmount: '2000000',
      dueDate: '2024-02-10',
      paidAmount: '2000000',
      paidDate: '2024-02-09',
      actualPaidDate: '2024-02-09',
      label: null,
    });
    expect(apartment[4]).toMatchObject({ scheduledAmount: '3000000', dueDate: '2024-05-15', paidDate: '2024-05-14' });
    // 합계 줄은 항목도 unread 도 아니다.
    expect(result.items.some((item) => (
      item.scheduledAmount === '30000000'
      || (item.kind === 'option' && item.scheduledAmount === '1000000')
    ))).toBe(false);
  });

  it('keeps the unpaid 잔금 as 0 paid with a null paid date (0 is not unknown)', () => {
    const balance = parseSujainRows(liveRows()).items.find((item) => item.kind === 'balance');
    expect(balance).toMatchObject({
      scheduledAmount: '9000000',
      dueDate: '2027-03-31',
      paidAmount: '0',
      paidDate: null,
      actualPaidDate: null,
      unreadFields: [],
    });
  });

  it('turns 별도 계약 품목 rows into options labelled «short title · row name», never apartment kinds', () => {
    const options = parseSujainRows(liveRows()).items.filter((item) => item.kind === 'option');
    expect(options.map((item) => item.label)).toEqual([
      '합성 발코니 확장 외 2 · 계약금',
      '합성 발코니 확장 외 2 · 중도금',
      '합성 발코니 확장 외 2 · 잔금',
      '[합성에어컨]-거실,침실1,2,3(4개소)-합성전자 외 1 · 계약금1차',
      '[합성에어컨]-거실,침실1,2,3(4개소)-합성전자 외 1 · 중도금',
      '[합성에어컨]-거실,침실1,2,3(4개소)-합성전자 외 1 · 잔금',
    ]);
    expect(options.every((item) => item.installment === null && item.unreadFields.length === 0)).toBe(true);
    expect(options[0]).toMatchObject({ scheduledAmount: '100000', dueDate: '2024-01-10', paidAmount: '100000', paidDate: '2024-01-10' });
    expect(options[1]).toMatchObject({ scheduledAmount: '200000', paidAmount: '0', paidDate: null });
    // 같은 글자 → 같은 이름(다시 조회해도 matchFetchedItems 가 맞출 수 있다).
    expect(parseSujainRows(liveRows()).items.map((item) => item.label))
      .toEqual(parseSujainRows(liveRows()).items.map((item) => item.label));
  });

  it('splits option item lists only on top-level separators', () => {
    expect(splitSujainOptionItems(OPTION_A)).toEqual([
      '합성 발코니 확장',
      '[합성벽체]-침실2.3 분리형',
      '[합성공기청정기]-미선택',
    ]);
    expect(splitSujainOptionItems(OPTION_B)).toEqual([
      '[합성에어컨]-거실,침실1,2,3(4개소)-합성전자',
      '[합성가전]합성 냉장고',
    ]);
    expect(splitSujainOptionItems('[합성, 분류]합성 품목(가, 나), 합성 둘째,[합성셋]째')).toEqual([
      '[합성, 분류]합성 품목(가, 나)',
      '합성 둘째',
      '[합성셋]째',
    ]);
    expect(splitSujainOptionItems('  ')).toEqual([]);
  });

  it('caps option labels at 100 characters without cutting « 외 N» or the row name', () => {
    const long = `${'가'.repeat(150)}, 합성 둘째`;
    const [item] = parseSujainRows([opt(long, ['계약금', '2024-01-10', '100,000', '', '0', '0', '0', '0'])]).items;
    expect(item?.label?.length).toBe(100);
    expect(item?.label?.endsWith(' 외 1 · 계약금')).toBe(true);
  });

  it('uses a generic title and notes the label when the option item list is missing', () => {
    const result = parseSujainRows([{
      sourcePage: 'payment',
      section: 'option',
      headers: HEADERS,
      cells: ['잔금', '2027-03-31', '700,000', '', '0', '0', '0', '0'],
    }]);
    expect(result.items[0]).toMatchObject({ kind: 'option', label: '별도 계약 품목 · 잔금', scheduledAmount: '700000' });
    expect(result.items[0]?.unreadFields.map((field) => field.field)).toEqual(['label']);
  });

  it('picks the kind from the row name even when an old runner mixed a row name into the headers', () => {
    const result = parseSujainRows([{
      sourcePage: 'payment',
      headers: [...HEADERS, '계약금1차'],
      cells: ['중도금3차', '2024-05-15', '3,000,000', '2024-05-14', '3,000,000', '0', '0', '3,000,000'],
    }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'interim', installment: 3, scheduledAmount: '3000000' });
  });

  it('treats rows without a section (older runner) as apartment payments', () => {
    const result = parseSujainRows([{
      sourcePage: 'payment',
      headers: HEADERS,
      cells: ['잔금', '2027-03-31', '9,000,000', '', '0', '0', '0', '0'],
    }]);
    expect(result.items[0]).toMatchObject({ kind: 'balance', scheduledAmount: '9000000' });
  });

  it('matches contract rows by installment when both sides have one', () => {
    const parsed = parseSujainRows(liveRows().slice(0, 2));
    const matched = matchFetchedItems(parsed.items, [
      {
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'contract',
        installment: 2,
        label: null,
        amount: '2000000',
        dueDate: '2024-02-10',
        paidAmount: '2000000',
        paidDate: '2024-02-09',
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        kind: 'contract',
        installment: 1,
        label: null,
        amount: '1000000',
        dueDate: '2024-01-10',
        paidAmount: '0',
        paidDate: null,
      },
    ]);
    // 계약금2차는 2회차 일정과 같아 빠지고, 계약금1차만 1회차 일정에 맞춰 낸 금액·날짜가 바뀐다.
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({
      installment: 1,
      matchedPaymentId: '55555555-5555-4555-8555-555555555555',
      changedFields: ['paidAmount', 'paidDate', 'actualPaidDate'],
    });
  });

  it('still matches a contract to an existing one without an installment', () => {
    const parsed = parseSujainRows(liveRows().slice(0, 1));
    const matched = matchFetchedItems(parsed.items, [{
      id: '66666666-6666-4666-8666-666666666666',
      kind: 'contract',
      installment: null,
      label: null,
      amount: '1000000',
      dueDate: '2024-01-10',
      paidAmount: '1000000',
      paidDate: '2024-01-10',
    }]);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.matchedPaymentId).toBe('66666666-6666-4666-8666-666666666666');
    expect(matched[0]?.changedFields).toEqual(['installment']);
  });

  it('prefers the same contract installment before falling back to one without an installment', () => {
    const parsed = parseSujainRows(liveRows().slice(0, 2));
    const matched = matchFetchedItems(parsed.items, [
      {
        id: '88888888-8888-4888-8888-888888888888',
        kind: 'contract',
        installment: null,
        label: null,
        amount: '2000000',
        dueDate: '2024-02-10',
        paidAmount: '2000000',
        paidDate: '2024-02-09',
      },
      {
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'contract',
        installment: 1,
        label: null,
        amount: '1000000',
        dueDate: '2024-01-10',
        paidAmount: '0',
        paidDate: null,
      },
    ]);
    // 앞의 회차 없는 일정이 계약금1차를 먼저 가져가면 1회차 일정이 갱신되지 않고 1회차가 두 줄 생긴다.
    expect(matched.map((item) => [item.installment, item.matchedPaymentId, item.changedFields])).toEqual([
      [1, '99999999-9999-4999-8999-999999999999', ['paidAmount', 'paidDate', 'actualPaidDate']],
      [2, '88888888-8888-4888-8888-888888888888', ['installment']],
    ]);
  });

  it('drops unchanged options on a re-fetch because the labels are stable', () => {
    const first = parseSujainRows(liveRows()).items;
    const existing = first.map((item, index) => ({
      id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
      kind: item.kind,
      installment: item.installment,
      label: item.label,
      amount: item.scheduledAmount,
      dueDate: item.dueDate,
      paidAmount: item.paidAmount,
      paidDate: item.paidDate,
    }));
    expect(matchFetchedItems(parseSujainRows(liveRows()).items, existing)).toEqual([]);
  });
});
