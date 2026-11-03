import { createHash } from 'node:crypto';

import { extractActionGroundedAmount } from './action-amount.js';
import { detectTransactionType } from './parsers/base.parser.js';
import { fieldCandidates } from './recipe.js';
import { assertParseInvariants } from './spans.js';
import { templateFingerprint } from './template.js';
import type { CardSmsInput, CardSmsParseResult } from './types.js';

/** 자동 적용 정책의 범위. 기존 전역 템플릿 키를 승인으로 간주하지 않는다. */
export function scopedTemplateFingerprint(
  householdId: string, memberId: string, sender: string, content: string,
): string {
  return createHash('sha256').update(JSON.stringify([
    'sms-personal-policy-v1', householdId, memberId, templateFingerprint(sender, content),
  ])).digest('hex');
}

/** 자동 적용을 보류할 이유. 원문이나 개인 식별 정보를 포함하지 않는다. */
export type AutomaticApprovalRejection =
  | 'suspicious_content' | 'approval_only' | 'krw_only' | 'incomplete_fields'
  | 'ambiguous_amount' | 'missing_exact_time' | 'issuer_mismatch' | 'invalid_fields';

/** 레시피에 복사된 카드사가 아니라 새 원문의 명시적 카드사 표기를 확인한다. */
function hasMatchingIssuer(content: string, issuer: string): boolean {
  const aliases: ReadonlyArray<readonly [RegExp, string]> = [
    [/신한\s*카드/gu, '신한카드'], [/(?:KB\s*(?:국민)?|국민)\s*카드/giu, 'KB국민카드'],
    [/삼성\s*카드/gu, '삼성카드'], [/현대\s*카드/gu, '현대카드'],
    [/롯데\s*카드/gu, '롯데카드'], [/하나\s*카드/gu, '하나카드'],
    [/우리\s*카드/gu, '우리카드'], [/(?:비씨|BC)\s*카드/giu, 'BC카드'],
    [/씨티\s*카드/gu, '씨티카드'], [/(?:NH\s*(?:농협)?|농협)\s*카드/giu, 'NH농협카드'],
    [/토스\s*뱅크/gu, '토스뱅크'],
  ];
  const matches = aliases.filter(([pattern]) => pattern.test(content)).map(([, label]) => label);
  const canonical = aliases.find(([pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(issuer.includes('카드') || issuer.includes('뱅크') ? issuer : `${issuer}카드`);
  })?.[1];
  return matches.length === 1 && matches[0] === canonical;
}

/** 잘린 토큰, 범위 밖 시각, 연도 추측이 필요한 오래된 문자는 자동 적용하지 않는다. */
function hasExactRecentTime(input: CardSmsInput, result: CardSmsParseResult): boolean {
  const spans = fieldCandidates(input.content, 'occurredAt');
  if (spans.length !== 1 || !result.occurredAt) return false;
  const span = spans[0];
  if (/[0-9A-Za-z./:+-]/u.test(input.content.slice(Math.max(0, span.start - 1), span.start))
    || /[0-9A-Za-z:]/u.test(input.content.slice(span.end, span.end + 1))) return false;
  const match = /^(\d{1,2})[./-](\d{1,2})[\s./-]+(\d{1,2}):(\d{2})$/u.exec(input.content.slice(span.start, span.end));
  if (!match) return false;
  const [, month, day, hour, minute] = match.map(Number);
  const seoul = new Date(result.occurredAt.getTime() + 9 * 60 * 60 * 1000);
  if (seoul.getUTCMonth() + 1 !== month || seoul.getUTCDate() !== day
    || seoul.getUTCHours() !== hour || seoul.getUTCMinutes() !== minute
    || seoul.getUTCSeconds() !== 0 || seoul.getUTCMilliseconds() !== 0) return false;
  const age = input.receivedAt.getTime() - result.occurredAt.getTime();
  return Number.isFinite(age) && age >= -24 * 60 * 60 * 1000 && age <= 7 * 24 * 60 * 60 * 1000;
}

/** 링크·인증·명령 유도 등은 거래 해석의 자동 적용에서 제외한다. 진위 판정은 아니다. */
export function hasSuspiciousSmsContent(content: string): boolean {
  return content.length > 4_000
    || /https?:|www\.|<[^>]+>|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/iu.test(content)
    || /\(광고\)|인증번호|인증\s*코드|비밀번호|원격\s*(설치|제어)|앱\s*설치|이전\s*지시|시스템\s*(프롬프트|명령)|ignore\s+(previous|all)|system\s*prompt|명령[을\s]*(실행|수행)/iu.test(content);
}

/**
 * 승인한 양식에도 매번 적용하는 보수적인 자동 반영 조건이다.
 * 진위 판별기가 아니며, 본인 범위 정책·카드 식별·중복 검사는 호출자가 별도로 한다.
 */
export function automaticApprovalRejection(
  input: CardSmsInput,
  result: CardSmsParseResult,
  rejected: readonly string[] = [],
): AutomaticApprovalRejection | null {
  const content = input.content;
  // 링크/인증/실행 유도와 제어 문자는 해석 대상으로만 보존하고 자동 쓰기를 막는다.
  if (hasSuspiciousSmsContent(content)) {
    return 'suspicious_content';
  }
  if (result.transactionType !== 'approval' || detectTransactionType(content) !== 'approval') return 'approval_only';
  if (result.currency !== 'KRW') return 'krw_only';
  if (!Number.isSafeInteger(result.amount) || (result.amount ?? 0) <= 0
    || !result.merchantRaw?.trim() || !result.issuer || result.issuer === '카드') return 'incomplete_fields';
  if (!hasMatchingIssuer(content, result.issuer)) return 'issuer_mismatch';
  const amounts = fieldCandidates(content, 'amount');
  if (amounts.length !== 1) return 'ambiguous_amount';
  const span = amounts[0];
  const token = content.slice(span.start, span.end).trim();
  const integer = '(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)';
  const wholeKrw = new RegExp(`^(?:${integer}\\s*원|KRW\\s*${integer}(?:\\.0{1,2})?|${integer}(?:\\.0{1,2})?\\s*KRW)$`, 'u');
  // 후보 추출기가 12.50원의 '50원'이나 음수의 절댓값만 잘라낸 경우를 차단한다.
  // 후보와 액션 추출기가 같은 정규식을 공유하므로 두 결과의 일치만으로는 부족하다.
  const preceding = content.slice(0, span.start).replace(/[^\S\r\n]+$/u, '').slice(-1);
  if (!wholeKrw.test(token) || /[0-9A-Za-z_.,+\-−–(]/u.test(preceding)) return 'invalid_fields';
  const amount = extractActionGroundedAmount(content);
  if (amount.status !== 'resolved' || amount.amount !== result.amount || amount.currency !== result.currency) return 'ambiguous_amount';
  if (!hasExactRecentTime(input, result)
    || result.warnings.some(warning => warning.includes('approximated'))) return 'missing_exact_time';
  const installments = fieldCandidates(content, 'installment');
  if (installments.length > 1) return 'invalid_fields';
  if (installments.length === 1) {
    const installment = installments[0];
    const raw = content.slice(installment.start, installment.end);
    const months = raw === '일시불' ? 1 : Number(raw.replace(/\s*개월$/u, ''));
    if (/[0-9.+\-]/u.test(content.slice(Math.max(0, installment.start - 1), installment.start))
      || !Number.isInteger(months) || months < 1 || months > 60
      || (raw === '일시불' ? (result.installmentMonths ?? 1) : result.installmentMonths) !== months) return 'invalid_fields';
  } else if (result.installmentMonths !== undefined) return 'invalid_fields';
  if (rejected.length > 0 || assertParseInvariants(result, input.receivedAt).length > 0) return 'invalid_fields';
  return null;
}
