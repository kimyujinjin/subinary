import { BANK_ORIGIN, LOGIN_URL, BankReadError, keyFor, selectedCapture, validateJob } from './policy.mjs';
import { collectShinhanLoans } from './shinhan-collector.mjs';
import { collectShinhanDeposits } from './shinhan-deposits.mjs';

const keyButton = (page, name) => page.getByRole('button', { name, exact: true });
const requireBank = page => { if (new URL(page.url()).origin !== BANK_ORIGIN) throw new BankReadError('authentication_required'); };

async function closeInstallationGuide(page) {
  const guide = page.locator('.w2popup_window').filter({ visible: true, hasText: '인터넷뱅킹 보안프로그램설치안내' });
  const count = await guide.count();
  if (count > 1) throw new BankReadError('unsupported_layout');
  if (count === 0) return false;
  requireBank(page);
  // Dismiss this exact informational guide using the bank's own close control.
  // Do not install software, accept agreements, suppress an unknown modal, or
  // change any security setting. The normal keyboard still has to work below.
  await guide.getByText('닫기', { exact: true }).click({ timeout: 5000 });
  await guide.waitFor({ state: 'hidden', timeout: 5000 });
  requireBank(page);
  return true;
}

async function openNormalKeyboard(page) {
  requireBank(page);
  const trigger = page.locator('a[id="비밀번호_tk_btn"]').filter({ visible: true });
  const enter = keyButton(page, '오른쪽 엔터');
  await trigger.waitFor({ state: 'visible', timeout: 15_000 });
  await closeInstallationGuide(page);
  if (!await enter.isVisible()) {
    try { await trigger.click({ timeout: 15_000 }); }
    catch {
      if (await closeInstallationGuide(page)) {
        // The public guide can arrive after the login form has rendered.
        await trigger.click({ timeout: 15_000 });
      } else {
        // A UI action may open the bank keyboard before the control changes state.
        // Never force a disabled input or continue unless the normal keyboard opens.
        try { await enter.waitFor({ state: 'visible', timeout: 5000 }); }
        catch { throw new BankReadError('unsupported_layout'); }
      }
    }
  }
  await enter.waitFor({ state: 'visible', timeout: 15_000 });
  requireBank(page);
  return enter;
}

/** Public preflight: prove the required security UI works before any credential is entered. */
export async function prepareShinhanLogin(page) {
  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    requireBank(page);
    await page.locator('#ibx_loginId').waitFor({ state: 'visible', timeout: 15_000 });
    const password = page.locator('input[type="password"]').filter({ visible: true });
    if (await password.count() !== 1) throw new BankReadError('authentication_required');
    const enter = await openNormalKeyboard(page);
    await keyButton(page, '가상키보드 닫기').click({ timeout: 5000 });
    await enter.waitFor({ state: 'hidden', timeout: 5000 });
    requireBank(page);
  } catch (error) {
    if (error instanceof BankReadError) throw error;
    throw new BankReadError('unsupported_layout');
  }
}

async function finishNormalBankSession(page, allowMissing) {
  try {
    requireBank(page);
    const links = () => page.getByRole('link', { name: '로그아웃', exact: true }).filter({ visible: true });
    const logout = links();
    const count = await logout.count();
    // A rejected or unconfirmed login may have no session to end. This is only
    // allowed while preserving a failed read, never when returning an observation.
    if (allowMissing && count === 0) return;
    if (count !== 1) throw new BankReadError('operation_unknown');
    requireBank(page);
    await logout.click({ timeout: 5000 });
    await logout.waitFor({ state: 'hidden', timeout: 8000 });
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    requireBank(page);
    await page.locator('#ibx_loginId').waitFor({ state: 'visible', timeout: 5000 });
    if (await links().count() !== 0) throw new BankReadError('operation_unknown');
  } catch { throw new BankReadError('operation_unknown'); }
}

/** Deterministic ordinary UI only; no network endpoint calls, sessions, certificate extraction or CAPTCHA handling. */
export async function readShinhanAccount(page, job) {
  validateJob(job);
  const safe = () => { if (new URL(page.url()).origin !== BANK_ORIGIN) throw new BankReadError('authentication_required'); };
  const button = name => page.getByRole('button', { name, exact: true });
  const visibleLinks = name => page.getByRole('link', { name, exact: true }).filter({ visible: true });
  let loginSubmitted = false, authenticationConfirmed = false, logoutStarted = false;
  try {
    await prepareShinhanLogin(page);
    safe();
    await page.locator('#ibx_loginId').fill(job.credentials.loginId, { timeout: 5000 });
    await openNormalKeyboard(page);
    let shift = false;
    for (const character of job.credentials.password) {
      safe();
      const key = keyFor(character);
      if (key.shift !== shift) { await button('왼쪽 쉬프트').click({ timeout: 3000 }); shift = key.shift; }
      await button(key.label).click({ timeout: 3000 });
    }
    await button('오른쪽 엔터').click({ timeout: 3000 });
    safe();
    // Exactly one login submission. Do not retry an invalid/unknown credential result.
    loginSubmitted = true;
    await visibleLinks('ID 로그인').click({ timeout: 3000 });
    const notice = page.locator('#grp_alertlayer');
    try { await notice.waitFor({ state: 'visible', timeout: 4000 }); } catch { /* Login can complete without a notice. */ }
    if (await notice.isVisible()) {
      const text = await notice.innerText();
      if (text.includes('ID로그인 시에는 이용 가능한 서비스가 제한') && text.includes('단순 계좌 조회')) {
        await notice.getByRole('link', { name: '확인', exact: true }).click();
      } else if (/비밀번호|이용자ID|아이디/u.test(text) && /일치하지|잘못|오류|확인하시/u.test(text)) {
        throw new BankReadError('credentials_invalid');
      } else throw new BankReadError('authentication_required');
    }
    try { await visibleLinks('로그아웃').waitFor({ state: 'visible', timeout: 8000 }); }
    catch { throw new BankReadError('authentication_required'); }
    authenticationConfirmed = true;
    safe();
    await visibleLinks('조회').first().click();
    const deposit = job.selector.accountType === 'deposit';
    const accountLinks = visibleLinks(deposit ? '예금/신탁' : '대출');
    await accountLinks.first().waitFor({ state: 'visible', timeout: 8000 });
    if (await accountLinks.count() > 2) throw new BankReadError('unsupported_layout');
    // The first visible link is the query sidebar. The duplicate content tab
    // can remain on deposits without navigating in the current bank UI.
    await accountLinks.first().click();
    if (deposit) {
      // Observed on the normal bank UI: the current-account table is named
      // separately from term/savings/trust and FX. No currency heading assumed.
      await page.getByRole('table', { name: /^입\/출금\s*계좌정보(?:\s*은\(는\)|\s*$)/u }).filter({ visible: true })
        .waitFor({ state: 'visible', timeout: 8000 });
    } else {
      await page.getByRole('heading', { name: '원화 대출', exact: true }).waitFor({ state: 'visible', timeout: 8000 });
    }
    safe();
    const observed = deposit ? await page.evaluate(collectShinhanDeposits, { selector: job.selector }) : await page.evaluate(collectShinhanLoans);
    if (!observed?.ok && observed?.error === 'ACCOUNT_AMBIGUOUS') throw new BankReadError('account_ambiguous');
    const capture = selectedCapture(observed, job.selector);
    // Finish the normal bank session before returning an observation. Closing a
    // temporary browser context alone does not prove bank-side logout occurred.
    logoutStarted = true;
    await finishNormalBankSession(page, false);
    return capture;
  } catch (error) {
    if (loginSubmitted && !logoutStarted) {
      // A query/selection error or ambiguous login click can still leave a bank
      // session active. Attempt normal cleanup once; never resubmit login or
      // repeat a logout whose result is unknown.
      logoutStarted = true;
      await finishNormalBankSession(page, !authenticationConfirmed);
    }
    if (error instanceof BankReadError) throw error;
    // Playwright errors may include input strings/selectors/page text: discard them entirely.
    throw new BankReadError('unsupported_layout');
  } finally {
    job.credentials.password = '';
    job.credentials.loginId = '';
  }
}

// Preserve existing local callers while the runner now supports both account kinds.
export const readShinhanLoan = readShinhanAccount;
