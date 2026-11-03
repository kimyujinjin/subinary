import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { deriveRecipe, parseCardSms, scopedTemplateFingerprint, templateFingerprint } from '@family/card-parsers';
import { schema } from '@family/database';
import { TemplateRecipeService } from './template-recipe.service';

const input = {
  sender: 'test-card',
  content: '[Web발신]\n현대카드(1234)승인\n김*수\n10/28 10:30\n12,000원 일시불\n테스트상점',
  receivedAt: new Date('2026-10-28T10:30:30+09:00'),
};
const result = parseCardSms(input);
const recipe = {
  ...deriveRecipe(input, { ...result, amount: result.amount, currency: result.currency }, templateFingerprint(input.sender, input.content)),
  approvedCardId: '00000000-0000-4000-8000-000000000001', automationEnabled: true,
};

/** 실제 SQL 생성과 합성 결과로 조회 범위·거절·관측 실패 경계를 확인한다. */
function setup(stored: Record<string, unknown> | null, failCounter = false) {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(sql: string, params: readonly unknown[]) {
      queries.push({ sql, params });
      const promise = Promise.resolve().then((): unknown[][] => {
        if (sql.startsWith('update')) {
          if (failCounter) throw new Error('synthetic counter unavailable');
          return [];
        }
        return stored ? [[stored]] : [];
      });
      return Object.assign(promise, { values: () => promise });
    },
  };
  const db = drizzle(driver as unknown as postgres.Sql, { schema });
  return { service: new TemplateRecipeService(db, new ConfigService()), queries };
}

describe('명시적으로 승인한 개인 문자 양식만 재사용', () => {
  it('가구·구성원·승인자·활성회원 조건과 개인키로 조회한다', async () => {
    const { service, queries } = setup(recipe);
    expect((await service.extract(input, 'household', 'self'))?.result.amount).toBe(12000);
    expect(queries[0].params).toContain(scopedTemplateFingerprint('household', 'self', input.sender, input.content));
    expect(queries[0].params).toContain('household');
    expect(queries[0].params).toContain('self');
    expect(queries[0].params).toContain('active');
    expect(queries[0].sql).toContain('"household_members"."user_id" = "card_sms_templates"."confirmed_by"');
  });

  it.each([
    null, { ...recipe, automationEnabled: undefined }, { ...recipe, automationEnabled: false },
    { ...recipe, approvedCardId: undefined }, { ...recipe, fingerprint: 'changed' },
    { ...recipe, fields: { amount: { candidateIndex: -1 } } },
    { ...recipe, fields: { command: { candidateIndex: 0 } } },
  ])('예전 전역양식·중지·손상 규칙은 적용하지 않는다', async stored => {
    const { service, queries } = setup(stored);
    expect(await service.extract(input, 'household', 'self')).toBeNull();
    expect(queries.some(query => query.sql.startsWith('update'))).toBe(false);
  });

  it('양식 조회가 성공해도 의심 문구가 있으면 후보를 돌려주지 않는다', async () => {
    const modified = { ...input, content: `${input.content}\nhttps://fake.example` };
    const { service } = setup({ ...recipe, fingerprint: templateFingerprint(modified.sender, modified.content) });
    expect(await service.extract(modified, 'household', 'self')).toBeNull();
  });

  it('관측 카운터 장애로 검증된 해석 결과를 잃지 않는다', async () => {
    const { service } = setup(recipe, true);
    expect((await service.extract(input, 'household', 'self'))?.result.amount).toBe(12000);
  });
});
