import {
  SujainReadError,
  isLoginUrl,
  sanitizeLayoutPagePath,
  sanitizePageLayoutDiagnostic,
} from './policy.mjs';
import { captureSujainTables } from './table-capture.mjs';
import { SUJAIN_URLS } from './urls.mjs';

/** Must match apps/api sujain-browser responseSchema string caps. */
export const SUJAIN_CELL_MAX = 200;
export const SUJAIN_HEADER_MAX = 100;
export const SUJAIN_ITEM_LABEL_MAX = 200;

/**
 * 분양대금조회(/mypage/payment) 확인된 구조(2026-11-08): 처음엔 표가 비어 있고, 표 밖 단지
 * select#preInsp 에서 세대를 고른 뒤 onclick="searchPayment(); …" 버튼을 눌러야 표가 채워진다.
 */
export const SUJAIN_UNIT_SELECT = 'select#preInsp';
export const SUJAIN_SEARCH_BUTTON = '[onclick*="searchPayment"]:visible';

function text(value) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function clip(value, max) {
  const clipped = text(value);
  return clipped.length <= max ? clipped : clipped.slice(0, max);
}

/** Truncate cell/header strings to API schema caps so ok:true is not discarded. */
export function normalizeCapturedRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 100).map((row) => {
    const section = row?.section === 'option' ? 'option' : 'payment';
    const normalized = {
      cells: (Array.isArray(row?.cells) ? row.cells : []).slice(0, 20).map((cell) => clip(cell, SUJAIN_CELL_MAX)),
      headers: (Array.isArray(row?.headers) ? row.headers : []).slice(0, 20).map((header) => clip(header, SUJAIN_HEADER_MAX)),
      // 모든 줄은 분양대금조회 화면에서 온다(세대 내 설치 품목은 입주 뒤에만 열려 읽지 않는다).
      sourcePage: 'payment',
      section,
    };
    if (section === 'option' && typeof row?.itemLabel === 'string') {
      const itemLabel = clip(row.itemLabel, SUJAIN_ITEM_LABEL_MAX);
      if (itemLabel) normalized.itemLabel = itemLabel;
    }
    return normalized;
  });
}

/**
 * Keep only tables that look like 분양대금 / 옵션 (amount-like or option-like headers,
 * or payment-kind cell text). Member-profile / contact tables (이름·휴대전화·주소·이메일
 * under a bare 항목/이름 column) must not end the AJAX wait or become scrape rows.
 * Keep in sync with apps/api/.../sujain-parse.ts isEligibleSujainRow.
 */
export function isEligibleSujainCapturedRow(row) {
  const headers = Array.isArray(row?.headers) ? row.headers : [];
  if (headers.some((header) => /예정(?!일)|금액|분양가|대금/u.test(header))) return true;
  if (headers.some((header) => /옵션|유상|설치\s*품목|품목/u.test(header))) return true;
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const joined = [...headers, ...cells].join(' ');
  return /계약금|중도금|잔금|옵션|유상|설치\s*품목/u.test(joined);
}

/**
 * Safe layout snapshot for the payment page: table counts + header texts + row
 * counts + per-table raw/pre-skip/form-control counts + outside-table input
 * count + visibility/kind breakdown + iframe count/paths + sanitized page path
 * + searched(0/1) + units(단지 option 개수). Never includes cell values (names,
 * phones, amounts, dates), form-control values, option values/text, or query strings.
 */
export function buildPageLayoutDiagnostic({
  tableCount,
  tableHeaders,
  rawRowCount,
  eligibleRowCount,
  tables,
  outsideTableFormControlCount,
  outsideTableFormControls,
  iframeCount,
  iframePaths,
  pagePath,
  searched,
  units,
}) {
  return sanitizePageLayoutDiagnostic({
    sourcePage: 'payment',
    tableCount,
    tableHeaders,
    rawRowCount,
    eligibleRowCount,
    tables,
    outsideTableFormControlCount,
    outsideTableFormControls,
    iframeCount,
    iframePaths,
    pagePath,
    searched,
    units,
  });
}

function normalizeNonNegInt(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), max);
}

function normalizeTableStats(rawTables, fallbackHeaders, rows) {
  if (Array.isArray(rawTables)) {
    const out = [];
    for (const entry of rawTables.slice(0, 20)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      out.push({
        rawRowCount: normalizeNonNegInt(entry.rawRowCount, 1000),
        preSkipRowCount: normalizeNonNegInt(entry.preSkipRowCount, 1000),
        formControlCount: normalizeNonNegInt(entry.formControlCount, 1000),
      });
    }
    return out;
  }
  // Array-shaped evaluate fixtures have no per-table form counts — derive raw
  // counts from captured rows per header set; preSkip/formControl stay 0.
  const headers = Array.isArray(fallbackHeaders) ? fallbackHeaders : [];
  return headers.slice(0, 20).map((cols) => {
    const key = (Array.isArray(cols) ? cols : []).join('\u0001');
    const rawRowCount = rows.filter((row) => row.headers.join('\u0001') === key).length;
    return {
      rawRowCount: Math.min(rawRowCount, 1000),
      preSkipRowCount: 0,
      formControlCount: 0,
    };
  });
}

function normalizeIframePaths(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value.slice(0, 20)) {
    const path = sanitizeLayoutPagePath(entry);
    if (path) out.push(path);
  }
  return out;
}

const EMPTY_OUTSIDE_TABLE_FORM_CONTROLS = {
  visibleInput: 0,
  visibleSelect: 0,
  visibleTextarea: 0,
  hidden: 0,
  other: 0,
};

function normalizeOutsideTableFormControls(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  return {
    visibleInput: normalizeNonNegInt(source?.visibleInput, 1000),
    visibleSelect: normalizeNonNegInt(source?.visibleSelect, 1000),
    visibleTextarea: normalizeNonNegInt(source?.visibleTextarea, 1000),
    hidden: normalizeNonNegInt(source?.hidden, 1000),
    other: normalizeNonNegInt(source?.other, 1000),
  };
}

/**
 * Normalize page.evaluate output. Production returns
 * `{ tableCount, tableHeaders, tables, outsideTableFormControlCount,
 * outsideTableFormControls, iframeCount, iframePaths, rows }`; older/simple
 * test fixtures may return a bare row array — derive header sets from those
 * rows, never invent cell text.
 */
export function normalizeTableEvaluateResult(raw) {
  if (Array.isArray(raw)) {
    const rows = normalizeCapturedRows(raw);
    const seen = new Set();
    const tableHeaders = [];
    for (const row of rows) {
      const key = row.headers.join('\u0001');
      if (!row.headers.length || seen.has(key)) continue;
      seen.add(key);
      tableHeaders.push(row.headers.slice(0, 20));
    }
    const headers = tableHeaders.slice(0, 20);
    return {
      tableCount: headers.length,
      tableHeaders: headers,
      tables: normalizeTableStats(undefined, headers, rows),
      outsideTableFormControlCount: 0,
      outsideTableFormControls: { ...EMPTY_OUTSIDE_TABLE_FORM_CONTROLS },
      iframeCount: 0,
      iframePaths: [],
      rows,
    };
  }
  if (!raw || typeof raw !== 'object') {
    return {
      tableCount: 0,
      tableHeaders: [],
      tables: [],
      outsideTableFormControlCount: 0,
      outsideTableFormControls: { ...EMPTY_OUTSIDE_TABLE_FORM_CONTROLS },
      iframeCount: 0,
      iframePaths: [],
      rows: [],
    };
  }
  const tableHeaders = [];
  if (Array.isArray(raw.tableHeaders)) {
    for (const headers of raw.tableHeaders.slice(0, 20)) {
      if (!Array.isArray(headers)) continue;
      tableHeaders.push(
        headers.slice(0, 20).map((header) => clip(header, SUJAIN_HEADER_MAX)).filter(Boolean),
      );
    }
  }
  const tableCountRaw = Number(raw.tableCount);
  const tableCount = Number.isFinite(tableCountRaw) && tableCountRaw >= 0
    ? Math.min(Math.trunc(tableCountRaw), 100)
    : tableHeaders.length;
  const rows = normalizeCapturedRows(raw.rows);
  return {
    tableCount,
    tableHeaders,
    tables: normalizeTableStats(raw.tables, tableHeaders, rows),
    outsideTableFormControlCount: normalizeNonNegInt(raw.outsideTableFormControlCount, 1000),
    outsideTableFormControls: normalizeOutsideTableFormControls(raw.outsideTableFormControls),
    iframeCount: normalizeNonNegInt(raw.iframeCount, 100),
    iframePaths: normalizeIframePaths(raw.iframePaths),
    rows,
  };
}

/** Official ajax failure alerts — not the post-login success toast. */
function isCredentialFailureDialog(message) {
  return /실패|오류|틀렸|일치하지|아이디|비밀번호|잘못|없/u.test(message)
    && !isLoginSuccessDialog(message);
}

/**
 * Official /login/result alert after loginproc success.
 * Must not be treated as extra auth (authentication_required).
 */
function isLoginSuccessDialog(message) {
  return /정상적으로\s*로그인/u.test(message);
}

async function waitUntilLeftLogin(page, timeout = 15_000) {
  try {
    await page.waitForURL(
      (next) => {
        try {
          const href = typeof next === 'string' ? next : next.href;
          return !isLoginUrl(href);
        } catch {
          return false;
        }
      },
      { timeout },
    );
  } catch {
    throw new SujainReadError('authentication_required');
  }
}

/**
 * Playwright's fixed English phrase when a same-tab navigation tears down the
 * world mid-evaluate. Used only for one retry gate — never logged or returned.
 */
function isExecutionContextDestroyedError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.name !== 'Error') return false;
  const message = typeof error.message === 'string' ? error.message : '';
  return /Execution context was destroyed/u.test(message);
}

function currentUrl(page) {
  try {
    return typeof page.url === 'function' ? page.url() : '';
  } catch {
    return '';
  }
}

/** searched(조회 버튼을 눌렀는지 0/1)·units(단지 option 개수)만 — 값은 넣지 않는다. */
function layoutExtra(extra) {
  return {
    searched: extra?.searched === 1 ? 1 : 0,
    units: Number.isInteger(extra?.units) && extra.units > 0 ? Math.min(extra.units, 100) : 0,
  };
}

async function evaluateTableRows(page, extra = {}) {
  // captureSujainTables is self-contained (no closures) so Playwright can
  // serialize it into the page. It reads form-control values when td text is empty.
  const raw = await page.evaluate(captureSujainTables, 'payment');

  const normalized = normalizeTableEvaluateResult(raw);
  const eligible = normalized.rows.filter(isEligibleSujainCapturedRow);
  const layout = buildPageLayoutDiagnostic({
    tableCount: normalized.tableCount,
    tableHeaders: normalized.tableHeaders,
    rawRowCount: normalized.rows.length,
    eligibleRowCount: eligible.length,
    tables: normalized.tables,
    outsideTableFormControlCount: normalized.outsideTableFormControlCount,
    outsideTableFormControls: normalized.outsideTableFormControls,
    iframeCount: normalized.iframeCount,
    iframePaths: normalized.iframePaths,
    pagePath: currentUrl(page),
    ...layoutExtra(extra),
  });
  return { rows: eligible, layout };
}

function emptyPaymentLayout(page, extra = {}) {
  return buildPageLayoutDiagnostic({
    tableCount: 0,
    tableHeaders: [],
    rawRowCount: 0,
    eligibleRowCount: 0,
    tables: [],
    outsideTableFormControlCount: 0,
    outsideTableFormControls: { ...EMPTY_OUTSIDE_TABLE_FORM_CONTROLS },
    iframeCount: 0,
    iframePaths: [],
    pagePath: currentUrl(page),
    ...layoutExtra(extra),
  });
}

/** Cap for waiting until a scrape table paints at least one non-empty data cell. */
function tableWaitMs() {
  const raw = process.env.SUJAIN_TABLE_WAIT_MS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.min(n, 60_000);
  }
  return 15_000;
}

/** Playwright 에서 timeout 0 은 '무한'이라 1ms 이상으로 둔다. */
function unitSelectWaitMs() {
  return Math.max(1, Math.min(tableWaitMs(), 10_000));
}

/**
 * select 의 option 이 서버가 그린 것인지 스크립트가 채우는 것인지는 확인하지 못했다.
 * 실제 option 이 0개면 잠깐(최대 3초)만 다시 센 뒤 미등록으로 본다.
 */
function unitOptionWaitMs() {
  return Math.min(tableWaitMs(), 3_000);
}

function rowHasDataCell(row) {
  return Array.isArray(row?.cells) && row.cells.some((cell) => text(cell));
}

async function pauseBetweenTablePolls(page, ms) {
  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 조회 버튼을 누른 뒤 표를 읽는다. 사이트 조회는 동기 XHR 이라 클릭이 끝나면 대개 이미
 * 채워져 있지만, 보이는 표의 tbody 에 칸 있는 줄이 생길 때까지 표 대기 예산 안에서 다시 읽는다.
 * 같은 탭 후속 이동으로 evaluate 가 "Execution context was destroyed" 로 깨지면 다음 문서가
 * 자리 잡은 뒤 한 번만 다시 읽는다.
 */
async function tableRows(page, extra = {}) {
  const deadline = Date.now() + tableWaitMs();
  const shouldStop = typeof extra.shouldStop === 'function' ? extra.shouldStop : () => false;
  let destroyedRetried = false;
  let last = { rows: [], layout: emptyPaymentLayout(page, extra) };

  while (true) {
    try {
      last = await evaluateTableRows(page, extra);
    } catch (error) {
      if (!isExecutionContextDestroyedError(error) || destroyedRetried) throw error;
      destroyedRetried = true;
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
      } catch {
        throw error;
      }
      if (isLoginUrl(currentUrl(page))) throw new SujainReadError('authentication_required');
      continue;
    }

    if (last.rows.some(rowHasDataCell)) return last;
    if (shouldStop()) break;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await pauseBetweenTablePolls(page, Math.min(250, remaining));
  }

  return last;
}

/**
 * 단지 select 안에서 값이 빈 자리표시('선택')와 비활성 option 을 뺀 실제 세대 option 수와
 * 첫 위치만 돌려준다(단지 코드·동호수 글자는 돌려주지 않는다). locator.evaluate 로 브라우저에서
 * 돌기 때문에 바깥 변수를 쓰지 않는다.
 */
export function countUnitOptions(select) {
  const options = Array.from(select?.options ?? []);
  let count = 0;
  let firstIndex = -1;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (!option || option.disabled) continue;
    if (String(option.value ?? '').trim() === '') continue;
    count += 1;
    if (firstIndex < 0) firstIndex = index;
  }
  return { count: Math.min(count, 100), firstIndex };
}

async function readUnitOptions(select) {
  const raw = await select.evaluate(countUnitOptions);
  const count = Number.isInteger(raw?.count) && raw.count > 0 ? Math.min(raw.count, 100) : 0;
  const firstIndex = Number.isInteger(raw?.firstIndex) ? raw.firstIndex : -1;
  return count > 0 && firstIndex >= 0 ? { count, firstIndex } : { count: 0, firstIndex: -1 };
}

/** 알림 글자는 분류에만 쓰고 진단·오류에 남기지 않는다. */
function isSessionLostDialog(message) {
  return /로그인|세션|인증|만료/u.test(message);
}

/**
 * 사이트 알림(dialog)을 바로 닫고 뜬 적이 있는지만 기억한다. Playwright 는 dialog 리스너가
 * 하나라도 있으면 자동으로 닫지 않는데, 로그인 단계의 waitForEvent('dialog') 가 최대 15초
 * 남아 있을 수 있어 분양대금 화면으로 가기 전부터 붙여 화면이 알림에 묶이지 않게 한다.
 * 오류 판단은 조회 직전에 reset() 한 뒤 뜬 알림만 본다.
 */
function watchDialogs(page) {
  const state = { seen: false, sessionLost: false };
  const onDialog = (dialog) => {
    let message = '';
    try {
      message = text(typeof dialog?.message === 'function' ? dialog.message() : '');
    } catch {
      message = '';
    }
    state.seen = true;
    if (isSessionLostDialog(message)) state.sessionLost = true;
    message = '';
    Promise.resolve()
      .then(() => (typeof dialog?.dismiss === 'function' ? dialog.dismiss() : null))
      .catch(() => null);
  };
  const canListen = typeof page.on === 'function';
  if (canListen) page.on('dialog', onDialog);
  return {
    state,
    reset() {
      state.seen = false;
      state.sessionLost = false;
    },
    stop() {
      if (!canListen) return;
      if (typeof page.off === 'function') page.off('dialog', onDialog);
      else if (typeof page.removeListener === 'function') page.removeListener('dialog', onDialog);
    },
  };
}

/**
 * 조회 뒤 알림 → 오류 코드. 세션이 끊기면 사이트가 로그인 안내를 띄우므로 다시 로그인해야 하는
 * authentication_required. 그 밖의 알림(조회 실패 등)은 같은 흐름으로 다시 눌러도 같은 결과일
 * 가능성이 커 unsupported_layout 으로 두고, 진단 searched=1 로 '조회는 눌렀다'를 구분한다.
 */
function dialogError(state) {
  return new SujainReadError(state.sessionLost ? 'authentication_required' : 'unsupported_layout');
}

/**
 * 분양대금조회: 단지 select 에서 첫 세대를 고르고 조회 버튼을 누른 뒤 보이는 표(아파트 분양대금 +
 * 별도 계약 품목)를 읽는다. 실패 경로마다 값 없는 레이아웃 진단(머리 글자·개수·searched·units)을 남긴다.
 */
async function readPaymentPage(page, diagnostics, dialogs) {
  const wantsLayout = Boolean(
    diagnostics && typeof diagnostics === 'object' && diagnostics.layout && typeof diagnostics.layout === 'object',
  );
  const record = (layout) => {
    if (wantsLayout && layout) diagnostics.layout.payment = layout;
  };
  const snapshot = async (extra) => {
    if (!wantsLayout) return;
    try {
      record((await evaluateTableRows(page, extra)).layout);
    } catch {
      // 진단 수집 실패가 원래 오류 코드를 덮지 않게 빈 진단만 남긴다.
      record(emptyPaymentLayout(page, extra));
    }
  };

  const select = page.locator(SUJAIN_UNIT_SELECT).first();
  try {
    await select.waitFor({ state: 'attached', timeout: unitSelectWaitMs() });
  } catch {
    if (isLoginUrl(currentUrl(page))) throw new SujainReadError('authentication_required');
    await snapshot({ searched: 0, units: 0 });
    throw new SujainReadError('unsupported_layout');
  }

  let unit = await readUnitOptions(select);
  const optionDeadline = Date.now() + unitOptionWaitMs();
  while (unit.count === 0 && Date.now() < optionDeadline) {
    await pauseBetweenTablePolls(page, Math.min(250, Math.max(1, optionDeadline - Date.now())));
    unit = await readUnitOptions(select);
  }
  if (unit.count === 0) {
    await snapshot({ searched: 0, units: 0 });
    throw new SujainReadError('unit_not_registered');
  }
  const units = unit.count;

  // 세대가 여러 개여도 이번에는 첫 번째만 읽는다(개수는 진단 units 로만 남긴다).
  // force: searchPayment 는 #preInsp 의 선택값만 보므로 꾸밈 요소가 select 를 가려도 고를 수 있게 한다.
  try {
    await select.selectOption({ index: unit.firstIndex }, { force: true, timeout: 5_000 });
  } catch (error) {
    await snapshot({ searched: 0, units });
    throw error;
  }

  const button = page.locator(SUJAIN_SEARCH_BUTTON).first();
  if ((await button.count()) === 0) {
    await snapshot({ searched: 0, units });
    throw new SujainReadError('unsupported_layout');
  }

  // 화면을 여는 동안 뜬 안내 알림은 닫기만 하고, 조회 뒤 알림만 오류 판단에 쓴다.
  dialogs.reset();
  try {
    // 사이트 조회는 동기 XHR(timeout 10초)이라 클릭이 그동안 묶일 수 있어 기본 5초보다 길게 둔다.
    await button.click({ timeout: 15_000 });
  } catch (error) {
    if (!dialogs.state.seen) {
      await snapshot({ searched: 0, units });
      throw error;
    }
  }
  if (dialogs.state.seen) {
    await snapshot({ searched: 1, units });
    throw dialogError(dialogs.state);
  }
  if (isLoginUrl(currentUrl(page))) throw new SujainReadError('authentication_required');

  const captured = await tableRows(page, {
    searched: 1,
    units,
    shouldStop: () => dialogs.state.seen,
  });
  record(captured.layout);
  if (captured.rows.length > 0) return captured.rows;
  if (dialogs.state.seen) throw dialogError(dialogs.state);
  if (isLoginUrl(currentUrl(page))) throw new SujainReadError('authentication_required');
  // 조회까지 했는데 읽을 표 줄이 없다 — 빈 확인 목록을 ok:true 로 돌리지 않는다.
  throw new SujainReadError('unsupported_layout');
}

/**
 * Official login uses form#frm + #id/#pw + a.btnLogin (ajax /login/loginproc then form submit).
 * Prefer the site's own click handler; do not POST loginproc or strip CSRF ourselves.
 */
async function fillLogin(page, credentials) {
  const form = page.locator('form#frm').first();
  const scope = (await form.count()) > 0 ? form : page;

  const user = scope.locator('#id, input[name="userid"]').first();
  const pass = scope.locator('#pw, input[name="userpwd"]').first();
  if (await user.count() === 0 || await pass.count() === 0) {
    throw new SujainReadError('unsupported_layout');
  }
  await user.fill(credentials.loginId, { timeout: 5_000 });
  await pass.fill(credentials.password, { timeout: 5_000 });

  const submit = page.locator(
    'form#frm a.btnLogin, a.btnLogin, button[type="submit"], input[type="submit"], button:has-text("로그인")',
  ).first();
  if (await submit.count() === 0) throw new SujainReadError('unsupported_layout');

  const dialogPromise = page.waitForEvent('dialog', { timeout: 15_000 })
    .then((dialog) => ({ kind: 'dialog', dialog }));
  const leftLoginPromise = page.waitForURL(
    (next) => {
      try {
        const href = typeof next === 'string' ? next : next.href;
        return !isLoginUrl(href);
      } catch {
        return false;
      }
    },
    { timeout: 15_000 },
  ).then(() => ({ kind: 'navigated' }));
  // Loser rejection must not become an unhandled rejection after race settles.
  dialogPromise.catch(() => {});
  leftLoginPromise.catch(() => {});

  await submit.click({ timeout: 5_000 });

  const outcome = await Promise.race([dialogPromise, leftLoginPromise]).catch(() => null);

  if (outcome?.kind === 'dialog') {
    const message = text(outcome.dialog.message?.() ?? '');
    await outcome.dialog.dismiss().catch(() => null);
    if (isCredentialFailureDialog(message)) {
      throw new SujainReadError('credentials_invalid');
    }
    // Success alert on /login/result: dismiss, then wait past login URLs (/index etc.).
    if (isLoginSuccessDialog(message)) {
      await waitUntilLeftLogin(page);
      return;
    }
    // Real captcha / 2FA / extra-auth dialogs stay authentication_required.
    throw new SujainReadError('authentication_required');
  }
}

/**
 * 공식 로그인 뒤 분양대금조회 한 화면에서 분양대금·별도 계약 품목(옵션) 표를 읽는다.
 * 세대 내 설치 품목(/mypage/unit-items)은 입주 뒤에만 메뉴가 열리고 입주 전 계정은
 * /mypage/payment 로 되돌려지므로 가지 않는다(옵션 대금은 별도 계약 품목 표에 있다).
 * 2FA·캡차는 우회하지 않고 authentication_required로 돌린다.
 * diagnostics.stage is an allowlisted token only (login / scrape_payment), never URLs.
 */
export async function readSujainPages(page, job, diagnostics = null) {
  const setStage = (stage) => {
    if (diagnostics && typeof diagnostics === 'object') diagnostics.stage = stage;
  };

  setStage('login');
  try {
    await page.goto(SUJAIN_URLS.login, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } catch {
    throw new SujainReadError('network_error');
  }

  await fillLogin(page, job.credentials);

  const captcha = await page.locator('text=/캡차|자동입력|추가\\s*인증|2단계|본인\\s*인증/u').count();
  if (captcha > 0) throw new SujainReadError('authentication_required');

  const afterLogin = page.url();
  if (isLoginUrl(afterLogin)) {
    const failed = await page.locator('text=/실패|오류|틀렸|일치하지/u').count();
    throw new SujainReadError(failed > 0 ? 'credentials_invalid' : 'authentication_required');
  }

  if (diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)) {
    diagnostics.layout = diagnostics.layout && typeof diagnostics.layout === 'object'
      ? diagnostics.layout
      : {};
  }

  setStage('scrape_payment');
  const dialogs = watchDialogs(page);
  try {
    try {
      await page.goto(SUJAIN_URLS.payment, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    } catch {
      throw new SujainReadError('network_error');
    }
    if (isLoginUrl(currentUrl(page))) throw new SujainReadError('authentication_required');
    try {
      await page.waitForLoadState('load', { timeout: 10_000 });
    } catch {
      // load may already have fired or never will (long-lived connections).
    }

    const rows = await readPaymentPage(page, diagnostics, dialogs);
    return {
      capturedAt: new Date().toISOString(),
      rows: normalizeCapturedRows(rows),
    };
  } finally {
    dialogs.stop();
  }
}
