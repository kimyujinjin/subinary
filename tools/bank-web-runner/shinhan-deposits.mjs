/** Live-observed accessible labels; DOM extraction still requires runtime verification. */
export async function collectShinhanDeposits({ selector, rootDocument = globalThis.document } = {}) {
  const fail = code => { throw Object.assign(new Error('Unsupported deposit page'), { safeCode: code }); };
  const full = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
  const safeCodes = new Set(['INVALID_SELECTOR','WRONG_ORIGIN','UNSUPPORTED_FRAME','UNSUPPORTED_PAGE','NO_SUPPORTED_TABLE',
    'AMBIGUOUS_TABLE','AMBIGUOUS_COLUMNS','UNSUPPORTED_LAYOUT','INVALID_ACCOUNT','INVALID_AMOUNT','MISSING_KRW_UNIT','ACCOUNT_AMBIGUOUS','CRYPTO_UNAVAILABLE']);
  try {
    if (!selector || selector.accountType !== 'deposit' || !full(/^[0-9]{4}$/u, selector.accountLast4)) fail('INVALID_SELECTOR');
    const document = rootDocument, origin = 'https://bank.shinhan.com';
    const url = new URL(document.location.href), view = document.defaultView;
    if (url.origin !== origin || url.username || url.password) fail('WRONG_ORIGIN');
    if (!view || view.top !== view.self) fail('UNSUPPORTED_FRAME');
    if (!document.title.endsWith(' | 신한은행 개인뱅킹')) fail('UNSUPPORTED_PAGE');
    const text = element => String(element.innerText ?? '').trim();
    const compact = value => value.replace(/\s+/gu, '');
    const visible = element => {
      if (!element || !element.getClientRects().length) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true'
          || style.display === 'none' || ['hidden','collapse'].includes(style.visibility) || style.opacity === '0') return false;
      }
      return true;
    };
    // The actual query page has current, term/savings/trust, foreign and total
    // tables together, with no verified "원화 예금" heading. Identify the current
    // account table from its accessible metadata before reading any table rows.
    // The source HTML attribute has not yet been live-verified: an unfamiliar
    // naming mechanism fails closed rather than falling back to every balance.
    const currentNames = new Set(['입/출금계좌정보',
      '입/출금계좌정보은(는)계좌명,계좌번호,신규일,최근거래일,잔액(원),업무을(를)나타낸표']);
    const expectedLabels = ['계좌명','계좌번호','신규일','최근거래일','잔액(원)','업무'];
    const balanceLabels = new Set(['잔액(원)']);
    const metadata = table => [table.getAttribute('aria-label'), table.getAttribute('summary'),
      table.caption?.textContent ?? table.caption?.innerText].filter(value => typeof value === 'string' && value.trim()).map(compact);
    const cellsOf = row => Array.from(row.querySelectorAll('th, td')).filter(cell => cell.closest('tr') === row);
    const rowsOf = table => Array.from(table.querySelectorAll('tr')).filter(row => row.closest('table') === table && visible(row));
    const labelsOf = row => cellsOf(row).filter(visible).map(cell => compact(text(cell)));
    const candidates = [];
    for (const table of document.querySelectorAll('table')) {
      if (!visible(table)) continue;
      const names = metadata(table);
      if (!names.some(name => currentNames.has(name))) continue;
      if (names.some(name => !currentNames.has(name) && !/^\(?단위[:：]원\)?$/u.test(name))) fail('UNSUPPORTED_LAYOUT');
      const rows = rowsOf(table), headers = rows.filter(row => cellsOf(row).some(cell => cell.tagName === 'TH') && labelsOf(row).some(label => balanceLabels.has(label)));
      candidates.push({ table, rows, headers });
    }
    if (!candidates.length) fail('NO_SUPPORTED_TABLE');
    if (candidates.length !== 1) fail('AMBIGUOUS_TABLE');
    const { table, rows, headers } = candidates[0];
    if (headers.length !== 1 || rows[0] !== headers[0]) fail('AMBIGUOUS_COLUMNS');
    const simple = cells => cells.every(cell => visible(cell) && [null,'1'].includes(cell.getAttribute('colspan')) && [null,'1'].includes(cell.getAttribute('rowspan')));
    const headerCells = cellsOf(headers[0]), labels = labelsOf(headers[0]);
    if (!simple(headerCells) || headerCells.some(cell => cell.tagName !== 'TH')) fail('UNSUPPORTED_LAYOUT');
    // 최근거래일 is account metadata on this screen, not a transaction-history
    // row. Exact observed columns also exclude withdrawable credit and loans.
    if (labels.length !== expectedLabels.length || labels.some((label,index) => label !== expectedLabels[index])) fail('AMBIGUOUS_COLUMNS');
    const accountColumn = 1, balanceColumn = 4;
    const unit = node => visible(node) && /^(?:\(?단위[:：]원\)?)$/u.test(compact(text(node)));
    const hasUnit = /\((?:원|KRW)\)$/u.test(labels[balanceColumn]) || unit(table.caption) || unit(table.previousElementSibling);
    const matches = [];
    for (const row of rows.slice(1)) {
      const cells = cellsOf(row);
      if (cells.length !== headerCells.length || !simple(cells) || cells.some(cell => cell.tagName !== 'TD')) fail('UNSUPPORTED_LAYOUT');
      const rawAccount = text(cells[accountColumn]);
      if (!full(/^[0-9]+(?:-[0-9]+)*$/u, rawAccount)) fail('INVALID_ACCOUNT');
      const account = rawAccount.replace(/-/gu, '');
      if (!full(/^[0-9]{10,20}$/u, account)) fail('INVALID_ACCOUNT');
      if (account.endsWith(selector.accountLast4)) matches.push({ account, cell: cells[balanceColumn] });
    }
    if (matches.length > 1) fail('ACCOUNT_AMBIGUOUS');
    if (!matches.length) return { ok: true, captures: [] };
    const [{ account, cell }] = matches, amount = text(cell);
    const parsed = /^(?:(₩|KRW)\s*)?(-?)((?:0|[1-9][0-9]*)|(?:[1-9][0-9]{0,2}(?:,[0-9]{3})+))(?:\s*(원))?$/u.exec(amount);
    if (!parsed || parsed[0] !== amount) fail('INVALID_AMOUNT');
    if (!hasUnit && !parsed[1] && !parsed[4]) fail('MISSING_KRW_UNIT');
    const balanceKrw = parsed[2] + parsed[3].replace(/,/gu, '');
    if (!full(/^(?:0|[1-9][0-9]{0,19}|-[1-9][0-9]{0,19})$/u, balanceKrw)) fail('INVALID_AMOUNT');
    if (!globalThis.crypto?.subtle) fail('CRYPTO_UNAVAILABLE');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fma:shinhan:deposit-account:v1\u0000${origin}\u0000${account}`));
    const accountFingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
    return { ok: true, captures: [{ formatVersion: 1, provider: 'shinhan', source: 'browser_assisted', origin,
      pageKind: 'deposit_account_list', capturedAt: new Date().toISOString(), accountFingerprint, accountLast4: account.slice(-4),
      currency: 'KRW', balanceKind: 'ledger', balanceKrw, bankAsOfDate: null }] };
  } catch (error) { return { ok: false, error: safeCodes.has(error?.safeCode) ? error.safeCode : 'UNSUPPORTED_PAGE' }; }
}
