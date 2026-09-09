#!/usr/bin/env node
// 게이트 1 판정. RunLog CSV 에서 기계로 계산할 수 있는 것만 계산하고,
// 사람이 세야 하는 것은 인자로 받는다. 계산할 수 없는 것을 추정하지 않는다 —
// 틀려도 "통과했다"고 보고하는 도구를 만들지 않는 것이 이 저장소의 규칙이다.
//
//   ① 원인 불명 사망      ≤ 3 / 20      → 사람 (--unexplained N)
//   ② 틈 방향 예측 적중   ≥ 15 / 20     → 사람 (--predict-in N --predict-out N)
//   ③ 사망 → 다음 입력    p90 < 1.0 s   → CSV 의 restart 행
//   ④ Weber 콘트라스트    ≥ 0.25        → 스크린샷 (--weber X)
//   ⑤ 재파지 발생률       ≤ 0.1 회/분   → CSV
//      재파지 후 400ms 사망 ≤ 15 %      → CSV
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--'))
if (!file) { console.error('usage: verify-shmup-funloop.mjs <runlog.csv> [--unexplained N] ...'); process.exit(2) }
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i >= 0 && argv[i + 1] !== undefined) return Number(argv[i + 1])
  const eq = argv.find(a => a.startsWith(`--${n}=`))
  return eq ? Number(eq.split('=')[1]) : d
}

const lines = readFileSync(file, 'utf8').trim().split('\n')
const head = lines[0].split(',')
const col = Object.fromEntries(head.map((h, i) => [h, i]))
const rows = lines.slice(1).map(l => l.split(','))
const of = (r, k) => r[col[k]]
const num = (r, k) => Number(of(r, k))

const deaths = rows.filter(r => r[0] === 'death')
const restarts = rows.filter(r => r[0] === 'restart')
const ticks = rows.filter(r => r[0] === 'tick')
const builds = new Set(rows.filter(r => of(r, 'build')).map(r => of(r, 'build')))

// 판정은 실기 release 빌드에서만 유효하다. debug 로그로 판정하면 양방향 모두 틀린다.
const isRelease = [...builds].some(b => b.includes('release'))

const p = (arr, q) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]
}

// ③ restart 행의 gap_w 칼럼 = 사망 → 다음 입력 (벽시계 틱)
const respond = restarts.map(r => num(r, 'gap_w') / 60)
// ⑤ 재파지: 마지막 tick 행의 regrip 누적 / 총 플레이 시간
const playMin = ticks.length ? (Math.max(...ticks.map(r => num(r, 'tick'))) / 60) / 60 : 0
const regripTotal = Math.max(0, ...rows.map(r => num(r, 'regrip') || 0))
const regripRate = playMin > 0 ? regripTotal / playMin : NaN
const regripDeaths = deaths.filter(r => {
  const s = num(r, 'since_regrip')
  return s >= 0 && s <= 24            // 400ms = 24틱
}).length
const regripDeathPct = deaths.length ? (regripDeaths / deaths.length) * 100 : NaN

const unexplained = flag('unexplained')
const predIn = flag('predict-in')
const predOut = flag('predict-out')
const weber = flag('weber')

const out = []
const judge = (id, label, value, ok, note = '') =>
  out.push({ id, label, value, ok, note })

judge('①', '원인 불명 사망 ≤ 3/20', unexplained === null ? '미측정' : `${unexplained}/20`,
  unexplained === null ? null : unexplained <= 3, '사람이 센다')
judge('②', '틈 방향 예측 ≥ 15/20 (실내·야외)',
  predIn === null || predOut === null ? '미측정' : `실내 ${predIn}/20 · 야외 ${predOut}/20`,
  predIn === null || predOut === null ? null : predIn >= 15 && predOut >= 15, '사람이 센다')
judge('③', '사망 → 다음 입력 p90 < 1.0s',
  respond.length ? `p90 ${p(respond, 0.9).toFixed(2)}s (n=${respond.length})` : '미측정',
  respond.length ? p(respond, 0.9) < 1.0 : null)
judge('④', 'Weber 콘트라스트 ≥ 0.25', weber === null ? '미측정' : weber.toFixed(3),
  weber === null ? null : weber >= 0.25, '야외 최대 밝기 스크린샷')
judge('⑤a', '재파지 ≤ 0.1 회/분',
  Number.isFinite(regripRate) ? `${regripRate.toFixed(3)} 회/분 (총 ${regripTotal})` : '미측정',
  Number.isFinite(regripRate) ? regripRate <= 0.1 : null)
judge('⑤b', '재파지 후 400ms 내 사망 ≤ 15%',
  Number.isFinite(regripDeathPct) ? `${regripDeathPct.toFixed(1)}% (${regripDeaths}/${deaths.length})` : '미측정',
  Number.isFinite(regripDeathPct) ? regripDeathPct <= 15 : null)

console.log(`\n게이트 1 판정 — ${file}`)
console.log(`빌드: ${[...builds].join(', ') || '불명'}${isRelease ? '' : '   ← release 아님. 이 판정은 무효다'}`)
console.log(`사망 ${deaths.length}회 · 재시작 ${restarts.length}회 · 플레이 ${(playMin).toFixed(1)}분\n`)
for (const r of out) {
  const mark = r.ok === null ? '· ' : r.ok ? 'OK' : '✗ '
  console.log(`  ${mark} ${r.id} ${r.label.padEnd(34)} ${String(r.value).padEnd(30)} ${r.note}`)
}

const measured = out.filter(r => r.ok !== null)
const failed = measured.filter(r => !r.ok)
const missing = out.filter(r => r.ok === null)
console.log('')
if (!isRelease) {
  console.log('무효: 실기 release 빌드의 로그가 아니다. 에디터 실행은 1.6~1.9배 느리고')
  console.log('      합성 터치가 index 0 하나뿐이라 조작 지표가 원리적으로 재현되지 않는다.')
  process.exit(3)
}
if (missing.length) console.log(`미측정 ${missing.length}건: ${missing.map(r => r.id).join(' ')}`)
if (failed.length) {
  console.log(`미달 ${failed.length}건: ${failed.map(r => r.id).join(' ')}`)
  console.log('→ 다섯 숫자 중 하나라도 미달이면 패턴 4종째를 만들지 않는다.')
  process.exit(1)
}
if (missing.length) { console.log('→ 전 항목 측정 전에는 통과 판정을 내리지 않는다.'); process.exit(2) }
console.log('숫자 5개 전부 통과. 마지막 한 문장을 기록하라 —')
console.log('  "이 30초를 지금 한 번 더 하고 싶은가."  예 / 아니오')
