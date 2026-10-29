import { BadRequestException } from '@nestjs/common';
import { applyRecipe, automaticApprovalRejection, deriveRecipe, fieldCandidates, templateFingerprint, type TemplateRecipe } from '@family/card-parsers';
import type { CardSmsReviewRequest } from '@family/contracts';
import type { schema } from '@family/database';
import { resolvePaymentCardLink, type PaymentCardLinkCandidate } from '@family/shared';

/** 사람이 확인한 값이 원문에서 그대로 재현될 때만 본인 재사용 레시피를 만든다. */
export function reusableReviewRecipe(
  event: Pick<schema.CardSmsEvent, 'sender' | 'rawContent' | 'receivedAt' | 'issuer'>,
  input: CardSmsReviewRequest,
  memberId: string,
  cards: readonly PaymentCardLinkCandidate[],
): TemplateRecipe {
  const currency = (input.currency ?? 'KRW').toUpperCase();
  if (input.transactionType !== 'approval' || currency !== 'KRW' || !input.cardId) {
    throw new BadRequestException('같은 양식 재사용은 카드를 지정한 원화 승인 문자만 가능합니다. 현재 한 건만 확정할 수 있습니다.');
  }
  const source = { sender: event.sender, content: event.rawContent, receivedAt: event.receivedAt };
  // 예전 검토 요청은 일시불을 생략했다. 원문에 일시불이 명확할 때만 파서의 1개월 표기와 맞춘다.
  const installments = fieldCandidates(source.content, 'installment');
  const explicitLumpSum = installments.length === 1 && source.content.slice(installments[0].start, installments[0].end) === '일시불';
  const installmentMonths = input.installmentMonths ?? (explicitLumpSum ? 1 : undefined);
  const recipe = deriveRecipe(source, {
    transactionType: input.transactionType, issuer: input.issuer ?? event.issuer,
    amount: input.amount, currency, merchantRaw: input.merchantRaw,
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
    installmentMonths,
  }, templateFingerprint(event.sender, event.rawContent));
  const extracted = applyRecipe(source, recipe);
  const result = extracted.result;
  if (automaticApprovalRejection(source, result, extracted.rejected) !== null ||
      result.transactionType !== input.transactionType || result.amount !== input.amount ||
      result.currency !== currency || result.merchantRaw !== input.merchantRaw ||
      result.occurredAt?.getTime() !== (input.occurredAt ? new Date(input.occurredAt).getTime() : undefined) ||
      (result.installmentMonths ?? null) !== (installmentMonths ?? null)) {
    throw new BadRequestException('이 양식은 확인한 값으로 안전하게 재사용할 수 없습니다. 재사용 선택을 해제하고 현재 한 건만 확정해 주세요.');
  }
  const linked = resolvePaymentCardLink({ memberId, maskedCardNumber: result.maskedCardNumber ?? null, issuer: result.issuer ?? null }, cards);
  if (linked.ambiguous || linked.cardId !== input.cardId) {
    throw new BadRequestException('문자의 카드 식별 정보가 선택한 카드와 일치하지 않습니다. 현재 한 건만 검토해 주세요.');
  }
  return recipe;
}
