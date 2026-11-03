import { isSanitizedCapture } from './capture.mjs';
export const BANK_ORIGIN = 'https://bank.shinhan.com';
export const LOGIN_URL = BANK_ORIGIN + '/index.jsp#011100000000';
export const ERRORS = new Set(['credentials_invalid', 'authentication_required', 'network_error',
  'unsupported_layout', 'account_not_found', 'account_ambiguous', 'account_changed', 'runtime_unavailable', 'operation_unknown']);
export class BankReadError extends Error {
  constructor(code) { super('Bank read did not complete'); this.code = ERRORS.has(code) ? code : 'operation_unknown'; }
}
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const full = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
export function validateJob(value) {
  const selector = value?.selector;
  const deposit = exact(selector, ['accountLast4', 'accountType']) && selector.accountType === 'deposit';
  const loan = exact(selector, ['accountLast4', 'loanType']) && ['interim','jeonse'].includes(selector.loanType);
  if (!exact(value, ['provider', 'credentials', 'selector']) || value.provider !== 'shinhan_bank'
    || !exact(value.credentials, ['loginId', 'password']) || !(deposit || loan)
    || !full(/^[A-Za-z0-9._-]{1,64}$/u, value.credentials.loginId)
    || !full(/^[\x21-\x7e]{1,64}$/u, value.credentials.password)
    || !full(/^[0-9]{4}$/u, value.selector.accountLast4)) {
    throw new BankReadError('operation_unknown');
  }
  return value;
}
export function allowedRequest(value) {
  try { const url = new URL(value); return url.origin === BANK_ORIGIN && !url.username && !url.password; }
  catch { return false; }
}
const plain = new Map(Object.entries({
  '`':'어금기호','-':'빼기','=':'등호','\\':'원기호','[':'왼쪽대괄호',']':'오른쪽대괄호',';':'세미콜론',
  "'":'작은따옴표',',':'쉼표','.':'마침표','/':'슬래시',
}));
const shifted = new Map(Object.entries({
  '~':'물결표시','!':'느낌표','@':'골뱅이','#':'우물정','$':'달러기호','%':'퍼센트','^':'꺽쇠','&':'엠퍼샌드',
  '*':'별표','(':'왼쪽괄호',')':'오른쪽괄호','_':'밑줄','+':'더하기','|':'수직막대','{':'왼쪽중괄호',
  '}':'오른쪽중괄호',':':'콜론','"':'따옴표','<':'왼쪽꺽쇠괄호','>':'오른쪽꺽쇠괄호','?':'물음표',
}));
/** Labels observed on the bank's normal virtual keyboard. Never edit encrypted/hidden fields. */
export function keyFor(character) {
  if (full(/^[a-z0-9]$/u, character)) return { shift: false, label: character };
  if (full(/^[A-Z]$/u, character)) return { shift: true, label: '대문자' + character };
  if (plain.has(character)) return { shift: false, label: plain.get(character) };
  if (shifted.has(character)) return { shift: true, label: shifted.get(character) };
  throw new BankReadError('authentication_required');
}
export function selectedCapture(result, selector) {
  if (!result || result.ok !== true || !Array.isArray(result.captures) || result.captures.length > 100
    || !result.captures.every(isSanitizedCapture)) throw new BankReadError('unsupported_layout');
  const matching = result.captures.filter(capture => capture.accountLast4 === selector.accountLast4
    && (selector.accountType === 'deposit' ? capture.pageKind === 'deposit_account_list'
      : capture.pageKind === 'loan_account_list' && capture.loanType === selector.loanType));
  if (matching.length === 0) throw new BankReadError('account_not_found');
  if (matching.length !== 1) throw new BankReadError('account_ambiguous');
  return matching[0];
}
