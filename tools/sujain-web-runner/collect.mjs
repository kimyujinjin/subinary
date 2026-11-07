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
  return rows.slice(0, 100).map((row) => ({
    cells: (Array.isArray(row?.cells) ? row.cells : []).slice(0, 20).map((cell) => clip(cell, SUJAIN_CELL_MAX)),
    headers: (Array.isArray(row?.headers) ? row.headers : []).slice(0, 20).map((header) => clip(header, SUJAIN_HEADER_MAX)),
    sourcePage: row?.sourcePage === 'unit-items' ? 'unit-items' : 'payment',
  }));
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
 * Safe layout snapshot for one scrape page: table counts + header texts + row
 * counts + per-table raw/pre-skip/form-control counts + outside-table input
 * count + iframe count/paths + sanitized page path. Never includes cell values
 * (names, phones, amounts, dates), form-control values, or query strings.
 */
export function buildPageLayoutDiagnostic({
  sourcePage,
  tableCount,
  tableHeaders,
  rawRowCount,
  eligibleRowCount,
  tables,
  outsideTableFormControlCount,
  iframeCount,
  iframePaths,
  pagePath,
}) {
  return sanitizePageLayoutDiagnostic({
    sourcePage: sourcePage === 'unit-items' ? 'unit-items' : 'payment',
    tableCount,
    tableHeaders,
    rawRowCount,
    eligibleRowCount,
    tables,
    outsideTableFormControlCount,
    iframeCount,
    iframePaths,
    pagePath,
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

/**
 * Normalize page.evaluate output. Production returns
 * `{ tableCount, tableHeaders, tables, outsideTableFormControlCount,
 * iframeCount, iframePaths, rows }`; older/simple test fixtures may return a
 * bare row array — derive header sets from those rows, never invent cell text.
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

async function evaluateTableRows(page, sourcePage) {
  // captureSujainTables is self-contained (no closures) so Playwright can
  // serialize it into the page. It reads form-control values when td text is empty.
  const raw = await page.evaluate(captureSujainTables, sourcePage);

  const normalized = normalizeTableEvaluateResult(raw);
  const eligible = normalized.rows.filter(isEligibleSujainCapturedRow);
  let pageHref = '';
  try {
    pageHref = typeof page.url === 'function' ? page.url() : '';
  } catch {
    pageHref = '';
  }
  const layout = buildPageLayoutDiagnostic({
    sourcePage,
    tableCount: normalized.tableCount,
    tableHeaders: normalized.tableHeaders,
    rawRowCount: normalized.rows.length,
    eligibleRowCount: eligible.length,
    tables: normalized.tables,
    outsideTableFormControlCount: normalized.outsideTableFormControlCount,
    iframeCount: normalized.iframeCount,
    iframePaths: normalized.iframePaths,
    pagePath: pageHref,
  });
  return { rows: eligible, layout };
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
 * Read tables after a scrape goto. Some mypage targets fire a follow-up
 * same-tab navigation after DOMContentLoaded; the first evaluate then throws a
 * plain Error ("Execution context was destroyed"). Wait for load, retry evaluate
 * once after the next document settles, and keep polling until a non-empty data
 * cell appears (AJAX fill) or the wait budget expires.
 */
async function tableRows(page, sourcePage) {
  try {
    await page.waitForLoadState('load', { timeout: 10_000 });
  } catch {
    // load may already have fired or never will (long-lived connections).
  }

  const deadline = Date.now() + tableWaitMs();
  let destroyedRetried = false;
  let pageHref = '';
  try {
    pageHref = typeof page.url === 'function' ? page.url() : '';
  } catch {
    pageHref = '';
  }
  let last = {
    rows: [],
    layout: buildPageLayoutDiagnostic({
      sourcePage,
      tableCount: 0,
      tableHeaders: [],
      rawRowCount: 0,
      eligibleRowCount: 0,
      tables: [],
      outsideTableFormControlCount: 0,
      iframeCount: 0,
      iframePaths: [],
      pagePath: pageHref,
    }),
  };

  while (true) {
    try {
      last = await evaluateTableRows(page, sourcePage);
    } catch (error) {
      if (!isExecutionContextDestroyedError(error) || destroyedRetried) throw error;
      destroyedRetried = true;
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
      } catch {
        throw error;
      }
      if (isLoginUrl(page.url())) throw new SujainReadError('authentication_required');
      continue;
    }

    if (last.rows.some(rowHasDataCell)) return last;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await pauseBetweenTablePolls(page, Math.min(250, remaining));
  }

  return last;
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
 * 공식 로그인 뒤 분양대금조회·세대 내 설치 품목을 한 번에 읽는다.
 * 2FA·캡차는 우회하지 않고 authentication_required로 돌린다.
 * diagnostics.stage is an allowlisted token only (login / scrape_*), never URLs.
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

  const rows = [];
  if (diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)) {
    diagnostics.layout = diagnostics.layout && typeof diagnostics.layout === 'object'
      ? diagnostics.layout
      : {};
  }

  for (const [url, sourcePage] of [
    [SUJAIN_URLS.payment, 'payment'],
    [SUJAIN_URLS.unitItems, 'unit-items'],
  ]) {
    setStage(sourcePage === 'payment' ? 'scrape_payment' : 'scrape_unit_items');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    } catch {
      throw new SujainReadError('network_error');
    }
    if (isLoginUrl(page.url())) throw new SujainReadError('authentication_required');
    const captured = await tableRows(page, sourcePage);
    if (diagnostics && typeof diagnostics === 'object' && diagnostics.layout
      && captured.layout) {
      diagnostics.layout[sourcePage] = captured.layout;
    }
    for (const row of captured.rows) rows.push(row);
  }

  if (rows.length === 0) {
    // Both scrape pages waited and still had no table data — do not report
    // ok:true with [] (that becomes an empty confirm list that looks unchanged).
    throw new SujainReadError('unsupported_layout');
  }

  return {
    capturedAt: new Date().toISOString(),
    rows: normalizeCapturedRows(rows),
  };
}
