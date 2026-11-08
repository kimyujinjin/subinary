/**
 * Node 테스트용 아주 작은 DOM. captureSujainTables 가 읽는 속성(tHead·tBodies·rows·cells·
 * caption·previousElementSibling·classList·hidden·style·폼 값)만 흉내 낸다.
 * 값은 모두 가짜(합성)다 — 실제 단지명·동호수·금액을 넣지 않는다.
 */

const SECTION_TAGS = new Set(['THEAD', 'TBODY', 'TFOOT']);

export class FakeElement {
  constructor(tagName, props = {}, children = []) {
    this.tagName = String(tagName).toUpperCase();
    this.id = props.id ?? '';
    this.className = props.className ?? '';
    this.hidden = props.hidden === true;
    this.style = props.style ?? {};
    this.ownText = props.text ?? '';
    this.attrs = props.attrs ?? {};
    this.type = props.type;
    this.name = props.name ?? '';
    this.value = props.value ?? '';
    this.disabled = props.disabled === true;
    this.selectedIndex = props.selectedIndex ?? 0;
    this.optionsOverride = props.options;
    this.children = [];
    this.parentElement = null;
    for (const child of children) this.append(child);
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return this;
  }

  get classList() {
    const names = String(this.className).split(/\s+/u).filter(Boolean);
    return { contains: (name) => names.includes(name) };
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  getAttribute(key) {
    if (key === 'type') return this.type ?? (this.tagName === 'INPUT' ? 'text' : null);
    if (key === 'id') return this.id || null;
    if (key === 'name') return this.name || null;
    if (key === 'hidden') return this.hidden ? '' : null;
    if (key === 'class') return this.className || null;
    return Object.hasOwn(this.attrs, key) ? this.attrs[key] : null;
  }

  descendants() {
    const out = [];
    for (const child of this.children) out.push(child, ...child.descendants());
    return out;
  }

  /** Comma-separated tag names only ('table', 'input, select, textarea', 'iframe'). */
  querySelectorAll(selector) {
    const tags = String(selector).split(',').map((part) => part.trim().toUpperCase());
    return this.descendants().filter((el) => tags.includes(el.tagName));
  }

  closest(selector) {
    const tag = String(selector).trim().toUpperCase();
    let node = this;
    while (node) {
      if (node.tagName === tag) return node;
      node = node.parentElement;
    }
    return null;
  }

  get tHead() {
    if (this.tagName !== 'TABLE') return undefined;
    return this.children.find((child) => child.tagName === 'THEAD') ?? null;
  }

  get tBodies() {
    if (this.tagName !== 'TABLE') return undefined;
    return this.children.filter((child) => child.tagName === 'TBODY');
  }

  get caption() {
    if (this.tagName !== 'TABLE') return undefined;
    return this.children.find((child) => child.tagName === 'CAPTION') ?? null;
  }

  get rows() {
    if (this.tagName === 'TABLE') {
      return this.children
        .filter((child) => SECTION_TAGS.has(child.tagName))
        .flatMap((section) => section.rows);
    }
    if (SECTION_TAGS.has(this.tagName)) return this.children.filter((child) => child.tagName === 'TR');
    return undefined;
  }

  get cells() {
    if (this.tagName !== 'TR') return undefined;
    return this.children.filter((child) => child.tagName === 'TH' || child.tagName === 'TD');
  }

  get options() {
    if (this.optionsOverride) return this.optionsOverride;
    if (this.tagName !== 'SELECT') return undefined;
    return this.children.filter((child) => child.tagName === 'OPTION');
  }
}

export function h(tag, props = {}, children = []) {
  return new FakeElement(tag, props, children);
}

export function fakeDocument(children) {
  return h('html', {}, [h('body', {}, children)]);
}

export const SUJAIN_PAYMENT_HEADERS = ['회차', '약정일자', '약정금액', '납부일자', '납부원금', '연체료', '할인료', '실납부금'];

/** caption + thead th + tbody(데이터 줄 첫 칸 th, 사이마다 칸 없는 빈 tr). */
export function sujainTable(caption, rows, { headers = SUJAIN_PAYMENT_HEADERS, emptyRowsBetween = true } = {}) {
  const body = [];
  for (const cells of rows) {
    const [name, ...rest] = cells;
    body.push(h('tr', {}, [h('th', { text: name }), ...rest.map((value) => h('td', { text: value }))]));
    // 실제 화면처럼 데이터 줄 사이에 칸이 하나도 없는 빈 tr(높이 0).
    if (emptyRowsBetween) body.push(h('tr'));
  }
  return h('table', { className: 'st1' }, [
    h('caption', { text: caption }),
    h('thead', {}, [h('tr', {}, headers.map((label) => h('th', { text: label })))]),
    h('tbody', {}, body),
  ]);
}

/** 숨은 층 안의 연락처 입력 표(대상 아님). */
export function sujainContactLayer() {
  return h('div', { className: 'layer', style: { display: 'none' } }, [
    h('table', { className: 'basic_table type1' }, [
      h('tbody', {}, [
        h('tr', {}, [h('th', { text: '이름*' }), h('td', {}, [h('input', { value: '합성 회원' })])]),
        h('tr', {}, [h('th', { text: '휴대전화*' }), h('td', {}, [h('input', { value: '000-0000-0000' })])]),
        h('tr', {}, [h('th', { text: '주소*' }), h('td', {}, [h('input', { value: '합성 주소' })])]),
        h('tr', {}, [h('th', { text: '이메일*' }), h('td', {}, [h('input', { value: 'synthetic@example.com' })])]),
      ]),
    ]),
  ]);
}

/**
 * /mypage/payment 를 흉내 낸 가짜 문서.
 * searched=false: #paymentDiv 숨김 + 납부 표 tbody 비어 있음(처음 상태).
 * searched=true: 분양대금 표 + 「별도 계약 품목」 표(옵션 계약마다 앞에 div.ect_item).
 */
export function sujainPaymentDocument({
  searched,
  paymentRows = [],
  options = [],
  unitOptions = ['synthetic-unit-1'],
} = {}) {
  const select = h('select', { id: 'preInsp' }, [
    h('option', { value: '', text: '선택' }),
    ...unitOptions.map((value, index) => h('option', { value, text: `합성단지 [${index + 1}동 ${index + 1}01호]` })),
  ]);
  const children = [
    h('div', { id: 'searchInfoDiv', hidden: searched === true }, [select]),
    h('div', { id: 'paymentDiv', style: { display: searched ? 'block' : 'none' } }, [
      h('div', { className: 'h_tit_wrap', text: '아파트 분양대금' }),
      sujainTable('아파트 분양대금', searched ? paymentRows : []),
    ]),
  ];
  if (searched && options.length > 0) {
    children.push(h('div', { className: 'h_tit_wrap', text: '별도 계약 품목' }));
    for (const option of options) {
      children.push(h('div', { className: 'ect_item', text: option.itemLabel }));
      children.push(sujainTable('별도 계약 품목', option.rows));
    }
  }
  children.push(sujainContactLayer());
  return fakeDocument(children);
}
