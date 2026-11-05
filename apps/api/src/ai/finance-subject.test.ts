/**
 * 질문이 이름을 댄 대상 해석의 경계(AI 도우미 오답 P1).
 *
 * 지키는 사고는 두 방향이다.
 *  - **자신 있는 오답**: "스타벅스 얼마 썼어?"에 월 총지출이 나가는 것(이번 버그).
 *  - **엉뚱한 대상**: 질문에 없는 가게·비슷한 이름·가려진 이름이 대상이 되는 것.
 */
import { describe, expect, it } from 'vitest';

import {
  asksForWholeTotal,
  resolveFinanceSubject,
  type CategorySpend,
  type MerchantSpend,
} from './finance-subject';

const CATEGORIES: CategorySpend[] = [
  { slug: 'food', name: '식비', net: 300_000, count: 20 },
  { slug: 'custom-1a2b3c4d', name: '아이 용품', net: 52_000, count: 3 },
  { slug: 'cafe', name: '카페', net: 40_000, count: 8 },
  // 지출이 없는 카테고리(가족 카테고리 목록에서 온다).
  { slug: 'custom-9f8e7d6c', name: '외식비', net: 0, count: 0 },
  { slug: null, name: '미분류', net: 0, count: 0 },
  { slug: 'custom-00000001', name: '차', net: 0, count: 0 },
];

const MERCHANTS: MerchantSpend[] = [
  { label: '쿠팡', net: 120_000, count: 4 },
  { label: '스타벅스강남R점', net: 9_000, count: 2 },
  { label: 'STARBUCKS 여의도', net: 3_300, count: 1 },
  { label: '이마트24 센트럴', net: 5_000, count: 1 },
  { label: '이마트 신도림', net: 40_000, count: 1 },
  { label: 'CU신도림', net: 2_500, count: 1 },
  { label: '카페드롭탑', net: 4_800, count: 1 },
  { label: '동네빵집', net: 6_000, count: 2 },
  { label: '(비공개)', net: 77_000, count: 2 },
  { label: '미확인 가맹점', net: 1_000, count: 1 },
];

function resolve(
  question: string,
  overrides: Partial<Parameters<typeof resolveFinanceSubject>[1]> = {},
) {
  return resolveFinanceSubject(question, {
    categories: CATEGORIES,
    merchants: MERCHANTS,
    recentMerchantLabels: [],
    ...overrides,
  });
}

describe('가맹점을 이름으로 물으면 그 가맹점의 금액이다(총지출이 아니다)', () => {
  it('브랜드 이름은 그 브랜드의 모든 매장을 모은다(로마자 표기 포함)', () => {
    expect(resolve('이번 달 스타벅스 얼마 썼어?')).toEqual({
      kind: 'merchant',
      name: '스타벅스',
      rows: [
        { label: '스타벅스강남R점', net: 9_000, count: 2 },
        { label: 'STARBUCKS 여의도', net: 3_300, count: 1 },
      ],
    });
  });

  it('사전에 없는 가맹점은 이름이 그대로 질문에 있으면 대상이다', () => {
    expect(resolve('동네빵집 얼마 썼어?')).toEqual({
      kind: 'merchant',
      name: '동네빵집',
      rows: [{ label: '동네빵집', net: 6_000, count: 2 }],
    });
  });

  it('공백이 달라도 같은 이름이고, 매장 이름이 브랜드보다 길면 매장 하나다', () => {
    expect(resolve('스타벅스 강남R점 얼마 나갔어?')).toEqual({
      kind: 'merchant',
      name: '스타벅스강남R점',
      rows: [{ label: '스타벅스강남R점', net: 9_000, count: 2 }],
    });
  });

  it('가장 긴 일치가 이긴다 — 이마트24는 이마트가 아니다', () => {
    expect(resolve('이마트24에서 얼마 썼어?')).toMatchObject({
      kind: 'merchant',
      name: '이마트24',
      rows: [{ label: '이마트24 센트럴' }],
    });
    expect(resolve('이마트 얼마 썼어?')).toMatchObject({
      kind: 'merchant',
      name: '이마트',
      rows: [{ label: '이마트 신도림' }],
    });
  });

  it('한글 음차로 물어도 같은 브랜드다(씨유 = CU)', () => {
    expect(resolve('씨유 얼마 썼어?')).toMatchObject({
      kind: 'merchant',
      name: 'CU',
      rows: [{ label: 'CU신도림' }],
    });
  });

  it('맨 "총"은 전체 질문이 아니다 — 스타벅스의 합계를 묻는다', () => {
    expect(resolve('이번 달 스타벅스에서 총 얼마 썼어?')).toMatchObject({
      kind: 'merchant',
      name: '스타벅스',
    });
  });
});

describe('이번 달 결제가 없는 가맹점도 알아본다("결제가 없어요")', () => {
  it('직전 기간에 본 가맹점이면 이번 달 행은 비어 있다', () => {
    expect(
      resolve('이번 달 넷플릭스 얼마 썼어?', {
        recentMerchantLabels: ['넷플릭스'],
      }),
    ).toEqual({ kind: 'merchant', name: '넷플릭스', rows: [] });
  });

  it('브랜드 사전에 있는 이름은 거래가 없어도 알아본다', () => {
    expect(resolve('다이소 얼마 썼어?', { merchants: [] })).toEqual({
      kind: 'merchant',
      name: '다이소',
      rows: [],
    });
  });

  it('어디서도 본 적 없는 이름은 대상이 아니다(의도 해석에 맡긴다)', () => {
    expect(resolve('이번 달 넷플릭스 얼마 썼어?')).toBeNull();
  });
});

describe('카테고리를 이름으로 물으면 그 카테고리다(가족 카테고리 포함)', () => {
  it('가족이 만든 카테고리도 대상이다', () => {
    expect(resolve('이번 달 아이 용품 얼마 썼어?')).toEqual({
      kind: 'category',
      category: { slug: 'custom-1a2b3c4d', name: '아이 용품', net: 52_000, count: 3 },
    });
  });

  it('지출이 없는 카테고리도 대상이다 — 더 긴 이름이 이긴다(외식비 > 식비)', () => {
    expect(resolve('외식비 얼마야?')).toEqual({
      kind: 'category',
      category: { slug: 'custom-9f8e7d6c', name: '외식비', net: 0, count: 0 },
    });
  });

  it('미분류도 물을 수 있다', () => {
    expect(resolve('미분류 얼마야?')).toMatchObject({
      kind: 'category',
      category: { slug: null, name: '미분류' },
    });
  });

  it('카테고리 이름보다 긴 가맹점 이름이 있으면 가맹점이다', () => {
    expect(resolve('카페드롭탑 얼마 썼어?')).toMatchObject({
      kind: 'merchant',
      name: '카페드롭탑',
    });
    expect(resolve('카페 얼마 썼어?')).toMatchObject({
      kind: 'category',
      category: { name: '카페' },
    });
  });

  it('길이가 같으면 카테고리가 이긴다', () => {
    expect(
      resolve('쿠팡 얼마 썼어?', {
        categories: [{ slug: 'custom-c0ffee00', name: '쿠팡', net: 1_000, count: 1 }],
      }),
    ).toMatchObject({ kind: 'category', category: { name: '쿠팡' } });
  });
});

describe('대상이 될 수 없는 것', () => {
  it('전체를 묻는 말이 있으면 이름이 섞여 있어도 총지출이다', () => {
    expect(resolve('이번 달 아이 용품 포함 전체 얼마 썼어?')).toBeNull();
    expect(resolve('이번 달 총 지출 얼마야?')).toBeNull();
    expect(resolve('스타벅스랑 쿠팡 다 합쳐서 얼마야?')).toBeNull();
  });

  it('가려진 가맹점·이름 모를 가맹점은 대상이 아니다', () => {
    expect(resolve('(비공개) 얼마 썼어?')).toBeNull();
    expect(resolve('미확인 가맹점 얼마 썼어?')).toBeNull();
  });

  it('브랜드 사전의 감탄사 꼴 토큰(와우)은 대상 낱말이 아니다', () => {
    expect(resolve('와우 이번 달 얼마 썼어?')).toBeNull();
  });

  it('한 글자 이름은 보지 않는다', () => {
    expect(resolve('차 얼마 썼어?')).toBeNull();
  });

  it('이름이 없는 질문은 그대로 의도 해석에 맡긴다(회귀 방어)', () => {
    for (const question of [
      '이번 달 얼마 썼어?',
      '어디서 제일 많이 썼어?',
      '카테고리별로 보여줘',
      '지난달 총액이 얼마였지?',
    ]) {
      expect(resolve(question), `"${question}"`).toBeNull();
    }
  });
});

describe('전체를 묻는 말', () => {
  it('총지출·전체·합계·모두·다 합쳐는 전체 질문이다', () => {
    for (const question of [
      '이번 달 총 지출 얼마야?',
      '전체 얼마 썼어?',
      '다 합쳐서 얼마야?',
      '카테고리별 합계 알려줘',
      '모두 얼마 나갔어?',
    ]) {
      expect(asksForWholeTotal(question), `"${question}"`).toBe(true);
    }
  });

  it('맨 "총"·금액만 묻는 말은 전체 질문 표시가 아니다', () => {
    for (const question of ['스타벅스에서 총 얼마 썼어?', '이번 달 얼마 썼어?']) {
      expect(asksForWholeTotal(question), `"${question}"`).toBe(false);
    }
  });
});
