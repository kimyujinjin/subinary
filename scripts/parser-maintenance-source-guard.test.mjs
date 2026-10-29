import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertDataOnlyParserChange } from './lib/parser-maintenance-source-guard.mjs';
const source = readFileSync(new URL('../packages/card-parsers/src/parsers/generic.parser.ts', import.meta.url), 'utf8');
test('routing 정규식 리터럴의 보정만 허용한다', () => assert.doesNotThrow(() => assertDataOnlyParserChange(source, source.replace('/(승인|취소|결제|매출|매입|환불|정정)/', '/(승인|취소|결제|매출|매입|환불|정정|합성예시)/'))));
test('기존 카드 문맥 패턴 전체를 보존한 리터럴 추가를 허용한다', () => {
  assert.doesNotThrow(() => assertDataOnlyParserChange(source, source.replace('(?!\\s*은행))/;', '(?!\\s*은행)|합성카드)/;')));
});
test('import·실행문·함수·비카드 배제 조건의 변경을 차단한다', () => {
  for (const candidate of [`import fs from 'node:fs';\n${source}`, `${source}\nfetch('https://example.com');`, source.replace('return !NON_CARD_RE.test(content);', 'return true;'), source.replace('(입금|출금|이체|송금|잔액|결제', '(출금|이체|송금|잔액|결제'), source.replace('const ACTION_TOKEN_RE =', 'const ACTION_TOKEN_RE = (() => { process.exit(0); return /승인/; })() ||')]) assert.throws(() => assertDataOnlyParserChange(source, candidate), /maintenance_(?:executable_change_forbidden|source_shape_invalid)/u);
});
test('카드사 식별 regex와 문자열은 자동 변경할 수 없다', () => {
  assert.throws(() => assertDataOnlyParserChange(source, source.replace("[/삼성/, '삼성카드']", "[/삼성|다른카드/, '삼성카드']")), /maintenance_executable_change_forbidden/u);
  assert.throws(() => assertDataOnlyParserChange(source, source.replace("[/삼성/, '삼성카드']", "[/삼성/, '현대카드']")), /maintenance_executable_change_forbidden/u);
});
test('기존 패턴·flags 변경, 반복·역참조·lookaround·전역/상태성·과대 대안은 차단한다', () => {
  const original = '/(승인|취소|결제|매출|매입|환불|정정)/';
  for (const value of ['/(승인|취소)/', '/(승인|취소|결제|매출|매입|환불|정정)/g', '/(승인|취소|결제|매출|매입|환불|정정)/y', '/(승인|취소|결제|매출|매입|환불|정정)/i', '/(승인|취소|결제|매출|매입|환불|정정|(a+)+)/', '/(승인|취소|결제|매출|매입|환불|정정|(?=a)a)/', '/(승인|취소|결제|매출|매입|환불|정정|\\1)/', '/(승인|취소|결제|매출|매입|환불|정정|)/', '/(승인|취소|결제|매출|매입|환불|정정|A|B|C|D|E|F|G|H|I)/']) assert.throws(() => assertDataOnlyParserChange(source, source.replace(original, value)), /maintenance_regex_change_forbidden/u);
});
