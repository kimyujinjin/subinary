/**
 * 질문이 이름을 댄 "대상"(카테고리·가맹점) 찾기 — 결정적·순수 로직.
 *
 * ## 고친 사고 (AI 도우미 오답 P1)
 * "이번 달 스타벅스 얼마 썼어?"에는 집계 축 신호가 없다 — 카테고리 이름도 `어디서`도
 * 없고 `얼마`만 있다. 그래서 의도 해석({@link ./finance-intent})이 `total`로 떨어졌고
 * **월 총지출이 스타벅스 금액처럼** 나갔다. 가족이 만든 카테고리도 같은 길로 샜다 —
 * 의도 해석은 시스템 카테고리 이름만 알기 때문이다.
 *
 * ## 이 모듈이 하는 일
 * 질문 안에 **글자 그대로 나온** 카테고리 이름·가맹점 이름·브랜드 이름을 찾는다.
 * 유사도는 쓰지 않는다(`@family/shared` merchant-identity와 같은 원칙) — 비슷한 이름을
 * 대상으로 삼으면 다른 가게의 금액이 그 가게의 답처럼 나간다.
 *
 *  - 이름은 공백을 뺀 2자 이상만 본다. 1자는 조사·낱말 조각과 구분되지 않는다.
 *  - 겹치면 **가장 긴 일치**가 이긴다(`이마트24` > `이마트`, `외식비` > `식비`).
 *  - 길이가 같으면 카테고리 > 브랜드 > 가맹점 이름 순이다.
 *  - 가려진 가맹점(`(비공개)`)·이름 모를 가맹점은 대상이 될 수 없다.
 *
 * 전체를 묻는 말({@link WHOLE_TOTAL_SIGNAL})이 있으면 대상을 찾지 않는다 — 그 질문의
 * 답은 월 총지출이다.
 *
 * 데이터 조회는 서비스가 하고, 여기는 받은 목록만 본다(테스트가 경계 자체를 고정한다).
 */
import { REDACTED_MERCHANT_LABEL } from '@family/database';
import { MERCHANT_BRANDS, extractMerchantIdentity } from '@family/shared';

/** 이름 없는 가맹점 버킷 라벨(analytics.merchants와 같은 값). */
export const UNKNOWN_MERCHANT_LABEL = '미확인 가맹점';

/** 미분류 카테고리 버킷 라벨(analytics.categories와 같은 값). */
export const UNCATEGORIZED_LABEL = '미분류';

/** 대상 이름의 최소 길이(공백을 뺀 글자 수). */
export const SUBJECT_MIN_LENGTH = 2;

/**
 * 전체를 묻는 말. 있으면 질문에 다른 이름이 섞여 있어도 총지출로 답한다
 * ("우리 가족 전체 얼마 썼어?"의 `가족`이 가족이 만든 카테고리 이름이어도).
 *
 * 맨 `총`은 넣지 않는다 — "스타벅스에서 총 얼마 썼어?"는 스타벅스의 합계를 묻는다.
 * 전체 지출을 가리키는 `총지출`·`총사용`·`총소비`만 넣는다.
 */
export const WHOLE_TOTAL_SIGNAL =
  /총지출|총사용|총소비|전체|합계|모두|다합쳐|다합치면|통틀어/;

/**
 * 브랜드 사전에 있어도 대상 낱말로 쓰지 않는 토큰 — 감탄사와 꼴이 같다
 * ("와우 이번 달 얼마 썼어?"가 쿠팡 질문이 되면 안 된다).
 */
const AMBIGUOUS_BRAND_TOKENS: ReadonlySet<string> = new Set(['와우']);

/** 대상이 될 수 없는 가맹점 라벨. */
const NON_SUBJECT_MERCHANT_LABELS: ReadonlySet<string> = new Set([
  REDACTED_MERCHANT_LABEL,
  UNKNOWN_MERCHANT_LABEL,
]);

/** 카테고리 하나의 기간 지출(지출이 없으면 net·count 0). */
export interface CategorySpend {
  /** 시스템 카테고리 slug 또는 가족 카테고리의 내부 slug. 미분류는 null. */
  slug: string | null;
  name: string;
  net: number;
  count: number;
}

/** 가맹점 라벨 하나의 기간 지출(analytics.merchants 행과 같은 모양). */
export interface MerchantSpend {
  label: string;
  net: number;
  count: number;
}

/** 해석된 대상. 가맹점은 이름 하나 또는 브랜드 하나(여러 매장 합계)다. */
export type FinanceSubject =
  | { kind: 'category'; category: CategorySpend }
  | {
      kind: 'merchant';
      /** 답변에 쓰는 이름(가맹점 라벨 또는 브랜드 이름). */
      name: string;
      /** 그 대상의 이번 기간 행. 비었으면 "결제가 없다"가 답이다. */
      rows: MerchantSpend[];
    };

/** 가맹점 쪽 일치 결과(대상의 이번 기간 행은 아직 고르지 않은 상태). */
type MerchantTarget =
  | { kind: 'label'; label: string }
  | { kind: 'brand'; brand: string };

interface Match<T> {
  value: T;
  /** 일치한 비교 키의 길이 — 최장 일치 판정용. */
  length: number;
}

/** 비교 키: 공백을 지우고 로마자를 대문자로(질문·이름 양쪽에 같은 규칙). */
export function subjectKey(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** 전체(총지출)를 묻는 질문인가. */
export function asksForWholeTotal(question: string): boolean {
  return WHOLE_TOTAL_SIGNAL.test(question.replace(/\s+/g, ''));
}

/** `name`이 질문에 글자 그대로 들어 있으면 그 키 길이, 아니면 0. */
function containedLength(questionKey: string, name: string): number {
  const key = subjectKey(name);
  return key.length >= SUBJECT_MIN_LENGTH && questionKey.includes(key)
    ? key.length
    : 0;
}

/** 질문에 나온 카테고리 중 가장 긴 이름(같으면 앞선 것 — 지출이 있는 쪽이 앞에 온다). */
function matchCategory(
  questionKey: string,
  categories: readonly CategorySpend[],
): Match<CategorySpend> | null {
  let best: Match<CategorySpend> | null = null;
  for (const category of categories) {
    const length = containedLength(questionKey, category.name);
    if (length > 0 && (best === null || length > best.length)) {
      best = { value: category, length };
    }
  }
  return best;
}

/**
 * 질문에 나온 가맹점 이름·브랜드 중 가장 긴 것. 같은 길이면 브랜드가 이긴다 —
 * 브랜드 이름만 있는 가맹점(`스타벅스`)과 브랜드가 겹치면 그 질문은 보통 브랜드
 * 전체(`스타벅스강남`·`스타벅스여의도` 합계)를 묻는다.
 */
function matchMerchant(
  questionKey: string,
  knownLabels: readonly string[],
): Match<MerchantTarget> | null {
  let best: Match<MerchantTarget> | null = null;
  const consider = (value: MerchantTarget, length: number): void => {
    if (length === 0) return;
    if (
      best === null ||
      length > best.length ||
      (length === best.length &&
        value.kind === 'brand' &&
        best.value.kind === 'label')
    ) {
      best = { value, length };
    }
  };

  for (const entry of MERCHANT_BRANDS) {
    for (const word of [entry.id, ...entry.tokens]) {
      if (AMBIGUOUS_BRAND_TOKENS.has(word)) continue;
      consider(
        { kind: 'brand', brand: entry.id },
        containedLength(questionKey, word),
      );
    }
  }
  for (const label of knownLabels) {
    if (NON_SUBJECT_MERCHANT_LABELS.has(label)) continue;
    consider({ kind: 'label', label }, containedLength(questionKey, label));
  }
  return best;
}

/** 대상의 이번 기간 행. 이름은 비교 키로 맞춘다(`스타벅스 강남` = `스타벅스강남`). */
function rowsForTarget(
  target: MerchantTarget,
  rows: readonly MerchantSpend[],
): MerchantSpend[] {
  if (target.kind === 'label') {
    const key = subjectKey(target.label);
    return rows.filter((row) => subjectKey(row.label) === key);
  }
  return rows.filter(
    (row) =>
      !NON_SUBJECT_MERCHANT_LABELS.has(row.label) &&
      extractMerchantIdentity(row.label).brand === target.brand,
  );
}

/**
 * 질문이 이름을 댄 대상을 고른다. 없으면 null(의도 해석 결과를 그대로 쓴다).
 *
 * @param categories 이번 기간 카테고리 지출(지출 있는 것 먼저) + 지출 없는 카테고리.
 * @param merchants 이번 기간 가맹점 지출 — 상위 N개로 자르지 않은 전체여야 한다.
 *   잘린 목록이면 "결제가 없어요"가 거짓이 될 수 있다.
 * @param recentMerchantLabels 직전 기간에 본 가맹점 이름. 이번 기간에 결제가 없는
 *   가맹점을 알아보는 데만 쓴다("이번 달에는 ○○ 결제가 없어요").
 */
export function resolveFinanceSubject(
  question: string,
  input: {
    categories: readonly CategorySpend[];
    merchants: readonly MerchantSpend[];
    recentMerchantLabels: readonly string[];
  },
): FinanceSubject | null {
  if (asksForWholeTotal(question)) return null;
  const questionKey = subjectKey(question);

  const category = matchCategory(questionKey, input.categories);
  const merchant = matchMerchant(questionKey, [
    ...input.merchants.map((row) => row.label),
    ...input.recentMerchantLabels,
  ]);

  if (merchant && (category === null || merchant.length > category.length)) {
    const target = merchant.value;
    const rows = rowsForTarget(target, input.merchants);
    const name =
      target.kind === 'brand' ? target.brand : (rows[0]?.label ?? target.label);
    return { kind: 'merchant', name, rows };
  }
  return category ? { kind: 'category', category: category.value } : null;
}
