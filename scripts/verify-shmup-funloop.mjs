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
const allRows = lines.slice(1).map(l => l.split(','))
const of = (r, k) => r[col[k]]
const num = (r, k) => Number(of(r, k))

// ── 세션 분리
// RunLog 는 앱 실행마다 append 되고 "run" 행이 실행 1회의 시작이다.
// 기본은 마지막 세션만 판정한다 — 설정을 바꾸기 전 세션이 섞이면 판정이 오염된다.
const runIdx = allRows.map((r, i) => (r[0] === 'run' ? i : -1)).filter(i => i >= 0)
const allSessions = argv.includes('--all-sessions')
const rows = (!allSessions && runIdx.length > 1)
  ? allRows.slice(runIdx[runIdx.length - 1])
  : allRows
const droppedSessions = allSessions ? 0 : Math.max(0, runIdx.length - 1)

const deaths = rows.filter(r => r[0] === 'death')
const restarts = rows.filter(r => r[0] === 'restart')
const ticks = rows.filter(r => r[0] === 'tick')
const builds = new Set(allRows.filter(r => of(r, 'build')).map(r => of(r, 'build')))
const isRelease = [...builds].some(b => b.includes('release'))

const p = (arr, q) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]
}

// ③ restart 행의 gap_w 칼럼 = 사망 → 다음 입력 (벽시계 틱).
// wall_tick 은 런 리셋과 무관하게 단조 증가하므로 값 자체는 맞다.
// 다만 앱을 켜 둔 채 방치한 구간이 섞이면 p90 이 무의미해지므로
// 30초를 넘는 간격은 "세션 이탈"로 분리해 개수를 명시한다 — 잘라내지 않고 드러낸다.
const AWAY_S = 30
const respondAll = restarts.map(r => num(r, 'gap_w') / 60)
const respond = respondAll.filter(v => v <= AWAY_S)
const away = respondAll.length - respond.length

// 플레이 시간: tick 행은 sim_tick 60틱마다 1행이므로 행 수 = 초.
// max(tick) 을 쓰면 안 된다 — sim_tick 은 런마다 0 으로 리셋되므로
// "마지막 런의 길이"를 재게 되고, 재파지율 분모가 폭주한다(실측: 0.1분 → 15회/분).
const playMin = ticks.length / 60

// ⑤ 재파지: TouchRouter.reset_run() 이 런마다 0 으로 되돌리므로 누적이 아니다.
// 런별 최대값을 합산해야 세션 누적이 된다.
const perRun = new Map()
for (const r of rows) {
  if (r[0] !== 'death' && r[0] !== 'restart' && r[0] !== 'tick') continue
  const k = of(r, 'run')
  const v = num(r, 'regrip')
  if (!Number.isFinite(v)) continue
  perRun.set(k, Math.max(perRun.get(k) ?? 0, v))
}
const regripTotal = [...perRun.values()].reduce((a, b) => a + b, 0)
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
  respond.length
    ? `p90 ${p(respond, 0.9).toFixed(2)}s · p50 ${p(respond, 0.5).toFixed(2)}s (n=${respond.length}${away ? `, 이탈 ${away} 제외` : ''})`
    : `미측정${away ? ` (전부 ${AWAY_S}s 초과 이탈 ${away}건)` : ''}`,
  respond.length ? p(respond, 0.9) < 1.0 : null)
judge('④', 'Weber 콘트라스트 ≥ 0.25', weber === null ? '미측정' : weber.toFixed(3),
  weber === null ? null : weber >= 0.25, '야외 최대 밝기 스크린샷')
judge('⑤a', '재파지 ≤ 0.1 회/분',
  Number.isFinite(regripRate) ? `${regripRate.toFixed(3)} 회/분 (총 ${regripTotal})` : '미측정',
  Number.isFinite(regripRate) ? regripRate <= 0.1 : null)
judge('⑤b', '재파지 후 400ms 내 사망 ≤ 15%',
  Number.isFinite(regripDeathPct) ? `${regripDeathPct.toFixed(1)}% (${regripDeaths}/${deaths.length})` : '미측정',
  Number.isFinite(regripDeathPct) ? regripDeathPct <= 15 : null)

// 보스 러시 세션이면 게이트 1 지표가 아니라 게이트 2 요약을 낸다.
// 게이트 2 의 질문은 숫자가 아니다 — "이 싸움이 재미있는가". 숫자는 그 대답의 근거로만 쓴다.
const sessionMode = (String(of(rows[0] || [], 'detail') || '').match(/mode=(\w+)/) || [])[1] || 'stage'
if (sessionMode === 'boss') {
  const clears = rows.filter(r => r[0] === 'clear').map(r => Object.fromEntries(
    String(of(r, 'detail') || '').split(';').filter(Boolean).map(kv => kv.split('='))))
  const byKind = {}
  for (const d of deaths) byKind[of(d, 'kind')] = (byKind[of(d, 'kind')] || 0) + 1
  const surv = deaths.map(d => num(d, 'tick') / 60)
  console.log(`\n게이트 2 요약 (보스 P1) — ${file}`)
  console.log(`빌드: ${[...builds].join(', ') || '불명'}`)
  console.log(`도전 ${perRun.size}회 · 격파 ${clears.length} · 사망 ${deaths.length}`)
  if (clears.length) {
    const t = clears.map(c => +c.t)
    const hp = clears.filter(c => c.reason === 'hp').length
    console.log(`  격파 시간 p50 ${p(t, 0.5).toFixed(1)}s (HP 도달 ${hp} · 50초 경과 ${clears.length - hp})`)
  }
  if (deaths.length) {
    console.log(`  사망 시점 p50 ${p(surv, 0.5).toFixed(1)}s · 원인 ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  console.log('\n게이트 2 는 한 문장이다 — "이 싸움이 재미있는가."  예 / 아니오')
  process.exit(0)
}

console.log(`\n게이트 1 판정 — ${file}`)
console.log(`빌드: ${[...builds].join(', ') || '불명'}${isRelease ? '' : '   ← release 아님. 이 판정은 무효다'}`)
console.log(`사망 ${deaths.length}회 · 재시작 ${restarts.length}회 · 플레이 ${playMin.toFixed(1)}분 · 런 ${perRun.size}개`
  + (droppedSessions ? `   (이전 세션 ${droppedSessions}개 제외 — --all-sessions 로 포함)` : '') + '\n')
for (const r of out) {
  const mark = r.ok === null ? '· ' : r.ok ? 'OK' : '✗ '
  console.log(`  ${mark} ${r.id} ${r.label.padEnd(34)} ${String(r.value).padEnd(30)} ${r.note}`)
}

const measured = out.filter(r => r.ok !== null)
const failed = measured.filter(r => !r.ok)
const missing = out.filter(r => r.ok === null)
// 3단계 시스템 — 구제 창이 실제로 쓰이는가. 창이 열린 줄 모르면 그 기능은 없는 것과 같다.
const hits = rows.filter(r => r[0] === 'hit')
const bombs = rows.filter(r => r[0] === 'bomb').map(r => Object.fromEntries(
  String(of(r, 'detail') || '').split(';').filter(Boolean).map(kv => kv.split('='))))
if (hits.length || bombs.length) {
  const rescued = bombs.filter(b => b.rescue === '1').length
  const offensive = bombs.length - rescued
  console.log(`\n피격 ${hits.length} · 폭탄 ${bombs.length}(구제 ${rescued} · 선제 ${offensive})`
    + ` · 사망 ${deaths.length}`)
  if (hits.length) {
    const pct = (rescued / hits.length) * 100
    console.log(`  구제 성공률 ${pct.toFixed(0)}% — 0%% 면 창이 열린 것을 모르거나 반응 시간이 모자란다`)
  }
  const last = deaths.length ? Object.fromEntries(
    String(of(deaths[deaths.length - 1], 'detail') || '').split(';').filter(Boolean).map(kv => kv.split('='))) : null
  if (last && last.score !== undefined) console.log(`  마지막 사망 시 점수 ${last.score} · 라이프 ${last.lives}`)
}

// 재파지 원인 — ev=regrip 행의 detail (key=value;...). 판정이 아니라 다음 수정의 근거다.
const regrips = rows.filter(r => r[0] === 'regrip').map(r => Object.fromEntries(
  String(of(r, 'detail') || '').split(';').filter(Boolean).map(kv => kv.split('='))
))
if (regrips.length) {
  const REACH = 60, SHORT = 30
  const cause = { '제외 영역에서 뗌': 0, '도달 소진': 0, '짧은 드래그(<0.5s)': 0, '기타': 0 }
  const axis = { 좌: 0, 우: 0, 상: 0, 하: 0 }
  for (const e of regrips) {
    const r = { 좌: +e.rl, 우: +e.rr, 상: +e.ru, 하: +e.rd }
    const low = Object.entries(r).filter(([, v]) => v < REACH)
    if (e.excl === '1') cause['제외 영역에서 뗌']++
    else if (low.length) { cause['도달 소진']++; for (const [k] of low) axis[k]++ }
    else if (+e.held < SHORT) cause['짧은 드래그(<0.5s)']++
    else cause['기타']++
  }
  console.log(`\n재파지 원인 (${regrips.length}건):`)
  for (const [k, v] of Object.entries(cause)) if (v) console.log(`  ${k.padEnd(18)} ${v}`)
  const ax = Object.entries(axis).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')
  if (ax) console.log(`  도달 소진 방향: ${ax}`)
}
const relays = deaths.map(r => Number((String(of(r, 'detail') || '').match(/relay=(\d+)/) || [])[1] || 0))
if (relays.some(v => v > 0)) console.log(`릴레이 인계: ${relays.reduce((a, b) => a + b, 0)}회`)

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
