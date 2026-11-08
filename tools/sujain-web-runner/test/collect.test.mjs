import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUJAIN_SEARCH_BUTTON,
  SUJAIN_UNIT_SELECT,
  buildPageLayoutDiagnostic,
  countUnitOptions,
  isEligibleSujainCapturedRow,
  normalizeCapturedRows,
  normalizeTableEvaluateResult,
  readSujainPages,
} from '../collect.mjs';
import { formatLayoutWarnFragment, SujainReadError } from '../policy.mjs';
import { SUJAIN_PAYMENT_HEADERS, sujainPaymentDocument } from './fake-dom.mjs';

const PAYMENT_ROW = {
  cells: ['계약금1차', '2024-01-10', '1,000', '2024-01-10', '1,000', '0', '0', '1,000'],
  headers: SUJAIN_PAYMENT_HEADERS,
  sourcePage: 'payment',
  section: 'payment',
};

/**
 * Fake Playwright page shaped like https://www.sujain.co.kr/login:
 * form#frm, input#id[name=userid], input#pw[name=userpwd], a.btnLogin (not type=submit).
 * After login it mimics /mypage/payment (2026-11-08 구조): select#preInsp(자리표시 + 세대
 * option) and a [onclick*="searchPayment"] 조회 button. Tables are empty until 조회.
 *
 * afterClick modes:
 * - navigate: leave /login without a dialog (legacy happy path)
 * - alert: failure/extra-auth dialog without leaving login
 * - success-alert: official success — land on /login/result + alert, then /index after dismiss
 *
 * afterSearch modes: fill (default) · dialog (site alert during the click) · login · nothing
 */
function officialLoginPage({
  hasLoginControl = true,
  afterClick = 'navigate',
  alertMessage = '아이디 또는 비밀번호가 일치하지 않습니다.',
  hasCaptchaOrExtraAuthText = false,
  paymentRows = [PAYMENT_ROW],
  prePaymentRows = [],
  paymentDoc = null,
  units = 1,
  hasUnitSelect = true,
  hasSearchButton = true,
  afterSearch = 'fill',
  searchDialogMessage = '합성 조회 오류 알림입니다.',
  paymentLoadDialogMessage = null,
} = {}) {
  const actions = [];
  let url = 'https://www.sujain.co.kr/login';
  let dialogHandler = null;
  const filled = { id: '', pw: '' };
  const dialogListeners = new Set();
  let searched = false;
  let selectedIndex = 0;
  const unitSelect = {
    options: [
      { value: '', disabled: false },
      ...Array.from({ length: units }, (_, index) => ({ value: `synthetic-unit-${index + 1}`, disabled: false })),
    ],
  };

  function matches(selector, name) {
    const parts = selector.split(',').map((part) => part.trim());
    return parts.some((part) => part === name);
  }

  /** Official page has an <a.btnLogin>, not button/input type=submit. */
  function loginControlCount(selector) {
    if (!hasLoginControl) return 0;
    const parts = selector.split(',').map((part) => part.trim());
    // Only a.btnLogin (optionally scoped under form#frm) matches the live control.
    return parts.some((part) => /^((form#frm|form\[id=["']frm["']\])\s+)?a\.btnLogin\b/.test(part)
      || part === 'a.btnLogin'
      || part.endsWith('a.btnLogin')) ? 1 : 0;
  }

  /** Alert routed to page.on('dialog') listeners (runner dialog watcher). */
  function emitPageDialog(message) {
    const dialog = {
      message: () => message,
      async dismiss() {
        actions.push(['page-dialog-dismiss']);
      },
    };
    for (const listener of dialogListeners) listener(dialog);
  }

  function emitDialog(message, { afterDismissUrl = null } = {}) {
    const dialog = {
      message: () => message,
      async dismiss() {
        actions.push(['dialog-dismiss']);
        if (afterDismissUrl) {
          setTimeout(() => {
            url = afterDismissUrl;
          }, 0);
        }
      },
      async accept() {
        actions.push(['dialog-accept']);
        if (afterDismissUrl) {
          setTimeout(() => {
            url = afterDismissUrl;
          }, 0);
        }
      },
    };
    if (dialogHandler) dialogHandler(dialog);
  }

  function locator(selector, parent = null) {
    const full = parent ? `${parent} >> ${selector}` : selector;
    const self = {
      first() {
        return locator(selector, parent);
      },
      locator(child) {
        return locator(child, selector);
      },
      async count() {
        if (selector === SUJAIN_UNIT_SELECT) return hasUnitSelect ? 1 : 0;
        if (selector === SUJAIN_SEARCH_BUTTON) return hasSearchButton ? 1 : 0;
        if (matches(selector, 'form#frm') || selector === 'form#frm') return 1;
        if (
          /#id\b|name="userid"|input\[name="userid"\]/.test(selector)
          || (selector.includes('#id') && !/#id[a-z]/i.test(selector))
        ) {
          return 1;
        }
        // Broad legacy type=text queries still resolve on this fixture (id field exists),
        // but scoped #id / userid is what production should prefer.
        if (/type="text"|name\*="id"|id\*="id"|name\*="user"/.test(selector)) return 1;
        if (/#pw\b|name="userpwd"|type="password"/.test(selector)) return 1;
        if (/btnLogin|type="submit"|type='submit'|has-text\("로그인"\)/.test(selector)) {
          return loginControlCount(selector);
        }
        if (/캡차|자동입력|추가|2단계|본인/.test(selector)) return hasCaptchaOrExtraAuthText ? 1 : 0;
        if (/실패|오류|틀렸|일치하지/.test(selector)) {
          return afterClick === 'alert' && /실패|오류|틀렸|일치하지|아이디|비밀번호/u.test(alertMessage) ? 1 : 0;
        }
        return 0;
      },
      async fill(value, _options) {
        actions.push(['fill', full, value]);
        if (/#id|userid|type="text"|name\*="id"|id\*="id"|name\*="user"/.test(selector)) {
          filled.id = value;
        }
        if (/#pw|userpwd|type="password"/.test(selector)) {
          filled.pw = value;
        }
      },
      async waitFor(options) {
        actions.push(['waitFor', selector, options?.state]);
        if (selector === SUJAIN_UNIT_SELECT && !hasUnitSelect) {
          const err = new Error('synthetic waitFor timeout');
          err.name = 'TimeoutError';
          throw err;
        }
      },
      async evaluate(fn) {
        actions.push(['locator-evaluate', selector]);
        if (selector !== SUJAIN_UNIT_SELECT) throw new Error('unsupported locator evaluate');
        return fn(unitSelect);
      },
      async selectOption(values, options) {
        actions.push(['selectOption', selector, values?.index, options?.force === true]);
        selectedIndex = values?.index ?? 0;
      },
      async click(_options) {
        actions.push(['click', full]);
        if (selector === SUJAIN_SEARCH_BUTTON) {
          actions.push(['search-click', selectedIndex]);
          searched = true;
          if (afterSearch === 'dialog') {
            // Site alert opens during the click; the runner listener must dismiss it.
            emitPageDialog(searchDialogMessage);
          } else if (afterSearch === 'login') {
            url = 'https://www.sujain.co.kr/login';
          }
          return;
        }
        if (loginControlCount(selector) === 0) return;
        actions.push(['login-control-activated', full]);
        if (afterClick === 'navigate') {
          // Simulate ajax success → document.frm.submit() leaving /login.
          setTimeout(() => {
            url = 'https://www.sujain.co.kr/';
          }, 0);
        } else if (afterClick === 'success-alert') {
          // Official path: form submit → /login/result, then success alert; 확인 → /index.
          url = 'https://www.sujain.co.kr/login/result';
          setTimeout(() => {
            emitDialog(alertMessage, { afterDismissUrl: 'https://www.sujain.co.kr/index' });
          }, 0);
        } else if (afterClick === 'alert') {
          emitDialog(alertMessage);
        }
      },
    };
    return self;
  }

  const page = {
    async goto(target) {
      actions.push(['goto', target]);
      url = target;
      if (paymentLoadDialogMessage && String(target).includes('/mypage/payment')) {
        emitPageDialog(paymentLoadDialogMessage);
      }
    },
    url: () => url,
    locator,
    on(event, listener) {
      actions.push(['on', event]);
      if (event === 'dialog') dialogListeners.add(listener);
    },
    off(event, listener) {
      actions.push(['off', event]);
      if (event === 'dialog') dialogListeners.delete(listener);
    },
    async waitForLoadState(state, _options) {
      actions.push(['waitForLoadState', state]);
    },
    async waitForTimeout(ms) {
      actions.push(['waitForTimeout', ms]);
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number(ms) || 0, 5)));
    },
    waitForEvent(event, _options) {
      actions.push(['waitForEvent', event]);
      if (event !== 'dialog') return Promise.reject(new Error('unsupported event'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('dialog timeout')), 30);
        dialogHandler = (dialog) => {
          clearTimeout(timer);
          resolve(dialog);
        };
      });
    },
    waitForURL(predicate, _options) {
      actions.push(['waitForURL']);
      return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
          done = true;
          reject(new Error('url timeout'));
        }, 30);
        const check = () => {
          if (done) return;
          const href = url;
          const ok = typeof predicate === 'function'
            ? predicate(new URL(href))
            : String(href).includes(String(predicate));
          if (ok) {
            done = true;
            clearTimeout(timer);
            resolve();
          } else {
            setTimeout(check, 1);
          }
        };
        check();
      });
    },
    async evaluate(fn, sourcePage) {
      actions.push(['evaluate', sourcePage, searched]);
      if (paymentDoc) return fn(sourcePage, paymentDoc({ searched }));
      if (sourcePage !== 'payment') return [];
      return searched ? paymentRows : prePaymentRows;
    },
  };

  return { actions, page, filled, dialogListeners };
}

async function withTableWait(ms, run) {
  const previous = process.env.SUJAIN_TABLE_WAIT_MS;
  process.env.SUJAIN_TABLE_WAIT_MS = String(ms);
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.SUJAIN_TABLE_WAIT_MS;
    else process.env.SUJAIN_TABLE_WAIT_MS = previous;
  }
}

const destroyedError = () => {
  const err = new Error('Execution context was destroyed, most likely because of a navigation.');
  err.name = 'Error';
  return err;
};

const job = () => ({
  provider: 'sujain',
  credentials: { loginId: 'synthetic-id', password: 'Synthetic!123' },
});

test('official login fixture (a.btnLogin, #id, #pw, form#frm) starts login without unsupported_layout', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  const result = await readSujainPages(f.page, job());
  assert.equal(f.actions.some((row) => row[0] === 'login-control-activated'), true);
  assert.equal(
    f.actions.some((row) => row[0] === 'click' && String(row[1]).includes('btnLogin')),
    true,
  );
  assert.equal(f.filled.id, 'synthetic-id');
  assert.equal(f.filled.pw, 'Synthetic!123');
  assert.ok(result.rows.length >= 1);
  assert.equal(f.actions.some((row) => row[0] === 'waitForURL'), true);
  assert.equal(f.actions.some((row) => row[0] === 'waitForEvent' && row[1] === 'dialog'), true);
});

test('missing login control still throws unsupported_layout before any submit', async () => {
  const f = officialLoginPage({ hasLoginControl: false });
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof SujainReadError && error.code === 'unsupported_layout',
  );
  assert.equal(f.actions.some((row) => row[0] === 'login-control-activated'), false);
  assert.equal(f.actions.some((row) => row[0] === 'click'), false);
});

test('failure alert after ajax login maps to credentials_invalid', async () => {
  const f = officialLoginPage({
    afterClick: 'alert',
    alertMessage: '아이디 또는 비밀번호가 일치하지 않습니다.',
  });
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof SujainReadError && error.code === 'credentials_invalid',
  );
  assert.equal(f.actions.some((row) => row[0] === 'login-control-activated'), true);
  assert.equal(f.actions.some((row) => row[0] === 'dialog-dismiss'), true);
  assert.equal(f.actions.some((row) => row[0] === 'goto' && String(row[1]).includes('payment')), false);
});

test('official success alert on /login/result is not authentication_required', async () => {
  const f = officialLoginPage({
    afterClick: 'success-alert',
    alertMessage: '정상적으로 로그인 되었습니다.',
  });
  const result = await readSujainPages(f.page, job());
  assert.equal(f.actions.some((row) => row[0] === 'login-control-activated'), true);
  assert.equal(f.actions.some((row) => row[0] === 'dialog-dismiss'), true);
  assert.ok(result.rows.length >= 1);
  assert.equal(
    f.actions.some((row) => row[0] === 'goto' && String(row[1]).includes('payment')),
    true,
  );
});

test('extra-auth dialog after login click stays authentication_required', async () => {
  const f = officialLoginPage({
    afterClick: 'alert',
    alertMessage: '추가 인증이 필요합니다. 본인인증을 진행해 주세요.',
  });
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof SujainReadError && error.code === 'authentication_required',
  );
  assert.equal(f.actions.some((row) => row[0] === 'dialog-dismiss'), true);
  assert.equal(f.actions.some((row) => row[0] === 'goto' && String(row[1]).includes('payment')), false);
});

test('captcha or 본인인증 page text after login stays authentication_required', async () => {
  const f = officialLoginPage({
    afterClick: 'navigate',
    hasCaptchaOrExtraAuthText: true,
  });
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof SujainReadError && error.code === 'authentication_required',
  );
  assert.equal(f.actions.some((row) => row[0] === 'goto' && String(row[1]).includes('payment')), false);
});

test('scoped selectors prefer #id/#pw over later type=text fields', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  await readSujainPages(f.page, job());
  const fills = f.actions.filter((row) => row[0] === 'fill');
  assert.ok(fills.length >= 2);
  assert.match(String(fills[0][1]), /#id|userid/);
  assert.match(String(fills[1][1]), /#pw|userpwd/);
});

test('long synthetic cell and header strings are truncated to API schema caps', async () => {
  const longCell = `synthetic-cell-${'x'.repeat(250)}`;
  const longHeader = `synthetic-header-${'y'.repeat(120)}`;
  assert.ok(longCell.length > 200);
  assert.ok(longHeader.length > 100);
  const f = officialLoginPage({
    afterClick: 'navigate',
    paymentRows: [{
      cells: [longCell, '1,000'],
      headers: [longHeader, '금액'],
      sourcePage: 'payment',
      section: 'payment',
    }],
  });
  const result = await readSujainPages(f.page, job());
  const payment = result.rows.find((row) => row.sourcePage === 'payment');
  assert.ok(payment);
  assert.equal(payment.cells[0].length, 200);
  assert.equal(payment.headers[0].length, 100);
  assert.equal(payment.cells[1], '1,000');
  assert.equal(payment.headers[1], '금액');
});

test('records scrape_payment stage before table evaluate without leaking page text', async () => {
  const diagnostics = { stage: 'context' };
  const f = officialLoginPage({ afterClick: 'navigate' });
  f.page.evaluate = async () => {
    assert.equal(diagnostics.stage, 'scrape_payment');
    const err = new Error('Execution context was destroyed synthetic page text');
    err.name = 'Error';
    throw err;
  };
  await assert.rejects(
    () => readSujainPages(f.page, job(), diagnostics),
    (error) => error instanceof Error
      && error.name === 'Error'
      && !String(error.message).includes('수자인')
      && diagnostics.stage === 'scrape_payment',
  );
});

test('records login stage while fillLogin runs', async () => {
  const diagnostics = { stage: 'context' };
  const f = officialLoginPage({ hasLoginControl: false });
  await assert.rejects(
    () => readSujainPages(f.page, job(), diagnostics),
    (error) => error instanceof SujainReadError && error.code === 'unsupported_layout',
  );
  assert.equal(diagnostics.stage, 'login');
});

test('selects the first real unit, clicks 조회, then reads the three st1 tables from the fake page', async () => {
  const optionRows = [
    ['계약금', '2024-01-10', '100,000', '2024-01-10', '100,000', '0', '0', '100,000'],
    ['잔금', '2027-03-31', '900,000', '', '0', '0', '0', '0'],
    ['계', '', '1,000,000', '', '100,000', '0', '0', '100,000'],
  ];
  const f = officialLoginPage({
    afterClick: 'navigate',
    paymentDoc: ({ searched }) => sujainPaymentDocument({
      searched,
      paymentRows: [
        ['계약금1차', '2024-01-10', '1,000,000', '2024-01-10', '1,000,000', '0', '0', '1,000,000'],
        ['중도금1차', '2024-06-10', '3,000,000', '2024-06-10', '3,000,000', '0', '0', '3,000,000'],
        ['잔금', '2027-03-31', '9,000,000', '', '0', '0', '0', '0'],
        ['계', '', '13,000,000', '', '4,000,000', '0', '0', '4,000,000'],
      ],
      options: [
        { itemLabel: '합성 발코니 확장, [합성벽체]-침실2.3 분리형', rows: optionRows },
        { itemLabel: '[합성에어컨]-거실,침실1(2개소)-합성전자', rows: optionRows },
      ],
    }),
  });
  const diagnostics = { stage: 'context', layout: {} };
  const result = await readSujainPages(f.page, job(), diagnostics);

  const order = f.actions
    .filter((row) => ['goto', 'waitFor', 'selectOption', 'search-click', 'evaluate'].includes(row[0]))
    .map((row) => row[0]);
  assert.deepEqual(order.slice(0, 6), ['goto', 'goto', 'waitFor', 'selectOption', 'search-click', 'evaluate']);
  // 자리표시(index 0)는 건너뛰고 첫 세대(index 1)를 고른다.
  assert.deepEqual(f.actions.find((row) => row[0] === 'selectOption'), ['selectOption', SUJAIN_UNIT_SELECT, 1, true]);
  // 조회 뒤에만 표를 읽는다.
  assert.equal(f.actions.some((row) => row[0] === 'evaluate' && row[2] === false), false);
  // 세대 내 설치 품목 화면은 가지 않는다.
  assert.equal(f.actions.some((row) => row[0] === 'goto' && String(row[1]).includes('unit-items')), false);
  assert.equal(diagnostics.stage, 'scrape_payment');

  const payment = result.rows.filter((row) => row.section === 'payment');
  const option = result.rows.filter((row) => row.section === 'option');
  assert.deepEqual(payment.map((row) => row.cells[0]), ['계약금1차', '중도금1차', '잔금', '계']);
  assert.equal(option.length, 6);
  assert.deepEqual(
    [...new Set(option.map((row) => row.itemLabel))],
    ['합성 발코니 확장, [합성벽체]-침실2.3 분리형', '[합성에어컨]-거실,침실1(2개소)-합성전자'],
  );
  for (const row of result.rows) {
    assert.equal(row.cells.length, 8);
    assert.deepEqual(row.headers, SUJAIN_PAYMENT_HEADERS);
    assert.equal(row.sourcePage, 'payment');
  }
  assert.equal(JSON.stringify(result).includes('합성 회원'), false);

  const layout = diagnostics.layout.payment;
  assert.equal(layout.searched, 1);
  assert.equal(layout.units, 1);
  assert.equal(layout.tableCount, 4);
  assert.deepEqual(layout.tableHeaders, [SUJAIN_PAYMENT_HEADERS, SUJAIN_PAYMENT_HEADERS, SUJAIN_PAYMENT_HEADERS]);
  const fragment = formatLayoutWarnFragment(diagnostics.layout);
  assert.match(fragment, /^layout=payment:t=4;searched=1;units=1;h=/);
  for (const leak of ['synthetic-unit-1', '합성단지', '1,000,000', '합성 발코니', '계약금1차']) {
    assert.equal(JSON.stringify(layout).includes(leak), false, `layout leaked ${leak}`);
    assert.equal(fragment.includes(leak), false, `fragment leaked ${leak}`);
  }
  // dialog 리스너는 끝나면 뗀다.
  assert.equal(f.dialogListeners.size, 0);
});

test('several registered units: picks the first and keeps only the count in diagnostics', async () => {
  const f = officialLoginPage({ afterClick: 'navigate', units: 3 });
  const diagnostics = { stage: 'context', layout: {} };
  const result = await readSujainPages(f.page, job(), diagnostics);
  assert.ok(result.rows.length >= 1);
  assert.deepEqual(f.actions.find((row) => row[0] === 'selectOption'), ['selectOption', SUJAIN_UNIT_SELECT, 1, true]);
  assert.equal(f.actions.filter((row) => row[0] === 'search-click').length, 1);
  assert.equal(diagnostics.layout.payment.units, 3);
  assert.equal(JSON.stringify(diagnostics).includes('synthetic-unit'), false);
});

test('no registered unit (placeholder option only) is unit_not_registered without clicking 조회', async () => {
  const f = officialLoginPage({ afterClick: 'navigate', units: 0 });
  const diagnostics = { stage: 'context', layout: {} };
  await withTableWait(50, () => assert.rejects(
    () => readSujainPages(f.page, job(), diagnostics),
    (error) => error instanceof SujainReadError && error.code === 'unit_not_registered',
  ));
  assert.equal(f.actions.some((row) => row[0] === 'selectOption'), false);
  assert.equal(f.actions.some((row) => row[0] === 'search-click'), false);
  assert.equal(diagnostics.stage, 'scrape_payment');
  assert.equal(diagnostics.layout.payment.units, 0);
  assert.equal(diagnostics.layout.payment.searched, 0);
});

test('missing unit select is unsupported_layout with a value-free layout snapshot', async () => {
  const f = officialLoginPage({ afterClick: 'navigate', hasUnitSelect: false });
  const diagnostics = { stage: 'context', layout: {} };
  await withTableWait(50, () => assert.rejects(
    () => readSujainPages(f.page, job(), diagnostics),
    (error) => error instanceof SujainReadError && error.code === 'unsupported_layout',
  ));
  assert.equal(f.actions.some((row) => row[0] === 'search-click'), false);
  assert.equal(diagnostics.layout.payment.searched, 0);
  assert.equal(diagnostics.layout.payment.units, 0);
  assert.equal(diagnostics.layout.payment.pagePath, 'https://www.sujain.co.kr/mypage/payment');
});

test('missing 조회 button is unsupported_layout after choosing the unit', async () => {
  const f = officialLoginPage({ afterClick: 'navigate', hasSearchButton: false });
  const diagnostics = { stage: 'context', layout: {} };
  await assert.rejects(
    () => readSujainPages(f.page, job(), diagnostics),
    (error) => error instanceof SujainReadError && error.code === 'unsupported_layout',
  );
  assert.equal(f.actions.some((row) => row[0] === 'selectOption'), true);
  assert.equal(f.actions.some((row) => row[0] === 'search-click'), false);
  assert.equal(diagnostics.layout.payment.searched, 0);
  assert.equal(diagnostics.layout.payment.units, 1);
});

test('site alert after 조회 is dismissed, never recorded, and maps to unsupported_layout', async () => {
  const f = officialLoginPage({
    afterClick: 'navigate',
    afterSearch: 'dialog',
    searchDialogMessage: '합성 조회 실패 알림 SYNTHETIC_DIALOG_TEXT',
  });
  const diagnostics = { stage: 'context', layout: {} };
  await assert.rejects(
    () => readSujainPages(f.page, job(), diagnostics),
    (error) => error instanceof SujainReadError && error.code === 'unsupported_layout',
  );
  assert.equal(f.actions.some((row) => row[0] === 'page-dialog-dismiss'), true);
  assert.equal(diagnostics.layout.payment.searched, 1);
  assert.equal(JSON.stringify(diagnostics).includes('SYNTHETIC_DIALOG_TEXT'), false);
  assert.equal(formatLayoutWarnFragment(diagnostics.layout).includes('SYNTHETIC_DIALOG_TEXT'), false);
  assert.equal(f.dialogListeners.size, 0);
});

test('login/session alert after 조회 maps to authentication_required', async () => {
  const f = officialLoginPage({
    afterClick: 'navigate',
    afterSearch: 'dialog',
    searchDialogMessage: '로그인 후 이용해 주세요.',
  });
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof SujainReadError && error.code === 'authentication_required',
  );
  assert.equal(f.actions.some((row) => row[0] === 'page-dialog-dismiss'), true);
});

test('a notice alert while the payment page opens is dismissed and does not fail the read', async () => {
  const f = officialLoginPage({
    afterClick: 'navigate',
    paymentLoadDialogMessage: '합성 안내 알림 SYNTHETIC_NOTICE',
  });
  const diagnostics = { stage: 'context', layout: {} };
  const result = await readSujainPages(f.page, job(), diagnostics);
  assert.ok(result.rows.length >= 1);
  assert.equal(f.actions.some((row) => row[0] === 'page-dialog-dismiss'), true);
  // 리스너는 결제 화면으로 가기 전에 붙고(goto 보다 먼저) 끝나면 뗀다.
  const onIndex = f.actions.findIndex((row) => row[0] === 'on' && row[1] === 'dialog');
  const paymentGotoIndex = f.actions.findIndex((row) => row[0] === 'goto' && String(row[1]).includes('/mypage/payment'));
  assert.ok(onIndex >= 0 && onIndex < paymentGotoIndex);
  assert.equal(f.dialogListeners.size, 0);
  assert.equal(JSON.stringify(diagnostics).includes('SYNTHETIC_NOTICE'), false);
});

test('조회 that bounces to login is authentication_required', async () => {
  const f = officialLoginPage({ afterClick: 'navigate', afterSearch: 'login' });
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof SujainReadError && error.code === 'authentication_required',
  );
});

test('countUnitOptions skips the empty placeholder and disabled options and returns no option text', () => {
  const result = countUnitOptions({
    options: [
      { value: '', text: '선택' },
      { value: 'synthetic-a', disabled: true, text: '합성단지 A' },
      { value: ' ', text: '공백' },
      { value: 'synthetic-b', text: '합성단지 B' },
      { value: 'synthetic-c', text: '합성단지 C' },
    ],
  });
  assert.deepEqual(result, { count: 2, firstIndex: 3 });
  assert.deepEqual(countUnitOptions({ options: [{ value: '' }] }), { count: 0, firstIndex: -1 });
  assert.deepEqual(countUnitOptions(null), { count: 0, firstIndex: -1 });
});

test('payment evaluate survives one destroyed execution context after 조회', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  let evalAttempts = 0;
  const originalEvaluate = f.page.evaluate.bind(f.page);
  f.page.evaluate = async (fn, sourcePage) => {
    evalAttempts += 1;
    if (evalAttempts === 1) throw destroyedError();
    return originalEvaluate(fn, sourcePage);
  };

  const diagnostics = { stage: 'context' };
  const result = await readSujainPages(f.page, job(), diagnostics);
  assert.equal(evalAttempts, 2);
  assert.equal(diagnostics.stage, 'scrape_payment');
  assert.ok(result.rows.some((row) => row.cells[0] === '계약금1차'));
  assert.equal(f.actions.some((row) => row[0] === 'waitForLoadState' && row[1] === 'domcontentloaded'), true);
});

test('destroyed-context retry that lands on login is authentication_required', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  let evalAttempts = 0;
  f.page.evaluate = async () => {
    evalAttempts += 1;
    // Simulate the follow-up navigation bouncing the session back to login.
    f.page.url = () => 'https://www.sujain.co.kr/login';
    throw destroyedError();
  };
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof SujainReadError && error.code === 'authentication_required',
  );
  assert.equal(evalAttempts, 1);
});

test('non-navigation evaluate Error still propagates as runner_exception shape', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  f.page.evaluate = async () => {
    const err = new Error('synthetic unrelated evaluate failure');
    err.name = 'Error';
    throw err;
  };
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof Error
      && error.name === 'Error'
      && String(error.message) === 'synthetic unrelated evaluate failure',
  );
});

test('destroyed-context retry is only once — second destroy still fails', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  let evalAttempts = 0;
  f.page.evaluate = async () => {
    evalAttempts += 1;
    throw destroyedError();
  };
  await assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof Error
      && error.name === 'Error'
      && /Execution context was destroyed/u.test(String(error.message)),
  );
  assert.equal(evalAttempts, 2);
});

test('waits when the first evaluate after 조회 is empty, then returns rows once they paint', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  let evals = 0;
  f.page.evaluate = async () => {
    evals += 1;
    return evals >= 3 ? [PAYMENT_ROW] : [];
  };
  const result = await withTableWait(2000, () => readSujainPages(f.page, job()));
  assert.ok(evals >= 3);
  assert.ok(result.rows.some((row) => row.cells[0] === '계약금1차'));
  assert.equal(f.actions.some((row) => row[0] === 'waitForTimeout'), true);
});

test('destroyed-context then empty then data still yields rows', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  let evals = 0;
  f.page.evaluate = async () => {
    evals += 1;
    if (evals === 1) throw destroyedError();
    // Post-destroy document is briefly empty (not yet painted).
    if (evals === 2) return [];
    return [PAYMENT_ROW];
  };
  const result = await readSujainPages(f.page, job());
  assert.ok(evals >= 3);
  assert.ok(result.rows.some((row) => row.cells[0] === '계약금1차'));
});

test('still empty after 조회 and waiting is unsupported_layout, not silent empty success', async () => {
  const f = officialLoginPage({ afterClick: 'navigate', paymentRows: [] });
  const diagnostics = { stage: 'context', layout: {} };
  await withTableWait(50, () => assert.rejects(
    () => readSujainPages(f.page, job(), diagnostics),
    (error) => error instanceof SujainReadError && error.code === 'unsupported_layout',
  ));
  assert.equal(f.actions.some((row) => row[0] === 'search-click'), true);
  assert.equal(diagnostics.layout.payment.searched, 1);
  assert.equal(f.actions.some((row) => row[0] === 'goto' && String(row[1]).includes('unit-items')), false);
});

test('normalizeCapturedRows keeps section/itemLabel, caps itemLabel at 200, and drops itemLabel on payment rows', () => {
  const rows = normalizeCapturedRows([
    { cells: ['계'], headers: ['회차'], sourcePage: 'unit-items', section: 'payment', itemLabel: '무시' },
    { cells: ['계약금'], headers: ['회차'], section: 'option', itemLabel: `  합성  품목 ${'x'.repeat(250)}` },
    { cells: ['잔금'], headers: ['회차'], section: 'nope' },
    { cells: ['잔금'], headers: ['회차'], section: 'option', itemLabel: 42 },
  ]);
  assert.deepEqual(rows[0], { cells: ['계'], headers: ['회차'], sourcePage: 'payment', section: 'payment' });
  assert.equal(rows[1].section, 'option');
  assert.equal(rows[1].itemLabel.length, 200);
  assert.equal(rows[1].itemLabel.startsWith('합성 품목 x'), true);
  assert.equal(rows[2].section, 'payment');
  assert.equal(Object.hasOwn(rows[3], 'itemLabel'), false);
});

test('member-profile/contact captured rows are not eligible payment or option tables', () => {
  assert.equal(
    isEligibleSujainCapturedRow({
      headers: ['항목', '내용'],
      cells: ['이름', '합성 회원'],
      sourcePage: 'payment',
    }),
    false,
  );
  assert.equal(
    isEligibleSujainCapturedRow({
      headers: SUJAIN_PAYMENT_HEADERS,
      cells: ['계약금', '', '500,000'],
      sourcePage: 'payment',
      section: 'option',
    }),
    true,
  );
  assert.equal(
    isEligibleSujainCapturedRow({
      headers: ['구분', '금액'],
      cells: ['계약금', '1,000'],
      sourcePage: 'payment',
    }),
    true,
  );
});

test('contact-only tables after 조회 are unsupported_layout, not scrape success', async () => {
  const contactPayment = [
    { cells: ['이름', '합성 회원'], headers: ['항목', '내용'], sourcePage: 'payment' },
    { cells: ['휴대전화', '000-0000-0000'], headers: ['항목', '내용'], sourcePage: 'payment' },
  ];
  const f = officialLoginPage({ afterClick: 'navigate', paymentRows: contactPayment });
  await withTableWait(50, () => assert.rejects(
    () => readSujainPages(f.page, job()),
    (error) => error instanceof SujainReadError && error.code === 'unsupported_layout',
  ));
});

test('unsupported_layout diagnostics include table counts, header texts, searched and units only', async () => {
  const contactPayment = [
    { cells: ['이름', '합성 회원'], headers: ['항목', '내용'], sourcePage: 'payment' },
    { cells: ['휴대전화', '000-0000-0000'], headers: ['항목', '내용'], sourcePage: 'payment' },
    { cells: ['주소', '합성 주소'], headers: ['항목', '내용'], sourcePage: 'payment' },
    { cells: ['이메일', 'synthetic@example.com'], headers: ['항목', '내용'], sourcePage: 'payment' },
  ];
  const f = officialLoginPage({ afterClick: 'navigate', paymentRows: contactPayment });
  const diagnostics = { stage: 'context', layout: {} };
  await withTableWait(50, () => assert.rejects(
    () => readSujainPages(f.page, job(), diagnostics),
    (error) => error instanceof SujainReadError && error.code === 'unsupported_layout',
  ));

  assert.equal(diagnostics.stage, 'scrape_payment');
  assert.deepEqual(Object.keys(diagnostics.layout), ['payment']);
  assert.equal(diagnostics.layout.payment.tableCount, 1);
  assert.deepEqual(diagnostics.layout.payment.tableHeaders, [['항목', '내용']]);
  assert.equal(diagnostics.layout.payment.rawRowCount, 4);
  assert.equal(diagnostics.layout.payment.eligibleRowCount, 0);
  assert.deepEqual(diagnostics.layout.payment.tables, [
    { rawRowCount: 4, preSkipRowCount: 0, formControlCount: 0 },
  ]);
  assert.equal(diagnostics.layout.payment.outsideTableFormControlCount, 0);
  assert.deepEqual(diagnostics.layout.payment.outsideTableFormControls, {
    visibleInput: 0,
    visibleSelect: 0,
    visibleTextarea: 0,
    hidden: 0,
    other: 0,
  });
  assert.equal(diagnostics.layout.payment.iframeCount, 0);
  assert.equal(diagnostics.layout.payment.pagePath, 'https://www.sujain.co.kr/mypage/payment');
  assert.equal(diagnostics.layout.payment.searched, 1);
  assert.equal(diagnostics.layout.payment.units, 1);

  const serialized = JSON.stringify(diagnostics.layout);
  const warnFragment = formatLayoutWarnFragment(diagnostics.layout);
  for (const leak of [
    '합성 회원',
    '000-0000-0000',
    '합성 주소',
    'synthetic@example.com',
    '이름',
    '휴대전화',
    '주소',
    '이메일',
    'synthetic-unit',
  ]) {
    assert.equal(serialized.includes(leak), false, `layout JSON leaked ${leak}`);
    assert.equal(warnFragment.includes(leak), false, `warn fragment leaked ${leak}`);
  }
  assert.match(
    warnFragment,
    /^layout=payment:t=1;searched=1;units=1;h=\[항목\|내용\];raw=4;eligible=0;tables=\[r=4,p=0,i=0\];out=0\[vi=0,vs=0,vt=0,h=0,o=0\];ifr=0;path=https:\/\/www\.sujain\.co\.kr\/mypage\/payment$/,
  );
  // Layout diagnostic object never carries a cells key.
  assert.equal(Object.hasOwn(diagnostics.layout.payment, 'cells'), false);
});

test('layout diagnostic builder never copies cell values from a capture payload', () => {
  const diagnostic = buildPageLayoutDiagnostic({
    sourcePage: 'payment',
    tableCount: 1,
    tableHeaders: [['항목', '금액']],
    rawRowCount: 1,
    eligibleRowCount: 0,
    tables: [{ rawRowCount: 1, preSkipRowCount: 2, formControlCount: 4 }],
    outsideTableFormControlCount: 1,
    outsideTableFormControls: {
      visibleInput: 0,
      visibleSelect: 1,
      visibleTextarea: 0,
      hidden: 0,
      other: 0,
    },
    iframeCount: 0,
    iframePaths: [],
    pagePath: 'https://www.sujain.co.kr/mypage/payment?tok=SECRET',
    searched: 1,
    units: 2,
    cells: ['합성 회원', '000-0000-0000', '500,000'],
    rows: [{ cells: ['합성 회원', '500,000'], headers: ['항목', '금액'] }],
    unitValue: 'synthetic-unit-1',
  });
  assert.ok(diagnostic);
  assert.equal(diagnostic.tableCount, 1);
  assert.deepEqual(diagnostic.tableHeaders, [['항목', '금액']]);
  assert.equal(diagnostic.rawRowCount, 1);
  assert.equal(diagnostic.eligibleRowCount, 0);
  assert.deepEqual(diagnostic.tables, [
    { rawRowCount: 1, preSkipRowCount: 2, formControlCount: 4 },
  ]);
  assert.equal(diagnostic.outsideTableFormControlCount, 1);
  assert.deepEqual(diagnostic.outsideTableFormControls, {
    visibleInput: 0,
    visibleSelect: 1,
    visibleTextarea: 0,
    hidden: 0,
    other: 0,
  });
  assert.equal(diagnostic.pagePath, 'https://www.sujain.co.kr/mypage/payment');
  assert.equal(diagnostic.searched, 1);
  assert.equal(diagnostic.units, 2);
  assert.equal(Object.hasOwn(diagnostic, 'cells'), false);
  assert.equal(Object.hasOwn(diagnostic, 'rows'), false);
  assert.equal(Object.hasOwn(diagnostic, 'unitValue'), false);
  assert.equal(JSON.stringify(diagnostic).includes('synthetic-unit'), false);
  const text = JSON.stringify(diagnostic);
  assert.equal(text.includes('합성 회원'), false);
  assert.equal(text.includes('000-0000-0000'), false);
  assert.equal(text.includes('500,000'), false);
  assert.equal(text.includes('SECRET'), false);
});

test('normalizeTableEvaluateResult accepts production object shape and array fixtures', () => {
  const fromObject = normalizeTableEvaluateResult({
    tableCount: 2,
    tableHeaders: [['항목', '내용'], ['구분', '금액']],
    tables: [
      { rawRowCount: 1, preSkipRowCount: 2, formControlCount: 0 },
      { rawRowCount: 1, preSkipRowCount: 2, formControlCount: 8 },
    ],
    outsideTableFormControlCount: 3,
    outsideTableFormControls: {
      visibleInput: 1,
      visibleSelect: 1,
      visibleTextarea: 0,
      hidden: 1,
      other: 0,
    },
    iframeCount: 1,
    iframePaths: ['https://www.sujain.co.kr/embed?token=SECRET'],
    rows: [
      { cells: ['이름', '합성 회원'], headers: ['항목', '내용'], sourcePage: 'payment' },
      { cells: ['계약금', '1,000'], headers: ['구분', '금액'], sourcePage: 'payment' },
    ],
  });
  assert.equal(fromObject.tableCount, 2);
  assert.deepEqual(fromObject.tableHeaders, [['항목', '내용'], ['구분', '금액']]);
  assert.deepEqual(fromObject.tables, [
    { rawRowCount: 1, preSkipRowCount: 2, formControlCount: 0 },
    { rawRowCount: 1, preSkipRowCount: 2, formControlCount: 8 },
  ]);
  assert.equal(fromObject.outsideTableFormControlCount, 3);
  assert.deepEqual(fromObject.outsideTableFormControls, {
    visibleInput: 1,
    visibleSelect: 1,
    visibleTextarea: 0,
    hidden: 1,
    other: 0,
  });
  assert.equal(fromObject.iframeCount, 1);
  assert.deepEqual(fromObject.iframePaths, ['https://www.sujain.co.kr/embed']);
  assert.equal(fromObject.rows.length, 2);

  const fromArray = normalizeTableEvaluateResult([
    { cells: ['이름', '합성 회원'], headers: ['항목', '내용'], sourcePage: 'payment' },
  ]);
  assert.equal(fromArray.tableCount, 1);
  assert.deepEqual(fromArray.tableHeaders, [['항목', '내용']]);
  assert.deepEqual(fromArray.tables, [
    { rawRowCount: 1, preSkipRowCount: 0, formControlCount: 0 },
  ]);
  assert.equal(fromArray.outsideTableFormControlCount, 0);
  assert.deepEqual(fromArray.outsideTableFormControls, {
    visibleInput: 0,
    visibleSelect: 0,
    visibleTextarea: 0,
    hidden: 0,
    other: 0,
  });
  assert.equal(fromArray.iframeCount, 0);
  assert.equal(fromArray.rows.length, 1);
});

test('input-backed payment rows from evaluate object are kept as eligible scrape rows', async () => {
  const paymentEvaluate = {
    tableCount: 2,
    tableHeaders: [
      ['회차', '약정일자', '약정금액', '납부일자', '납부원금', '연체료', '할인료', '실납부금'],
      ['이름*'],
    ],
    tables: [
      { rawRowCount: 1, preSkipRowCount: 2, formControlCount: 8 },
      { rawRowCount: 4, preSkipRowCount: 5, formControlCount: 0 },
    ],
    outsideTableFormControlCount: 0,
    outsideTableFormControls: {
      visibleInput: 0,
      visibleSelect: 0,
      visibleTextarea: 0,
      hidden: 0,
      other: 0,
    },
    iframeCount: 0,
    iframePaths: [],
    rows: [
      {
        cells: ['1', '2026-06-01', '10000000', '2026-06-02', '9000000', '0', '0', '9000000'],
        headers: ['회차', '약정일자', '약정금액', '납부일자', '납부원금', '연체료', '할인료', '실납부금'],
        sourcePage: 'payment',
      },
      { cells: ['합성 회원'], headers: ['이름*'], sourcePage: 'payment' },
      { cells: ['000-0000-0000'], headers: ['이름*'], sourcePage: 'payment' },
      { cells: ['합성 주소'], headers: ['이름*'], sourcePage: 'payment' },
      { cells: ['synthetic@example.com'], headers: ['이름*'], sourcePage: 'payment' },
    ],
  };
  const f = officialLoginPage({
    afterClick: 'navigate',
    paymentRows: paymentEvaluate,
  });
  const diagnostics = { stage: 'context', layout: {} };
  const result = await readSujainPages(f.page, job(), diagnostics);
  assert.ok(result.rows.some((row) => row.sourcePage === 'payment' && row.cells[2] === '10000000'));
  assert.equal(result.rows.some((row) => row.cells[0] === '합성 회원'), false);
  assert.equal(diagnostics.layout.payment.eligibleRowCount, 1);
  assert.deepEqual(diagnostics.layout.payment.tables, [
    { rawRowCount: 1, preSkipRowCount: 2, formControlCount: 8 },
    { rawRowCount: 4, preSkipRowCount: 5, formControlCount: 0 },
  ]);
  assert.equal(diagnostics.layout.payment.pagePath, 'https://www.sujain.co.kr/mypage/payment');
  const warnFragment = formatLayoutWarnFragment(diagnostics.layout);
  assert.match(warnFragment, /tables=\[r=1,p=2,i=8\],\[r=4,p=5,i=0\]/);
  assert.match(warnFragment, /path=https:\/\/www\.sujain\.co\.kr\/mypage\/payment/);
  assert.equal(warnFragment.includes('10000000'), false);
  assert.equal(warnFragment.includes('합성 회원'), false);
});

test('contact rows do not end the wait or hide a later eligible table', async () => {
  const f = officialLoginPage({ afterClick: 'navigate' });
  let evals = 0;
  f.page.evaluate = async () => {
    evals += 1;
    if (evals === 1) {
      return [{ cells: ['이름', '합성 회원'], headers: ['항목', '내용'], sourcePage: 'payment' }];
    }
    return [
      { cells: ['이름', '합성 회원'], headers: ['항목', '내용'], sourcePage: 'payment' },
      PAYMENT_ROW,
    ];
  };

  const result = await readSujainPages(f.page, job());
  assert.ok(evals >= 2);
  assert.equal(result.rows.some((row) => row.cells[0] === '이름'), false);
  assert.ok(result.rows.some((row) => row.cells[0] === '계약금1차'));
});
