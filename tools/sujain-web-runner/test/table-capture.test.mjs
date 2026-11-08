import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSujainTables } from '../table-capture.mjs';
import { isEligibleSujainCapturedRow } from '../collect.mjs';
import { formatLayoutWarnFragment, sanitizePageLayoutDiagnostic } from '../policy.mjs';
import {
  SUJAIN_PAYMENT_HEADERS,
  fakeDocument,
  h,
  sujainContactLayer,
  sujainPaymentDocument,
  sujainTable,
} from './fake-dom.mjs';

const EMPTY_OUTSIDE = {
  visibleInput: 0,
  visibleSelect: 0,
  visibleTextarea: 0,
  hidden: 0,
  other: 0,
};

/**
 * Fake DOM helpers (test/fake-dom.mjs) — tHead/tBodies/rows/cells like a real
 * HTMLTableElement. All values are synthetic.
 */
function control(tagName, attrs = {}) {
  return h(tagName, {
    id: attrs.id,
    name: attrs.name,
    type: attrs.type,
    value: attrs.value,
    hidden: attrs.hidden === true,
    style: attrs.style,
    options: attrs.options,
    selectedIndex: attrs.selectedIndex,
    className: attrs.class,
    attrs,
  });
}

function cell(children, textContent = '') {
  return h('td', { text: textContent }, Array.isArray(children) ? children : []);
}

function row(cells) {
  return h('tr', {}, cells);
}

/** thead th 머리 + tbody 줄. extraControls 는 tfoot 에 넣어 칸 글자 없이 표 안 폼 수에만 잡힌다. */
function table({ headers = [], bodyRows = [], extraControls = [] }) {
  const children = [];
  if (headers.length > 0) {
    children.push(h('thead', {}, [h('tr', {}, headers.map((text) => h('th', { text })))]));
  }
  children.push(h('tbody', {}, bodyRows));
  if (extraControls.length > 0) {
    children.push(h('tfoot', {}, [h('tr', {}, [h('td', {}, extraControls)])]));
  }
  return h('table', {}, children);
}

function iframe(src) {
  const el = h('iframe', { attrs: { src } });
  el.src = src;
  return el;
}

function doc(tables, { outsideControls = [], iframes = [] } = {}) {
  return fakeDocument([...tables, ...outsideControls, ...iframes]);
}

test('회차/약정금액 table with amounts in inputs is captured and eligible', () => {
  const paymentHeaders = ['회차', '약정일자', '약정금액', '납부일자', '납부원금', '연체료', '할인료', '실납부금'];
  const paymentTable = table({
    headers: paymentHeaders,
    bodyRows: [
      row([
        cell([control('INPUT', { value: '1' })]),
        cell([control('INPUT', { value: '2026-06-01' })]),
        cell([control('INPUT', { value: '10000000' })]),
        cell([control('INPUT', { value: '2026-06-02' })]),
        cell([control('INPUT', { value: '9000000' })]),
        cell([control('INPUT', { value: '0' })]),
        cell([control('INPUT', { value: '0' })]),
        cell([control('INPUT', { value: '9000000' })]),
      ]),
    ],
  });
  const captured = captureSujainTables('payment', doc([paymentTable]));
  assert.equal(captured.tableCount, 1);
  assert.deepEqual(captured.tableHeaders[0], paymentHeaders);
  assert.equal(captured.rows.length, 1);
  // thead 줄은 본문 후보가 아니다: tbody 1줄 = preSkip 1.
  assert.deepEqual(captured.tables, [{ rawRowCount: 1, preSkipRowCount: 1, formControlCount: 8 }]);
  assert.equal(captured.outsideTableFormControlCount, 0);
  assert.deepEqual(captured.outsideTableFormControls, EMPTY_OUTSIDE);
  assert.equal(captured.iframeCount, 0);
  assert.deepEqual(captured.iframePaths, []);
  assert.equal(isEligibleSujainCapturedRow(captured.rows[0]), true);
  assert.equal(captured.rows[0].cells[2], '10000000');
  assert.equal(captured.rows[0].cells[0], '1');
  assert.equal(captured.rows[0].section, 'payment');
  assert.equal(Object.hasOwn(captured.rows[0], 'itemLabel'), false);
});

test('이름* contact table with synthetic text cells remains ineligible', () => {
  const contactTable = table({
    headers: ['이름*'],
    bodyRows: [
      row([cell([], '합성 회원')]),
      row([cell([], '000-0000-0000')]),
      row([cell([], '합성 주소')]),
      row([cell([], 'synthetic@example.com')]),
    ],
  });
  const captured = captureSujainTables('payment', doc([contactTable]));
  assert.equal(captured.rows.length, 4);
  assert.equal(captured.rows.every((rowItem) => !isEligibleSujainCapturedRow(rowItem)), true);
  assert.deepEqual(captured.tables, [{ rawRowCount: 4, preSkipRowCount: 4, formControlCount: 0 }]);
});

test('layout diagnostics include per-table counts and never cell or input values', () => {
  const paymentHeaders = ['회차', '약정일자', '약정금액', '납부일자', '납부원금', '연체료', '할인료', '실납부금'];
  const paymentTable = table({
    headers: paymentHeaders,
    bodyRows: [
      row(paymentHeaders.map(() => cell([control('INPUT', { value: 'SYNTHETIC_SECRET_AMOUNT' })]))),
    ],
  });
  const contactTable = table({
    headers: ['이름*'],
    bodyRows: [
      row([cell([], '합성 회원')]),
      row([cell([], '000-0000-0000')]),
      row([cell([], '합성 주소')]),
      row([cell([], 'synthetic@example.com')]),
    ],
  });
  const captured = captureSujainTables('payment', doc([paymentTable, contactTable]));
  const layout = sanitizePageLayoutDiagnostic({
    sourcePage: 'payment',
    tableCount: captured.tableCount,
    tableHeaders: captured.tableHeaders,
    rawRowCount: captured.rows.length,
    eligibleRowCount: captured.rows.filter(isEligibleSujainCapturedRow).length,
    tables: captured.tables,
    outsideTableFormControlCount: captured.outsideTableFormControlCount,
    outsideTableFormControls: captured.outsideTableFormControls,
    iframeCount: captured.iframeCount,
    iframePaths: captured.iframePaths,
    pagePath: 'https://www.sujain.co.kr/mypage/payment?session=SECRET_TOKEN#top',
    cells: captured.rows.flatMap((r) => r.cells),
  });
  assert.ok(layout);
  assert.deepEqual(layout.tables, [
    { rawRowCount: 1, preSkipRowCount: 1, formControlCount: 8 },
    { rawRowCount: 4, preSkipRowCount: 4, formControlCount: 0 },
  ]);
  assert.deepEqual(layout.outsideTableFormControls, EMPTY_OUTSIDE);
  assert.equal(layout.pagePath, 'https://www.sujain.co.kr/mypage/payment');
  const text = JSON.stringify(layout);
  const fragment = formatLayoutWarnFragment({ payment: layout });
  for (const leak of [
    'SYNTHETIC_SECRET_AMOUNT',
    '합성 회원',
    '000-0000-0000',
    '합성 주소',
    'synthetic@example.com',
    'SECRET_TOKEN',
    '?session=',
  ]) {
    assert.equal(text.includes(leak), false, `layout JSON leaked ${leak}`);
    assert.equal(fragment.includes(leak), false, `warn fragment leaked ${leak}`);
  }
  assert.match(
    fragment,
    /payment:t=2;searched=0;units=0;h=\[회차\|약정일자\|약정금액\|납부일자\|납부원금\|연체료\|할인료\|실납부금\],\[이름\*\];raw=5;eligible=1;tables=\[r=1,p=1,i=8\],\[r=4,p=4,i=0\];out=0\[vi=0,vs=0,vt=0,h=0,o=0\];ifr=0;path=https:\/\/www\.sujain\.co\.kr\/mypage\/payment/,
  );
});

test('password and hidden inputs are not used as cell text', () => {
  const mixed = table({
    headers: ['회차', '약정금액', '비밀'],
    bodyRows: [
      row([
        cell([control('INPUT', { type: 'text', value: '1' })]),
        cell([
          control('INPUT', { type: 'hidden', value: 'HIDDEN_SYNTHETIC' }),
          control('INPUT', { type: 'password', value: 'PASSWORD_SYNTHETIC' }),
          control('INPUT', { type: 'text', value: '5000000' }),
        ]),
        cell([
          control('INPUT', { id: 'pw', type: 'text', value: 'LOGIN_PW_SYNTHETIC' }),
          control('INPUT', { id: 'id', type: 'text', value: 'LOGIN_ID_SYNTHETIC' }),
        ]),
      ]),
    ],
  });
  const captured = captureSujainTables('payment', doc([mixed]));
  assert.equal(captured.rows.length, 1);
  assert.equal(captured.rows[0].cells[0], '1');
  assert.equal(captured.rows[0].cells[1], '5000000');
  assert.equal(captured.rows[0].cells[2], '');
  const joined = captured.rows[0].cells.join('|');
  assert.equal(joined.includes('HIDDEN_SYNTHETIC'), false);
  assert.equal(joined.includes('PASSWORD_SYNTHETIC'), false);
  assert.equal(joined.includes('LOGIN_PW_SYNTHETIC'), false);
  assert.equal(joined.includes('LOGIN_ID_SYNTHETIC'), false);
  // formControlCount counts all controls in the table, including skipped ones.
  assert.equal(captured.tables[0].formControlCount, 6);
});

test('visible textContent wins over nested input values', () => {
  const t = table({
    headers: ['약정금액'],
    bodyRows: [
      row([cell([control('INPUT', { value: '999' })], '12,000,000')]),
    ],
  });
  const captured = captureSujainTables('payment', doc([t]));
  assert.equal(captured.rows[0].cells[0], '12,000,000');
});

test('empty payment table with inputs still reports formControlCount for diagnostics', () => {
  // Hypothesis 2 visibility: headers + input counts with zero captured rows.
  const emptyBody = table({
    headers: ['회차', '약정금액'],
    bodyRows: [],
    extraControls: [
      control('INPUT', { value: 'should-not-matter' }),
      control('INPUT', { value: 'also-ignored-for-values' }),
    ],
  });
  // Attach extra controls onto the table's form-control query only (no body cells).
  const captured = captureSujainTables('payment', doc([emptyBody]));
  assert.equal(captured.rows.length, 0);
  assert.deepEqual(captured.tableHeaders[0], ['회차', '약정금액']);
  // 빈 tbody: preSkip 0, raw 0 — 폼 수만 진단에 남는다.
  assert.deepEqual(captured.tables, [{ rawRowCount: 0, preSkipRowCount: 0, formControlCount: 2 }]);
});

test('preSkipRowCount keeps empty-cell rows that rawRowCount drops', () => {
  const paymentTable = table({
    headers: ['회차', '약정금액'],
    bodyRows: [
      row([cell([], ''), cell([], '')]),
      row([cell([], ''), cell([], '')]),
    ],
  });
  const captured = captureSujainTables('payment', doc([paymentTable]));
  assert.equal(captured.rows.length, 0);
  // 2 empty tbody rows counted before skip; raw stays 0.
  assert.deepEqual(captured.tables, [{ rawRowCount: 0, preSkipRowCount: 2, formControlCount: 0 }]);
});

test('outside-table form controls and iframe paths are counted without values or query strings', () => {
  const paymentTable = table({
    headers: ['회차', '약정금액'],
    bodyRows: [],
  });
  const outside = [
    control('INPUT', { value: 'OUTSIDE_SHOULD_NOT_APPEAR' }),
    control('SELECT', { value: 'also-secret' }),
    control('TEXTAREA', { value: 'still-secret' }),
  ];
  const frames = [
    iframe('https://www.sujain.co.kr/embed/unit?token=SESSION_SECRET#frag'),
    iframe('/mypage/picker?x=1'),
  ];
  const captured = captureSujainTables(
    'payment',
    doc([paymentTable], { outsideControls: outside, iframes: frames }),
  );
  assert.equal(captured.outsideTableFormControlCount, 3);
  assert.deepEqual(captured.outsideTableFormControls, {
    visibleInput: 1,
    visibleSelect: 1,
    visibleTextarea: 1,
    hidden: 0,
    other: 0,
  });
  assert.equal(captured.iframeCount, 2);
  assert.deepEqual(captured.iframePaths, [
    'https://www.sujain.co.kr/embed/unit',
    '/mypage/picker',
  ]);
  const serialized = JSON.stringify(captured.iframePaths);
  assert.equal(serialized.includes('SESSION_SECRET'), false);
  assert.equal(serialized.includes('?'), false);
  assert.equal(serialized.includes('OUTSIDE_SHOULD_NOT_APPEAR'), false);
  // Capture rows never include outside control values.
  assert.equal(JSON.stringify(captured.rows).includes('OUTSIDE_SHOULD_NOT_APPEAR'), false);
});

test('outside-table breakdown splits visibility and kind without leaking attributes or values (synthetic)', () => {
  // Synthetic HTML only — not live sujain markup.
  const paymentTable = table({
    headers: ['회차', '약정금액'],
    bodyRows: [],
  });
  const outside = [
    control('INPUT', {
      type: 'text',
      name: 'unitPickerName_LEAK',
      id: 'unitPickerId_LEAK',
      value: 'UNIT_VALUE_LEAK',
      placeholder: 'PLACEHOLDER_LEAK',
      'aria-label': 'ARIA_LEAK',
      class: 'class-leak',
    }),
    control('INPUT', { type: 'number', value: '42_LEAK' }),
    control('SELECT', {
      name: 'selectName_LEAK',
      value: 'opt-secret',
      options: [{ textContent: 'OPTION_LABEL_LEAK', value: 'v1' }],
      selectedIndex: 0,
    }),
    control('TEXTAREA', { name: 'notes_LEAK', value: 'TEXTAREA_VALUE_LEAK' }),
    control('INPUT', { type: 'hidden', name: 'csrf_LEAK', value: 'HIDDEN_TOKEN_LEAK' }),
    control('INPUT', { type: 'text', hidden: true, value: 'ATTR_HIDDEN_LEAK' }),
    control('INPUT', { type: 'text', style: { display: 'none' }, value: 'DISPLAY_NONE_LEAK' }),
    control('INPUT', { type: 'text', style: { visibility: 'hidden' }, value: 'VIS_HIDDEN_LEAK' }),
    control('INPUT', { type: 'password', name: 'pw_LEAK', value: 'PASSWORD_LEAK' }),
    control('INPUT', { type: 'submit', value: 'SUBMIT_LEAK' }),
    control('INPUT', { type: 'checkbox', name: 'agree_LEAK', value: 'yes' }),
    control('INPUT', { type: 'file', name: 'upload_LEAK' }),
  ];
  const captured = captureSujainTables(
    'payment',
    doc([paymentTable], { outsideControls: outside }),
  );
  assert.equal(captured.outsideTableFormControlCount, 12);
  assert.deepEqual(captured.outsideTableFormControls, {
    visibleInput: 2,
    visibleSelect: 1,
    visibleTextarea: 1,
    hidden: 4,
    other: 4,
  });
  const sum = Object.values(captured.outsideTableFormControls).reduce((a, b) => a + b, 0);
  assert.equal(sum, captured.outsideTableFormControlCount);

  const layout = sanitizePageLayoutDiagnostic({
    sourcePage: 'payment',
    tableCount: captured.tableCount,
    tableHeaders: captured.tableHeaders,
    rawRowCount: 0,
    eligibleRowCount: 0,
    tables: captured.tables,
    outsideTableFormControlCount: captured.outsideTableFormControlCount,
    outsideTableFormControls: captured.outsideTableFormControls,
    iframeCount: 0,
    iframePaths: [],
    pagePath: 'https://www.sujain.co.kr/mypage/payment',
  });
  assert.ok(layout);
  const text = JSON.stringify(layout);
  const fragment = formatLayoutWarnFragment({ payment: layout });
  assert.match(
    fragment,
    /out=12\[vi=2,vs=1,vt=1,h=4,o=4\]/,
  );
  for (const leak of [
    'UNIT_VALUE_LEAK',
    'unitPickerName_LEAK',
    'unitPickerId_LEAK',
    'PLACEHOLDER_LEAK',
    'ARIA_LEAK',
    'class-leak',
    '42_LEAK',
    'selectName_LEAK',
    'OPTION_LABEL_LEAK',
    'opt-secret',
    'notes_LEAK',
    'TEXTAREA_VALUE_LEAK',
    'csrf_LEAK',
    'HIDDEN_TOKEN_LEAK',
    'ATTR_HIDDEN_LEAK',
    'DISPLAY_NONE_LEAK',
    'VIS_HIDDEN_LEAK',
    'pw_LEAK',
    'PASSWORD_LEAK',
    'SUBMIT_LEAK',
    'agree_LEAK',
    'upload_LEAK',
    'password',
    'checkbox',
    'submit',
  ]) {
    assert.equal(text.includes(leak), false, `layout JSON leaked ${leak}`);
    assert.equal(fragment.includes(leak), false, `warn fragment leaked ${leak}`);
  }
  // Password is never treated as a visible data field.
  assert.equal(layout.outsideTableFormControls.visibleInput >= 0, true);
  assert.equal(layout.outsideTableFormControls.other >= 1, true);
});

// ── 확인된 분양대금조회 화면 구조(2026-11-08)를 흉내 낸 가짜 문서 ──

const PAYMENT_ROWS = [
  ['계약금1차', '2024-01-10', '1,000,000', '2024-01-10', '1,000,000', '0', '0', '1,000,000'],
  ['계약금2차', '2024-02-10', '2,000,000', '2024-02-09', '2,000,000', '0', '0', '2,000,000'],
  ['중도금1차', '2024-06-10', '3,000,000', '2024-06-10', '3,000,000', '0', '0', '3,000,000'],
  ['잔금', '2027-03-31', '9,000,000', '', '0', '0', '0', '0'],
  ['계', '', '15,000,000', '', '6,000,000', '0', '0', '6,000,000'],
];
const OPTION_A_LABEL = '합성 발코니 확장, [합성벽체]-침실2.3 분리형, [합성공기청정기]-미선택';
const OPTION_B_LABEL = '[합성에어컨]-거실,침실1,2(3개소)-합성전자, [합성가전]합성 냉장고';
const OPTION_ROWS = [
  ['계약금', '2024-01-10', '100,000', '2024-01-10', '100,000', '0', '0', '100,000'],
  ['잔금', '2027-03-31', '900,000', '', '0', '0', '0', '0'],
  ['계', '', '1,000,000', '', '100,000', '0', '0', '100,000'],
];

test('after search: reads three visible st1 tables, skips empty tr, keeps th 회차 names, 8 headers, section and itemLabel', () => {
  const captured = captureSujainTables('payment', sujainPaymentDocument({
    searched: true,
    paymentRows: PAYMENT_ROWS,
    options: [
      { itemLabel: OPTION_A_LABEL, rows: OPTION_ROWS },
      { itemLabel: OPTION_B_LABEL, rows: OPTION_ROWS },
    ],
  }));
  // 숨은 연락처 표까지 센 전체 표 수 4, 읽은(보이는) 표 3.
  assert.equal(captured.tableCount, 4);
  assert.equal(captured.tableHeaders.length, 3);
  for (const headers of captured.tableHeaders) assert.deepEqual(headers, SUJAIN_PAYMENT_HEADERS);
  // 데이터 줄과 빈 tr 이 번갈아: preSkip = 2×데이터, raw = 데이터.
  assert.deepEqual(captured.tables, [
    { rawRowCount: 5, preSkipRowCount: 10, formControlCount: 0 },
    { rawRowCount: 3, preSkipRowCount: 6, formControlCount: 0 },
    { rawRowCount: 3, preSkipRowCount: 6, formControlCount: 0 },
  ]);

  const payment = captured.rows.filter((r) => r.section === 'payment');
  const option = captured.rows.filter((r) => r.section === 'option');
  assert.equal(payment.length, 5);
  assert.equal(option.length, 6);
  assert.deepEqual(payment.map((r) => r.cells[0]), ['계약금1차', '계약금2차', '중도금1차', '잔금', '계']);
  for (const r of captured.rows) {
    assert.equal(r.cells.length, 8);
    assert.equal(r.headers.length, 8);
    assert.equal(r.sourcePage, 'payment');
    assert.equal(isEligibleSujainCapturedRow(r), true);
  }
  assert.equal(payment.some((r) => Object.hasOwn(r, 'itemLabel')), false);
  assert.deepEqual(option.slice(0, 3).map((r) => r.itemLabel), [OPTION_A_LABEL, OPTION_A_LABEL, OPTION_A_LABEL]);
  assert.deepEqual(option.slice(3).map((r) => r.itemLabel), [OPTION_B_LABEL, OPTION_B_LABEL, OPTION_B_LABEL]);
  // 안 낸 잔금: 납부일자 빈 칸 그대로.
  assert.equal(payment[3].cells[3], '');
  // 숨은 연락처 표 값은 읽지 않는다.
  const serialized = JSON.stringify(captured.rows);
  for (const leak of ['합성 회원', '000-0000-0000', '합성 주소', 'synthetic@example.com', '이름*']) {
    assert.equal(serialized.includes(leak), false, `rows leaked ${leak}`);
  }
});

test('before search: hidden #paymentDiv with empty tbody yields no rows (wait keeps polling)', () => {
  const captured = captureSujainTables('payment', sujainPaymentDocument({ searched: false }));
  assert.equal(captured.rows.length, 0);
  assert.equal(captured.tableCount, 2);
  // 숨은 표는 머리도 진단에 올리지 않는다.
  assert.deepEqual(captured.tableHeaders, []);
  // 표 밖 단지 select 는 개수만.
  assert.equal(captured.outsideTableFormControls.visibleSelect, 1);
});

test('without thead, the first row is a header only when every cell is th', () => {
  const allTh = h('table', {}, [
    h('tbody', {}, [
      h('tr', {}, [h('th', { text: '회차' }), h('th', { text: '약정금액' })]),
      h('tr', {}, [h('th', { text: '중도금2차' }), h('td', { text: '5,000,000' })]),
    ]),
  ]);
  const mixed = h('table', {}, [
    h('tbody', {}, [
      h('tr', {}, [h('th', { text: '중도금3차' }), h('td', { text: '6,000,000' })]),
    ]),
  ]);
  const captured = captureSujainTables('payment', fakeDocument([allTh, mixed]));
  assert.deepEqual(captured.tableHeaders, [['회차', '약정금액'], []]);
  assert.deepEqual(captured.rows.map((r) => r.cells), [['중도금2차', '5,000,000'], ['중도금3차', '6,000,000']]);
  assert.deepEqual(captured.rows[0].headers, ['회차', '약정금액']);
  assert.deepEqual(captured.tables, [
    { rawRowCount: 1, preSkipRowCount: 1, formControlCount: 0 },
    { rawRowCount: 1, preSkipRowCount: 1, formControlCount: 0 },
  ]);
});

test('thead row never becomes a data row and body th 회차 name never joins the headers', () => {
  const t = sujainTable('아파트 분양대금', [PAYMENT_ROWS[0]], { emptyRowsBetween: false });
  const captured = captureSujainTables('payment', fakeDocument([t]));
  assert.deepEqual(captured.tableHeaders, [SUJAIN_PAYMENT_HEADERS]);
  assert.equal(captured.rows.length, 1);
  assert.equal(captured.rows[0].cells[0], '계약금1차');
  assert.equal(captured.rows[0].headers.includes('계약금1차'), false);
});

test('section falls back to the nearest preceding h_tit_wrap when caption is missing; unknown stays payment', () => {
  const noCaption = (rows) => h('table', {}, [
    h('thead', {}, [h('tr', {}, SUJAIN_PAYMENT_HEADERS.map((text) => h('th', { text })))]),
    h('tbody', {}, rows.map(([name, ...rest]) => h('tr', {}, [h('th', { text: name }), ...rest.map((v) => h('td', { text: v }))]))),
  ]);
  const captured = captureSujainTables('payment', fakeDocument([
    h('div', { className: 'h_tit_wrap', text: '합성 안내' }),
    noCaption([PAYMENT_ROWS[0]]),
    h('div', { className: 'h_tit_wrap', text: '별도  계약 품목' }),
    h('div', { className: 'ect_item', text: `  ${OPTION_A_LABEL}\n ` }),
    noCaption([OPTION_ROWS[0]]),
    h('div', { className: 'ect_item', text: OPTION_B_LABEL }),
    noCaption([OPTION_ROWS[1]]),
  ]));
  assert.deepEqual(captured.rows.map((r) => r.section), ['payment', 'option', 'option']);
  assert.equal(captured.rows[1].itemLabel, OPTION_A_LABEL);
  assert.equal(captured.rows[2].itemLabel, OPTION_B_LABEL);
});

test('option itemLabel is whitespace-normalized, capped at 200, and never borrowed from an earlier table', () => {
  const long = `합성 품목 ${'가'.repeat(260)}`;
  const captured = captureSujainTables('payment', fakeDocument([
    h('div', { className: 'ect_item', text: long }),
    sujainTable('별도 계약 품목', [OPTION_ROWS[0]], { emptyRowsBetween: false }),
    // 두 번째 옵션 표 앞에 ect_item 이 없으면 앞 표의 품목을 빌려 오지 않는다.
    sujainTable('별도 계약 품목', [OPTION_ROWS[1]], { emptyRowsBetween: false }),
  ]));
  assert.equal(captured.rows[0].itemLabel.length, 200);
  assert.equal(captured.rows[0].itemLabel.startsWith('합성 품목 가'), true);
  assert.equal(captured.rows[1].section, 'option');
  assert.equal(Object.hasOwn(captured.rows[1], 'itemLabel'), false);
});

test('a table inside a hidden ancestor is counted but not read', () => {
  const captured = captureSujainTables('payment', fakeDocument([
    sujainContactLayer(),
    h('div', { hidden: true }, [sujainTable('아파트 분양대금', [PAYMENT_ROWS[0]])]),
  ]));
  assert.equal(captured.tableCount, 2);
  assert.deepEqual(captured.tableHeaders, []);
  assert.deepEqual(captured.tables, []);
  assert.deepEqual(captured.rows, []);
});
