/**
 * L1 — 템플릿 레시피 추출 (ADR-0023 S4).
 *
 * 규칙 파서(L0)가 못 읽은 문자를 **LLM보다 먼저** 처리한다. 사람이 한 번 확정해
 * 레시피가 생긴 레이아웃이면 여기서 끝나고 LLM 호출이 0회가 된다.
 *
 * 본인이 재사용을 선택한 양식만 조회한다. 지문 일치는 레이아웃 후보 식별일 뿐,
 * 문자 진위를 보장하지 않는다. 필드 검증 후에도 카드·중복의 원자적 검사 전에는
 * 거래를 생성하지 않는다. 기존 전역 템플릿을 개인의 승인으로 간주하지 않는다.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  applyRecipe,
  automaticApprovalRejection,
  scopedTemplateFingerprint,
  templateFingerprint,
  type CardSmsInput,
  type SpanExtraction,
  type TemplateRecipe,
} from '@family/card-parsers';
import type { AppConfig } from '@family/config';
import { schema, type Db } from '@family/database';
import { createLogger } from '@family/shared';
import { and, eq, sql } from 'drizzle-orm';

import { DB } from '../database/database.module';

function isRecipe(value: unknown): value is TemplateRecipe {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<TemplateRecipe>;
  return (
    candidate.schemaVersion === 'card-sms-recipe-v1' &&
    typeof candidate.fingerprint === 'string' &&
    candidate.transactionType === 'approval' &&
    candidate.fields !== null &&
    typeof candidate.fields === 'object' &&
    Object.entries(candidate.fields).every(([field, rule]) =>
      ['amount', 'occurredAt', 'merchant', 'installment'].includes(field)
      && rule !== null && typeof rule === 'object'
      && Number.isInteger(rule.candidateIndex) && rule.candidateIndex >= 0)
  );
}

@Injectable()
export class TemplateRecipeService {
  private readonly logger: ReturnType<typeof createLogger>;

  constructor(
    @Inject(DB) private readonly db: Db,
    configService: ConfigService,
  ) {
    const nodeEnv = configService.get<AppConfig['app']>('app')?.nodeEnv;
    this.logger = createLogger('worker:template-recipe', {
      pretty: nodeEnv !== 'production',
    });
  }

  /** 지문에 등록된 레시피가 있으면 적용 결과를, 없으면 null을 돌려준다. */
  async extract(input: CardSmsInput, householdId: string, memberId: string): Promise<SpanExtraction | null> {
    const fingerprint = scopedTemplateFingerprint(householdId, memberId, input.sender, input.content);
    const [row] = await this.db
      .select({ recipe: schema.cardSmsTemplates.recipe })
      .from(schema.cardSmsTemplates)
      .innerJoin(schema.cardSmsEvents, eq(schema.cardSmsEvents.id, schema.cardSmsTemplates.sourceEventId))
      .innerJoin(schema.householdMembers, and(
        eq(schema.householdMembers.id, schema.cardSmsEvents.memberId),
        eq(schema.householdMembers.userId, schema.cardSmsTemplates.confirmedBy),
      ))
      .where(and(
        eq(schema.cardSmsTemplates.fingerprint, fingerprint),
        eq(schema.cardSmsEvents.householdId, householdId),
        eq(schema.cardSmsEvents.memberId, memberId),
        eq(schema.householdMembers.status, 'active'),
      ))
      .limit(1);
    if (!row || !isRecipe(row.recipe) || typeof row.recipe.approvedCardId !== 'string'
      || row.recipe.automationEnabled !== true
      || row.recipe.fingerprint !== templateFingerprint(input.sender, input.content)) return null;

    const extraction = applyRecipe(input, row.recipe);
    if (automaticApprovalRejection(input, extraction.result, extraction.rejected) !== null) return null;

    // 적용 횟수는 관측용이라 실패해도 파싱을 막지 않는다.
    try {
      await this.db
        .update(schema.cardSmsTemplates)
        .set({ hitCount: sql`${schema.cardSmsTemplates.hitCount} + 1` })
        .where(eq(schema.cardSmsTemplates.fingerprint, fingerprint));
    } catch {
      // 무시 — 카운터는 best-effort.
    }

    this.logger.info(
      {
        fingerprint: fingerprint.slice(0, 12),
        rejectedCount: extraction.rejected.length,
        hasAmount: extraction.result.amount !== undefined,
      },
      'card-sms template recipe applied',
    );
    return extraction;
  }
}
