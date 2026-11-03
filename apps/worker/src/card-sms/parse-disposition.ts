import { assertParseInvariants, type CardSmsParseResult } from '@family/card-parsers';

/** 수집 직후 pending을 제외한 파싱 결과 상태. */
export type CardSmsParseStatus =
  | 'parsed'
  | 'pending_review'
  | 'parse_failed'
  | 'quarantined'
  | 'ignored';

/** 원문을 포함하지 않는 최종 파싱 판정과 거래 승격 여부. */
export interface CardSmsParseDisposition {
  parseStatus: CardSmsParseStatus;
  parseError: string | null;
  promotable: boolean;
}

/** 안내·거절은 금액 없이도 판정이 끝난다. 승인·취소에는 금액과 통화가 필요하다. */
export function isCardSmsParseResolved(result: CardSmsParseResult): boolean {
  return (
    result.nonTransactionReason !== undefined ||
    result.transactionType === 'declined' ||
    ((result.transactionType === 'approval' || result.transactionType === 'cancellation') &&
      result.amount !== undefined && result.currency !== undefined)
  );
}

/** 안내·거절·실패·LLM 격리를 구분하고 실제 승인/취소에만 승격을 허용한다. */
export function resolveCardSmsParseDisposition(
  result: CardSmsParseResult,
  receivedAt: Date,
  fromLlm: boolean,
): CardSmsParseDisposition {
  const violations = assertParseInvariants(result, receivedAt);
  let parseStatus: CardSmsParseStatus;
  let parseError: string | null = null;

  if (violations.length > 0) {
    parseStatus = 'parse_failed';
    parseError = `invariant violated: ${violations.join('; ')}`;
  } else if (!isCardSmsParseResolved(result)) {
    parseStatus = 'parse_failed';
    parseError = result.warnings.length > 0
      ? result.warnings.join('; ')
      : 'no parseable card transaction';
  } else if (fromLlm) {
    parseStatus = 'quarantined';
    parseError = result.warnings.length > 0 ? result.warnings.join('; ') : null;
  } else if (result.nonTransactionReason !== undefined) {
    parseStatus = 'ignored';
  } else if (result.transactionType === 'declined') {
    parseStatus = 'parsed';
  } else {
    parseStatus = result.confidence >= 70 ? 'parsed' : 'pending_review';
  }

  return {
    parseStatus,
    parseError,
    promotable:
      (parseStatus === 'parsed' || parseStatus === 'pending_review') &&
      (result.transactionType === 'approval' || result.transactionType === 'cancellation'),
  };
}
