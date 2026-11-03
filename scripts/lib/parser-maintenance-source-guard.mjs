import { createRequire } from 'node:module';
const requireParser = createRequire(new URL('../../packages/card-parsers/package.json', import.meta.url));
const ts = requireParser('typescript');
const ALLOWED = new Set(['ACTION_TOKEN_RE', 'CARD_CONTEXT_RE']);

/**
 * 자동 배포는 기존 routing 정규식 끝에 단순 한글/영문 대안 추가만 허용한다.
 * 실행문·import·호출·함수·비카드 배제 조건을 추가/변경할 수 없다. 새 fixture는 격리 실행만 한다.
 * @param {string} source @returns {{skeleton:string,literals:Map<string,string>}}
 */
function skeleton(source) {
  if (typeof source !== 'string' || source.length > 50000) throw new Error('maintenance_source_shape_invalid');
  const file = ts.createSourceFile('generic.parser.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) throw new Error('maintenance_source_shape_invalid');
  const ranges = [];
  const literals = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ALLOWED.has(node.name.text)) {
      if (!node.initializer || !ts.isRegularExpressionLiteral(node.initializer) || literals.has(node.name.text)) throw new Error('maintenance_source_shape_invalid');
      literals.set(node.name.text, node.initializer.getText(file));
      ranges.push([node.initializer.getStart(file), node.initializer.getEnd(), '/__MAINTENANCE_LITERAL__/']);
    } else ts.forEachChild(node, visit);
  }
  visit(file);
  let normalized = source;
  for (const [start, end, replacement] of ranges.sort((a, b) => b[0] - a[0])) normalized = normalized.slice(0, start) + replacement + normalized.slice(end);
  const parsed = ts.createSourceFile('generic.parser.ts', normalized, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return { skeleton: ts.createPrinter({ removeComments: true }).printFile(parsed), literals };
}

/** @param {string} baseline @param {string} candidate */
export function assertDataOnlyParserChange(baseline, candidate) {
  const old = skeleton(baseline); const next = skeleton(candidate);
  if (old.skeleton !== next.skeleton || old.literals.size !== 2 || next.literals.size !== 2) throw new Error('maintenance_executable_change_forbidden');
  for (const [name, literal] of old.literals) {
    const changed = next.literals.get(name);
    if (changed === literal) continue;
    const before = /^\/(.+)\/([a-z]*)$/su.exec(literal);
    const after = /^\/(.+)\/([a-z]*)$/su.exec(changed ?? '');
    if (!before || !after || before[2] !== after[2] || /[gy]/u.test(after[2])
      || !before[1].startsWith('(') || !before[1].endsWith(')') || !after[1].endsWith(')')
      || !after[1].startsWith(before[1].slice(0, -1))) throw new Error('maintenance_regex_change_forbidden');
    const additions = after[1].slice(before[1].length - 1, -1);
    if (!/^(?:\|[A-Za-z가-힣]{1,32}){1,8}$/u.test(additions)) throw new Error('maintenance_regex_change_forbidden');
  }
}
