import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSujainTables } from '../table-capture.mjs';
import { isEligibleSujainCapturedRow } from '../collect.mjs';
import { formatLayoutWarnFragment, sanitizePageLayoutDiagnostic } from '../policy.mjs';

/** Minimal DOM duck-types for Node — mirrors the td/input shapes capture reads. */
function control(tagName, attrs = {}) {
  const el = {
    tagName,
    id: attrs.id ?? '',
    name: attrs.name ?? '',
    type: attrs.type ?? (tagName === 'INPUT' ? 'text' : undefined),
    value: attrs.value ?? '',
    options: attrs.options,
    selectedIndex: attrs.selectedIndex ?? 0,
    getAttribute(key) {
      if (key === 'type') return attrs.type ?? (tagName === 'INPUT' ? 'text' : null);
      if (key === 'id') return attrs.id ?? null;
      if (key === 'name') return attrs.name ?? null;
      return attrs[key] ?? null;
    },
  };
  return el;
}

function cell(children, textContent = '') {
  const controls = Array.isArray(children) ? children : [];
  return {
    textContent,
    querySelectorAll(sel) {
      if (!/input|select|textarea/i.test(sel)) return [];
      return controls;
    },
  };
}

function row(cells) {
  return {
    querySelectorAll(sel) {
      if (sel === 'th, td') return cells;
      return [];
    },
  };
}

function table({ headers = [], bodyRows = [], extraControls = [] }) {
  const headerCells = headers.map((text) => ({ textContent: text }));
  const headerRow = {
    querySelectorAll(sel) {
      if (sel === 'th, td') return headerCells.map((h) => cell([], h.textContent));
      return [];
    },
  };
  const formControls = [];
  for (const bodyRow of bodyRows) {
    for (const c of bodyRow.querySelectorAll('th, td')) {
      formControls.push(...c.querySelectorAll('input, select, textarea'));
    }
  }
  formControls.push(...extraControls);

  return {
    querySelectorAll(sel) {
      if (sel === 'thead th, tr:first-child th') return headerCells;
      if (sel === 'tbody tr, tr') return [headerRow, ...bodyRows];
      if (sel === 'input, select, textarea') return formControls;
      return [];
    },
  };
}

function doc(tables) {
  return {
    querySelectorAll(sel) {
      if (sel === 'table') return tables;
      return [];
    },
  };
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
  assert.deepEqual(captured.tables, [{ rawRowCount: 1, formControlCount: 8 }]);
  assert.equal(isEligibleSujainCapturedRow(captured.rows[0]), true);
  assert.equal(captured.rows[0].cells[2], '10000000');
  assert.equal(captured.rows[0].cells[0], '1');
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
  assert.deepEqual(captured.tables, [{ rawRowCount: 4, formControlCount: 0 }]);
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
    cells: captured.rows.flatMap((r) => r.cells),
  });
  assert.ok(layout);
  assert.deepEqual(layout.tables, [
    { rawRowCount: 1, formControlCount: 8 },
    { rawRowCount: 4, formControlCount: 0 },
  ]);
  const text = JSON.stringify(layout);
  const fragment = formatLayoutWarnFragment({ payment: layout });
  for (const leak of [
    'SYNTHETIC_SECRET_AMOUNT',
    '합성 회원',
    '000-0000-0000',
    '합성 주소',
    'synthetic@example.com',
  ]) {
    assert.equal(text.includes(leak), false, `layout JSON leaked ${leak}`);
    assert.equal(fragment.includes(leak), false, `warn fragment leaked ${leak}`);
  }
  assert.match(
    fragment,
    /payment:t=2;h=\[회차\|약정일자\|약정금액\|납부일자\|납부원금\|연체료\|할인료\|실납부금\],\[이름\*\];raw=5;eligible=1;tables=\[r=1,i=8\],\[r=4,i=0\]/,
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
  assert.deepEqual(captured.tables, [{ rawRowCount: 0, formControlCount: 2 }]);
});
