/**
 * Browser-side table capture for sujain mypage scrape pages.
 *
 * Self-contained so Playwright can serialize this function into page.evaluate
 * (no outer closures). Optional second arg `doc` is for Node unit tests only;
 * production evaluate passes only pageKind and uses the page document.
 *
 * Privacy: never returns password/hidden control values. Callers must never log
 * cell values — layout diagnostics use counts only.
 */

/**
 * @param {string} pageKind 'payment' | 'unit-items'
 * @param {Document} [doc] defaults to the page `document` inside evaluate
 * @returns {{
 *   tableCount: number,
 *   tableHeaders: string[][],
 *   tables: Array<{ rawRowCount: number, formControlCount: number }>,
 *   rows: Array<{ cells: string[], headers: string[], sourcePage: string }>,
 * }}
 */
export function captureSujainTables(pageKind, doc) {
  const root = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!root || typeof root.querySelectorAll !== 'function') {
    return { tableCount: 0, tableHeaders: [], tables: [], rows: [] };
  }

  const cellMax = 200;
  const headerMax = 100;
  const clipText = (value, max) => {
    const clipped = String(value ?? '').replace(/\s+/gu, ' ').trim();
    return clipped.length <= max ? clipped : clipped.slice(0, max);
  };

  /**
   * Skip credential-like and non-visible controls. Never read password/hidden.
   * Login #id/#pw must not become scrape cell text if a login chrome table exists.
   */
  const isUnsafeFormControl = (el) => {
    if (!el || typeof el !== 'object') return true;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input') {
      const type = String(
        (typeof el.getAttribute === 'function' ? el.getAttribute('type') : null)
          ?? el.type
          ?? 'text',
      ).toLowerCase();
      if (
        type === 'password'
        || type === 'hidden'
        || type === 'file'
        || type === 'submit'
        || type === 'button'
        || type === 'image'
        || type === 'reset'
        || type === 'checkbox'
        || type === 'radio'
      ) {
        return true;
      }
    }
    const id = String(el.id ?? (typeof el.getAttribute === 'function' ? el.getAttribute('id') : '') ?? '');
    const name = String(
      (typeof el.getAttribute === 'function' ? el.getAttribute('name') : null) ?? el.name ?? '',
    );
    const key = `${id} ${name}`.toLowerCase();
    if (id === 'id' || id === 'pw') return true;
    if (/(?:^|[_-])(?:pw|pwd|pass|password|passwd|userpwd|userid|credential)(?:$|[_-])/u.test(key)) {
      return true;
    }
    if (/password|passwd|userpwd|userid/u.test(key)) return true;
    return false;
  };

  const readControlValue = (el) => {
    if (isUnsafeFormControl(el)) return '';
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'select') {
      const options = el.options;
      const index = Number(el.selectedIndex);
      if (options && Number.isFinite(index) && index >= 0 && index < options.length) {
        const opt = options[index];
        const label = clipText(opt?.textContent ?? opt?.label ?? opt?.value ?? '', cellMax);
        if (label) return label;
      }
      return clipText(el.value ?? '', cellMax);
    }
    if (tag === 'textarea' || tag === 'input') {
      return clipText(el.value ?? '', cellMax);
    }
    return '';
  };

  /** Prefer visible text; when empty, join safe form-control values inside the cell. */
  const readCellText = (cell) => {
    const visible = clipText(cell?.textContent, cellMax);
    if (visible) return visible;
    if (!cell || typeof cell.querySelectorAll !== 'function') return '';
    const controls = Array.from(cell.querySelectorAll('input, select, textarea'));
    const parts = [];
    for (const el of controls) {
      const value = readControlValue(el);
      if (value) parts.push(value);
    }
    return clipText(parts.join(' '), cellMax);
  };

  const countFormControls = (table) => {
    if (!table || typeof table.querySelectorAll !== 'function') return 0;
    return Math.min(table.querySelectorAll('input, select, textarea').length, 1000);
  };

  const allTables = Array.from(root.querySelectorAll('table'));
  const tableHeaders = [];
  const tables = [];
  const out = [];

  for (const table of allTables.slice(0, 20)) {
    const headerCells = Array.from(table.querySelectorAll('thead th, tr:first-child th'))
      .map((cell) => clipText(cell.textContent, headerMax))
      .filter(Boolean);
    tableHeaders.push(headerCells.slice(0, 20));

    const formControlCount = countFormControls(table);
    let tableRawRowCount = 0;

    const bodyRows = Array.from(table.querySelectorAll('tbody tr, tr')).slice(0, 50);
    for (const row of bodyRows) {
      const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => readCellText(cell));
      if (cells.length === 0 || cells.every((cell) => !cell)) continue;
      // Skip header-only rows.
      if (headerCells.length && cells.join('|') === headerCells.join('|')) continue;
      tableRawRowCount += 1;
      out.push({
        cells: cells.slice(0, 20),
        headers: headerCells.slice(0, 20),
        sourcePage: pageKind,
      });
    }

    tables.push({
      rawRowCount: Math.min(tableRawRowCount, 1000),
      formControlCount,
    });
  }

  return {
    tableCount: Math.min(allTables.length, 100),
    tableHeaders,
    tables,
    rows: out.slice(0, 100),
  };
}
