/**
 * Browser-side table capture for the sujain 분양대금조회 page (/mypage/payment).
 *
 * 확인된 화면(2026-11-08): 단지를 고르고 조회하면 보이는 table.st1 이 3개 나온다.
 * - caption 「아파트 분양대금」: thead th 8칸(회차|약정일자|…|실납부금), tbody 는 데이터 줄
 *   (첫 칸 th = 회차 이름 + td 7칸)과 칸 없는 빈 tr 이 번갈아 나온다.
 * - caption 「별도 계약 품목」(옵션 계약마다 한 표): 바로 앞 div.ect_item 에 품목 이름 목록.
 * 숨겨진 연락처 입력 표(table.basic_table)는 읽지 않는다.
 *
 * Self-contained so Playwright can serialize this function into page.evaluate
 * (no outer closures). Optional second arg `doc` is for Node unit tests only;
 * production evaluate passes only pageKind and uses the page document.
 *
 * Privacy: never returns password/hidden control values. Callers must never log
 * cell values — layout diagnostics use counts only. Iframe srcs and page URLs
 * are stripped to origin+pathname (or pathname) with search/hash removed.
 */

/**
 * @param {string} pageKind 'payment'
 * @param {Document} [doc] defaults to the page `document` inside evaluate
 * @returns {{
 *   tableCount: number,
 *   tableHeaders: string[][],
 *   tables: Array<{ rawRowCount: number, preSkipRowCount: number, formControlCount: number }>,
 *   outsideTableFormControlCount: number,
 *   outsideTableFormControls: {
 *     visibleInput: number,
 *     visibleSelect: number,
 *     visibleTextarea: number,
 *     hidden: number,
 *     other: number,
 *   },
 *   iframeCount: number,
 *   iframePaths: string[],
 *   rows: Array<{
 *     cells: string[],
 *     headers: string[],
 *     sourcePage: string,
 *     section: 'payment' | 'option',
 *     itemLabel?: string,
 *   }>,
 * }}
 *
 * tableCount 는 숨은 표까지 센 전체 수, tableHeaders·tables 는 보이는 표만이다.
 */
export function captureSujainTables(pageKind, doc) {
  const emptyOutsideBreakdown = {
    visibleInput: 0,
    visibleSelect: 0,
    visibleTextarea: 0,
    hidden: 0,
    other: 0,
  };
  const empty = {
    tableCount: 0,
    tableHeaders: [],
    tables: [],
    outsideTableFormControlCount: 0,
    outsideTableFormControls: { ...emptyOutsideBreakdown },
    iframeCount: 0,
    iframePaths: [],
    rows: [],
  };
  const root = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!root || typeof root.querySelectorAll !== 'function') {
    return empty;
  }

  const cellMax = 200;
  const headerMax = 100;
  const itemLabelMax = 200;
  const pathMax = 200;
  const clipText = (value, max) => {
    const clipped = String(value ?? '').replace(/\s+/gu, ' ').trim();
    return clipped.length <= max ? clipped : clipped.slice(0, max);
  };

  /**
   * Origin+pathname or pathname only — strip search/hash. Never credentials.
   * Inlined here because this function is serialized into page.evaluate.
   */
  const sanitizePath = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    try {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(raw) || raw.startsWith('//')) {
        const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
        if (url.username || url.password) return null;
        const out = `${url.origin}${url.pathname}`.slice(0, pathMax);
        return out || null;
      }
      const path = raw.split(/[?#]/u)[0].slice(0, pathMax);
      if (!path || /[\x00-\x1f]/u.test(path)) return null;
      return path;
    } catch {
      return null;
    }
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

  const isInsideTable = (el) => {
    if (!el || typeof el !== 'object') return false;
    if (typeof el.closest === 'function') {
      try {
        return Boolean(el.closest('table'));
      } catch {
        // fall through to parent walk
      }
    }
    let node = el.parentElement ?? el.parentNode ?? null;
    while (node) {
      if (String(node.tagName || '').toLowerCase() === 'table') return true;
      node = node.parentElement ?? node.parentNode ?? null;
    }
    return false;
  };

  /**
   * The element itself is hidden (hidden prop/attr, display:none, visibility:hidden).
   * Compares tokens only — never logs style text. Ancestors are not checked here.
   */
  const isHiddenSelf = (el) => {
    if (!el || typeof el !== 'object') return false;
    if (el.hidden === true) return true;
    if (typeof el.getAttribute === 'function') {
      try {
        if (el.getAttribute('hidden') !== null) return true;
      } catch {
        // ignore
      }
    }
    try {
      if (typeof getComputedStyle === 'function') {
        const style = getComputedStyle(el);
        const display = String(style?.display ?? '').toLowerCase();
        const visibility = String(style?.visibility ?? '').toLowerCase();
        if (display === 'none' || visibility === 'hidden') return true;
      } else if (el.style && typeof el.style === 'object') {
        const display = String(el.style.display ?? '').toLowerCase();
        const visibility = String(el.style.visibility ?? '').toLowerCase();
        if (display === 'none' || visibility === 'hidden') return true;
      }
    } catch {
      // ignore missing computed style in Node fixtures
    }
    return false;
  };

  /**
   * 표가 화면에 안 보이면(자신 또는 조상이 숨김) 읽지 않는다. 연락처 입력 표는 숨은 층 안에 있어
   * 표 자신의 display 만 보면 안 걸리므로 조상까지 본다. 브라우저면 checkVisibility 를 쓴다.
   */
  const isHiddenTable = (table) => {
    if (typeof table?.checkVisibility === 'function') {
      try {
        return !table.checkVisibility({ checkVisibilityCSS: true });
      } catch {
        // fall through to the ancestor walk
      }
    }
    let node = table;
    for (let depth = 0; node && depth < 50; depth += 1) {
      if (isHiddenSelf(node)) return true;
      node = node.parentElement ?? null;
    }
    return false;
  };

  const hasClass = (el, name) => {
    if (!el || typeof el !== 'object') return false;
    if (el.classList && typeof el.classList.contains === 'function') {
      try {
        return el.classList.contains(name);
      } catch {
        // fall through to className
      }
    }
    return String(el.className ?? '').split(/\s+/u).includes(name);
  };

  const tagOf = (el) => String(el?.tagName || '').toLowerCase();

  const containsTable = (el) => {
    if (tagOf(el) === 'table') return true;
    if (!el || typeof el.querySelectorAll !== 'function') return false;
    try {
      return el.querySelectorAll('table').length > 0;
    } catch {
      return false;
    }
  };

  /** caption(또는 표 앞 제목 div.h_tit_wrap) 글자로 구역을 정한다. 모르면 분양대금으로 둔다. */
  const sectionFromTitle = (value) => {
    const compact = String(value ?? '').replace(/\s+/gu, '');
    if (compact.includes('별도계약')) return 'option';
    if (compact.includes('분양대금')) return 'payment';
    return null;
  };

  const sectionOf = (table) => {
    let caption = null;
    try {
      caption = table.caption ?? null;
    } catch {
      caption = null;
    }
    const byCaption = sectionFromTitle(caption?.textContent);
    if (byCaption) return byCaption;
    let node = table.previousElementSibling ?? null;
    for (let i = 0; node && i < 20; i += 1) {
      if (hasClass(node, 'h_tit_wrap')) return sectionFromTitle(node.textContent) ?? 'payment';
      node = node.previousElementSibling ?? null;
    }
    return 'payment';
  };

  /**
   * 옵션 표 바로 앞 형제 div.ect_item 글자. 앞 표·제목을 만나면 멈춰 다른 표의 품목을 가져오지 않는다.
   * 표가 감싸개 div 안 첫 요소면 감싸개의 앞 형제를 같은 규칙으로 본다.
   */
  const itemLabelOf = (table) => {
    const walk = (start) => {
      let node = start;
      for (let i = 0; node && i < 5; i += 1) {
        if (containsTable(node) || hasClass(node, 'h_tit_wrap')) return '';
        if (hasClass(node, 'ect_item')) return clipText(node.textContent, itemLabelMax);
        node = node.previousElementSibling ?? null;
      }
      return '';
    };
    const previous = table.previousElementSibling ?? null;
    if (previous) return walk(previous);
    return walk(table.parentElement?.previousElementSibling ?? null);
  };

  const rowsOf = (section) => {
    if (!section || !section.rows) return [];
    return Array.from(section.rows);
  };

  const cellsOf = (row) => {
    if (!row || !row.cells) return [];
    return Array.from(row.cells);
  };

  /**
   * Classify one outside-table control for diagnostics only.
   * Never reads value/name/id/placeholder/aria/class/option text — tag + type
   * token + visibility flags only. Password always lands in `other`.
   * @returns {'visibleInput'|'visibleSelect'|'visibleTextarea'|'hidden'|'other'}
   */
  const classifyOutsideFormControl = (el) => {
    const tag = String(el?.tagName || '').toLowerCase();
    if (tag === 'input') {
      const type = String(
        (typeof el.getAttribute === 'function' ? el.getAttribute('type') : null)
          ?? el.type
          ?? 'text',
      ).toLowerCase();
      if (
        type === 'password'
        || type === 'file'
        || type === 'submit'
        || type === 'button'
        || type === 'image'
        || type === 'reset'
        || type === 'checkbox'
        || type === 'radio'
      ) {
        return 'other';
      }
      if (type === 'hidden') return 'hidden';
    }

    // Attribute / property / CSS hidden — never emit attribute or style strings.
    if (isHiddenSelf(el)) return 'hidden';

    if (tag === 'select') return 'visibleSelect';
    if (tag === 'textarea') return 'visibleTextarea';
    if (tag === 'input') return 'visibleInput';
    return 'other';
  };

  const allTables = Array.from(root.querySelectorAll('table'));
  const tableHeaders = [];
  const tables = [];
  const out = [];

  for (const table of allTables) {
    if (tables.length >= 20) break;
    if (isHiddenTable(table)) continue;

    // 머리는 thead th 에서만. 'tr:first-child th' 는 본문 첫 줄의 회차 이름(th)까지 머리로 넣었다.
    let headerSource = [];
    let headerRowInBody = null;
    const thead = table.tHead ?? null;
    if (thead) {
      headerSource = rowsOf(thead).flatMap((row) => cellsOf(row)).filter((cell) => tagOf(cell) === 'th');
    } else {
      // thead 가 없을 때만, 첫 줄이 모두 th 이면 그 줄을 머리로 본다.
      const firstRow = rowsOf(table)[0] ?? null;
      const firstCells = cellsOf(firstRow);
      if (firstCells.length > 0 && firstCells.every((cell) => tagOf(cell) === 'th')) {
        headerSource = firstCells;
        headerRowInBody = firstRow;
      }
    }
    const headerCells = headerSource
      .map((cell) => clipText(cell.textContent, headerMax))
      .filter(Boolean);
    tableHeaders.push(headerCells.slice(0, 20));

    const section = sectionOf(table);
    const itemLabel = section === 'option' ? itemLabelOf(table) : '';

    const formControlCount = countFormControls(table);
    let tableRawRowCount = 0;

    // 본문 줄은 tbody tr 에서만(thead 줄이 데이터로 섞이지 않게).
    const allBodyRows = Array.from(table.tBodies ?? [])
      .flatMap((body) => rowsOf(body))
      .filter((row) => row !== headerRowInBody);
    // Count every candidate tr before empty-cell / header-only skips.
    const preSkipRowCount = allBodyRows.length;

    for (const row of allBodyRows.slice(0, 50)) {
      // 데이터 줄 사이의 칸 없는 빈 tr(높이 0)과 모두 빈 줄은 건너뛴다.
      const cells = cellsOf(row).map((cell) => readCellText(cell));
      if (cells.length === 0 || cells.every((cell) => !cell)) continue;
      // Skip header-only rows.
      if (headerCells.length && cells.join('|') === headerCells.join('|')) continue;
      tableRawRowCount += 1;
      const captured = {
        cells: cells.slice(0, 20),
        headers: headerCells.slice(0, 20),
        sourcePage: pageKind,
        section,
      };
      if (itemLabel) captured.itemLabel = itemLabel;
      out.push(captured);
    }

    tables.push({
      rawRowCount: Math.min(tableRawRowCount, 1000),
      preSkipRowCount: Math.min(preSkipRowCount, 1000),
      formControlCount,
    });
  }

  // Page-level: form controls outside any table — counts only, never values.
  const outsideTableFormControls = { ...emptyOutsideBreakdown };
  let outsideTableFormControlCount = 0;
  for (const el of Array.from(root.querySelectorAll('input, select, textarea')).slice(0, 2000)) {
    if (isInsideTable(el)) continue;
    outsideTableFormControlCount += 1;
    const bucket = classifyOutsideFormControl(el);
    outsideTableFormControls[bucket] += 1;
  }
  outsideTableFormControlCount = Math.min(outsideTableFormControlCount, 1000);
  for (const key of Object.keys(outsideTableFormControls)) {
    outsideTableFormControls[key] = Math.min(outsideTableFormControls[key], 1000);
  }

  // Page-level: iframe count + sanitized src paths (never content, never query/hash).
  const iframeEls = Array.from(root.querySelectorAll('iframe'));
  const iframeCount = Math.min(iframeEls.length, 100);
  const iframePaths = [];
  for (const iframe of iframeEls.slice(0, 20)) {
    const src = typeof iframe.getAttribute === 'function'
      ? (iframe.getAttribute('src') ?? iframe.src ?? '')
      : (iframe.src ?? '');
    const path = sanitizePath(src);
    if (path) iframePaths.push(path);
  }

  return {
    tableCount: Math.min(allTables.length, 100),
    tableHeaders,
    tables,
    outsideTableFormControlCount,
    outsideTableFormControls,
    iframeCount,
    iframePaths,
    rows: out.slice(0, 100),
  };
}
