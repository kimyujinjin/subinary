import { createHash } from 'node:crypto';
import { parseCardSms, type CardSmsParseResult } from '@family/card-parsers';
import { resolveCardSmsParseDisposition, type CardSmsParseDisposition } from './parse-disposition';

/** 작업 도구와 실제 소비자의 안전 계약 버전. 구버전 payload는 재사용하지 않는다. */
export const CARD_SMS_REPAIR_VERSION = 'deterministic-sms-repair-v1';

/** 검토 대상 원본. 원문은 메모리에서만 해시에 사용하고 감사 파일에 저장하지 않는다. */
export interface CardSmsRepairSnapshot {
  id: string;
  householdId: string;
  memberId: string;
  sender: string;
  rawContent: string;
  receivedAt: Date;
  updatedAt: Date;
  parseStatus: string;
}

/** 계획에 고정한 원본·결정적 결과와 실행 정책. */
export interface CardSmsRepairGuard {
  version: typeof CARD_SMS_REPAIR_VERSION;
  deterministicOnly: true;
  snapshotHash: string;
  resultHash: string;
}

/** 날짜·수신자·상태까지 묶어 검토 이후 변경을 감지한다. */
export function cardSmsRepairSnapshotHash(event: CardSmsRepairSnapshot): string {
  return createHash('sha256').update(JSON.stringify([
    event.id, event.householdId, event.memberId, event.sender, event.rawContent,
    event.receivedAt.toISOString(), event.updatedAt.toISOString(), event.parseStatus,
  ])).digest('hex');
}

/** 파싱 값 자체를 출력하지 않고 작업 도구와 소비자의 판정 일치를 확인한다. */
export function cardSmsRepairResultHash(result: CardSmsParseResult, disposition: CardSmsParseDisposition): string {
  return createHash('sha256').update(JSON.stringify({ result, disposition })).digest('hex');
}

/** L0에서 확정된 안내·거절·원화 거래만 계획에 포함한다. 외화 환산과 검토 후보는 제외한다. */
export function evaluateCardSmsRepair(event: CardSmsRepairSnapshot): {
  result: CardSmsParseResult;
  disposition: CardSmsParseDisposition;
  guard: CardSmsRepairGuard;
} {
  if (event.parseStatus !== 'parse_failed') throw new Error('repair_status_changed');
  const result = parseCardSms({ sender: event.sender, content: event.rawContent, receivedAt: event.receivedAt }, { actionGate: true });
  const disposition = resolveCardSmsParseDisposition(result, event.receivedAt, false);
  if (disposition.parseStatus !== 'parsed' && disposition.parseStatus !== 'ignored') throw new Error('repair_requires_manual_review');
  if (disposition.promotable && result.currency !== 'KRW') throw new Error('repair_requires_currency_review');
  return {
    result, disposition,
    guard: {
      version: CARD_SMS_REPAIR_VERSION, deterministicOnly: true,
      snapshotHash: cardSmsRepairSnapshotHash(event),
      resultHash: cardSmsRepairResultHash(result, disposition),
    },
  };
}

/** 큐 payload·원본·L0 결과가 계획과 모두 일치해야 기존 파이프라인으로 넘긴다. */
export function assertCardSmsRepairGuard(event: CardSmsRepairSnapshot, guard: CardSmsRepairGuard): void {
  if (guard.version !== CARD_SMS_REPAIR_VERSION || guard.deterministicOnly !== true ||
      !/^[a-f0-9]{64}$/u.test(guard.snapshotHash) || !/^[a-f0-9]{64}$/u.test(guard.resultHash)) {
    throw new Error('repair_invalid_guard');
  }
  const actual = evaluateCardSmsRepair(event);
  if (actual.guard.snapshotHash !== guard.snapshotHash || actual.guard.resultHash !== guard.resultHash) {
    throw new Error('repair_snapshot_or_parser_changed');
  }
}
