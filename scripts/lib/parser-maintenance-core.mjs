import { createHash } from 'node:crypto';

/** @param {unknown} value @returns {string} 원문을 출력하지 않는 내용 식별자다. */
export function maintenanceHash(value) { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }

/** @param {{id:string,householdId:string,memberId:string,sender:string,content:string,receivedAt:string,version:string,status:string}} row */
export function maintenanceSourceHash(row) {
  return maintenanceHash([row.id, row.householdId, row.memberId, row.sender, row.content,
    new Date(row.receivedAt).toISOString(), new Date(row.version).toISOString(), row.status]);
}

const WORDS = new Set(['Web발신', '승인', '승인거절', '거절', '취소', '환불', '결제', '일시불', '할부', '개월', '누적', '누계', '잔액', '원', '카드', '체크카드', '신용카드', '국내', '해외', '해외승인', '님의', '님', '사용', '이용', '금액', '삼성', '현대', '네이버', '신한', 'KB', '국민', '롯데', '하나', '우리', 'BC', 'NH', '농협', '씨티', '삼성카드', '현대카드', '신한카드', '국민카드', '롯데카드', '하나카드', '우리카드', 'BC카드', '농협카드', '씨티카드', '네이버현대카드', 'KRW']);
const SUSPICIOUS = /https?\s*:|www\s*\.|[a-z0-9-]+\.[a-z]{2,}|인증|비밀번호|보안코드|인증번호|otp|password|ignore|instruction|system|sudo|curl|wget|실행|명령|프롬프트|지시|로그인|계좌|이체|대출|청구|잔액|입금|출금/iu;

/** @param {string} content @returns {boolean} 의심 입력은 모델용 표본에서 통째로 제외한다. */
export function maintenanceSuspicious(content) {
  return typeof content !== 'string' || content.length === 0 || content.length > 2048 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(content) || SUSPICIOUS.test(content.normalize('NFKC'));
}

/**
 * 허용 어휘와 구두점만 남기고 모든 숫자·자유 텍스트를 합성값으로 바꾼다.
 * 정답 라벨이나 원문 복원용 사전은 만들지 않는다. 변환이 파싱 실패 원인을 보존한다는 보장은 없다.
 * @param {string} content @returns {string | null}
 */
export function syntheticSms(content) {
  if (maintenanceSuspicious(content)) return null;
  const normalized = content.normalize('NFKC');
  // 임시 표식도 자유 어휘 변환을 통과하도록 숫자·단어 치환보다 먼저 구간을 분리한다.
  const pieces = normalized.split(/(\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}|(?:\d{1,3}(?:,\d{3})+|\d+)\s*원|\d{1,2}\s*개월)/u);
  return pieces.map(piece => {
    if (/^\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}$/u.test(piece)) return '01/02 03:04';
    if (/^(?:\d{1,3}(?:,\d{3})+|\d+)\s*원$/u.test(piece)) return '12,345원';
    if (/^\d{1,2}\s*개월$/u.test(piece)) return '3개월';
    return piece.replace(/[0-9]+/gu, '7777').replace(/[A-Za-z가-힣]+/gu, token => WORDS.has(token) ? token : '예시')
      .replace(/[^A-Za-z가-힣0-9\s\[\]()*:.,/\-]/gu, ' ').replace(/[^\S\n]+/gu, ' ');
  }).join('').trim();
}

/** @param {string[]} paths @returns {boolean} 기존 안전 게이트와 테스트는 자동 변경 범위에 없다. */
export function allowedParserChanges(paths) {
  return paths.includes('packages/card-parsers/src/parsers/generic.parser.ts')
    && paths.some(path => /^packages\/card-parsers\/src\/fixtures\/maintenance-[a-f0-9]{12}\.test\.ts$/u.test(path))
    && paths.every(path => path === 'packages/card-parsers/src/parsers/generic.parser.ts'
    || /^packages\/card-parsers\/src\/fixtures\/maintenance-[a-f0-9]{12}\.test\.ts$/u.test(path));
}

/** @param {Record<string, unknown>} result @returns {string} 비교 가능한 전체 결과의 해시다. */
export function resultHash(result) { return maintenanceHash(result); }

/** @param {unknown} value @param {number} count 후보 출력 누락은 baseline 대체 없이 거부한다. */
export function validateCandidateResults(value, count) {
  const keys = new Set(['nonTransactionReason', 'issuer', 'transactionType', 'declineReason', 'amount', 'currency', 'merchantRaw', 'occurredAt', 'maskedCardNumber', 'installmentMonths', 'confidence', 'warnings']);
  if (!Array.isArray(value) || value.length !== count) throw new Error('maintenance_invalid_candidate_output');
  for (const item of value) {
    const result = item?.result;
    if (!item || typeof item !== 'object' || !/^[a-f0-9]{64}$/u.test(item.id) || !result || typeof result !== 'object' || Array.isArray(result)
      || Object.keys(result).some(key => !keys.has(key)) || !['approval', 'cancellation', 'declined', 'unknown'].includes(result.transactionType)
      || !Number.isInteger(result.confidence) || result.confidence < 0 || result.confidence > 100
      || !Array.isArray(result.warnings) || result.warnings.length > 100 || result.warnings.some(warning => typeof warning !== 'string' || warning.length > 1000)
      || ['amount', 'installmentMonths'].some(key => result[key] !== undefined && !Number.isSafeInteger(result[key]))
      || ['nonTransactionReason', 'issuer', 'declineReason', 'currency', 'merchantRaw', 'maskedCardNumber'].some(key => result[key] !== undefined && (typeof result[key] !== 'string' || result[key].length > 2048))
      || (result.occurredAt !== undefined && (typeof result.occurredAt !== 'string' || Number.isNaN(Date.parse(result.occurredAt))))) throw new Error('maintenance_invalid_candidate_output');
  }
}

/**
 * 입력·출력은 원문이 아닌 폐쇄형 판정과 해시뿐이다. 새 성공의 oracle은 고정 baseline이 만든다.
 * @param {{id: string, status: string, baseline: string, candidate: string, changed: boolean, newlyResolved: boolean, safeRecovery: boolean, suspicious: boolean}[]} rows
 * @returns {{passed: boolean, total: number, changed: number, recoverable: number, blocked: number, reasons: string[]}}
 */
export function evaluateMaintenanceGate(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10000) throw new Error('maintenance_invalid_corpus');
  const ids = new Set();
  let changed = 0; let recoverable = 0; let blocked = 0;
  for (const row of rows) {
    if (typeof row.id !== 'string' || ids.has(row.id) || !/^[a-f0-9]{64}$/u.test(row.baseline) || !/^[a-f0-9]{64}$/u.test(row.candidate)
      || !['parsed', 'pending_review', 'parse_failed', 'quarantined', 'ignored', 'pending'].includes(row.status)
      || ['changed', 'newlyResolved', 'safeRecovery', 'suspicious'].some(key => typeof row[key] !== 'boolean')
      || row.changed !== (row.baseline !== row.candidate)) throw new Error('maintenance_invalid_replay');
    ids.add(row.id);
    if (!row.changed) continue;
    changed += 1;
    if (row.status === 'parse_failed' && !row.suspicious && row.newlyResolved && row.safeRecovery) recoverable += 1;
    else blocked += 1;
  }
  return { passed: blocked === 0 && recoverable > 0, total: rows.length, changed, recoverable, blocked,
    reasons: [...(blocked > 0 ? ['protected_result_changed'] : []), ...(recoverable === 0 ? ['no_proven_recovery'] : [])] };
}
