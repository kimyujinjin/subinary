// 원문은 stdin 메모리에서만 읽는다. 후보 실행과 신뢰 판정은 서로 다른 컨테이너다.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as baseline from '/app/packages/card-parsers/dist/index.mjs';
const payload = JSON.parse(readFileSync(0, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const resolved = result => result.nonTransactionReason !== undefined || result.transactionType === 'declined'
  || (['approval', 'cancellation'].includes(result.transactionType) && Number.isSafeInteger(result.amount) && typeof result.currency === 'string');
if (process.argv[2] === 'candidate' || process.argv[2] === 'candidate-cjs') {
  const module = await import(process.argv[2] === 'candidate-cjs' ? '/app/packages/card-parsers/dist/candidate.js' : '/app/packages/card-parsers/dist/candidate.mjs');
  const candidate = typeof module.parseCardSms === 'function' ? module : module.default;
  const output = payload.rows.map(row => ({ id: hash(row.id), result: candidate.parseCardSms({ sender: row.sender, content: row.content, receivedAt: new Date(row.receivedAt) }, { actionGate: true }) }));
  process.stdout.write(JSON.stringify(output));
} else {
const output = payload.rows.map((row, index) => {
  const input = { sender: row.sender, content: row.content, receivedAt: new Date(row.receivedAt) };
  const old = baseline.parseCardSms(input, { actionGate: true });
  // 후보 코드는 이 컨테이너에 없다. 후보 입력 변이나 전역 객체 변조가 oracle에 전달되지 않는다.
  const supplied = payload.candidates?.[index];
  if (Object.hasOwn(payload, 'candidates') && (!supplied || typeof supplied.result !== 'object' || supplied.result === null)) throw new Error('maintenance_candidate_missing');
  if (supplied && supplied.id !== hash(row.id)) throw new Error('maintenance_candidate_order');
  const next = supplied ? { ...supplied.result, ...(supplied.result.occurredAt ? { occurredAt: new Date(supplied.result.occurredAt) } : {}) } : old;
  const suspicious = baseline.hasSuspiciousSmsContent(input.content);
  // 새 성공은 변경하지 않은 운영 baseline의 필드 추출·엄격 검증에 모두 일치해야 한다.
  const exactCard = baseline.parseMaskedCardNumber(input.content);
  const merchant = baseline.extractMerchant(input.content);
  const time = baseline.parseOccurredAt(input.content, input.receivedAt);
  const safeRecovery = !suspicious && next.nonTransactionReason === undefined && next.declineReason === undefined
    && next.transactionType === 'approval' && next.confidence >= 70 && baseline.automaticApprovalRejection(input, next) === null
    && typeof exactCard === 'string' && next.maskedCardNumber === exactCard
    && typeof merchant === 'string' && next.merchantRaw === merchant && input.content.includes(merchant)
    && next.installmentMonths === baseline.parseInstallmentMonths(input.content)
    && next.occurredAt?.toISOString() === time.occurredAt?.toISOString();
  return { id: hash(row.id), status: row.status, baseline: hash(old), candidate: hash(next), changed: hash(old) !== hash(next),
    newlyResolved: !resolved(old) && resolved(next), safeRecovery, suspicious };
});
process.stdout.write(JSON.stringify(output));
}
