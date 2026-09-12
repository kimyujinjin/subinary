class_name MidBoss
## 중간보스 · 조류 방추체 — 3페이즈. 이 개체는 **조류장의 2번째 축**을 가르친다.
##
## 전반부에서 배운 규칙은 "물은 좌우로만 흐른다" 였다. 이 몸은 살아 있는 동안 자기 주변
## 반경 400 에 회전 성분을 얹어 그 규칙의 첫 예외를 만든다. 몸통 표면의 발광 줄무늬가
## 실제 소용돌이와 같은 방향으로 흐르므로 **물의 상태가 적의 몸에 그려져 있다**.
##
## 설계서가 국소 소용돌이를 컷 후보 1순위로 지목했다. 그래서 P1 은 소용돌이를 끄고
## 전역 조류만으로 싸운다 — 소용돌이를 통째로 들어내도 P1 이 그대로 남고,
## P2·P3 는 `vortex_w` 만 0 이 되어 "회전이 빠진 같은 탄막" 으로 성립한다.
##
## 보스(Boss)와 구조는 닮았지만 **별도 클래스**다. 보스는 화면을 소유하고(플레이어 y 하한
## 560), 격파가 곧 스테이지 클리어다. 이쪽은 스테이지 요소이고 플레이어는 전 화면을 쓴다.
## N=2 에서 공통 기반 클래스를 뽑는 것은 추상화가 아니라 추측이다(CLAUDE.md: 처음부터
## 과설계하지 않는다). 세 번째 보스가 생기면 그때 뽑는다.

const CX := 360.0
const CY := 320.0
const LEN := 340.0                ## 방추형 몸통 길이(세로)
const HALF_H := LEN * 0.5
const HALF_W := 46.0              ## 최대 반폭 — 시각
const HIT_HALF_W := 42.0          ## 자탄 판정 반폭
const HIT_HALF_H := 150.0         ## 자탄 판정 반높이

## 스테이지에서 1:20~1:50 = 1800틱을 쓴다. 시간 상한 합 1680 + 전환 2회 120 = 1800.
const P1_MAX_TICKS := 600
const P2_MAX_TICKS := 600
const P3_MAX_TICKS := 480
const PHASE_GAP := 60
const WAKE_TICKS := 48            # 0.8초. 등장하자마자 쏘지 않는다

const P1_END_FRAC := 0.65
const P2_END_FRAC := 0.30
## 몸통이 폭 84 짜리 세로 막대라 "중앙에 있으면 맞는다" 가 거의 항상 성립한다 —
## 실측 정렬률이 세 페이즈 모두 100%% 다(보스 코어는 반경 70 이라 그렇지 않다).
## 그래서 실효 DPS 는 15 로 잡는다. 배정 시간은 1:20~1:50 = 1800틱 = 30초이고
## 페이즈 시간 상한 합 1680 + 전환 2회 120 = 정확히 1800 이다.
## 350 → 정렬 100%% 에 23.3초(+전환 2초). 그 아래는 시간 상한이 받는다.
const HP_MAX := 350.0

const SPIN := 0.35                ## 몸통 자전 rad/s — 느리다. 소용돌이와 방향이 같다
const W_P2 := 0.6                 ## 시계방향 0.6 rad/s (설계서 §6)
const W_P3 := 0.6
const FLIP_EVERY := 120           ## P3 — 2.0초마다 반전

var phase: int = 1
var phase_t0: int = 0
var gap_left: int = 0
var hp: float = HP_MAX
var done: bool = false
var done_reason: String = ""
var done_tick: int = -1
## 소용돌이 스위치 — 컷 시뮬레이션·헤드리스 진단용. 끄면 전역 조류만으로 싸운다.
var vortex_on: bool = true
## 스윕용 손잡이 — 헤드리스에서만 바꾼다. 게임은 기본값으로 돈다.
## 둘 다 **소용돌이 OFF 기준**으로 골랐다. 컷 후보가 공정성을 떠받치고 있으면
## 그것은 더 이상 컷 후보가 아니다 — 첫 판에서 OFF 시 P3 도달폭이 36 이었다(하한 52).
## p05 30→60 실측: peak 347 → 239 (ON 도달폭 150 · OFF 116). 보스 P1 peak 247 수준으로 맞췄다.
## p11 18→27 실측: peak 156 → 107 (ON 71 · OFF 78). P3 가 세 페이즈 중 가장 좁다.
var p05_every: int = 60
var p11_every: int = 27
## 성분 스위치 — 헤드리스 진단용(보스의 emit_p05/p09/p03 과 같은 용도). 게임은 전부 켠다.
var emit_p05: bool = true
var emit_p08: bool = true
var emit_p16: bool = true
var _t0: int = 0

func reset(tick: int) -> void:
	hp = HP_MAX
	phase = 1
	phase_t0 = tick
	gap_left = 0
	done = false
	done_reason = ""
	done_tick = -1
	_t0 = tick
	BulletField.vortex_w = 0.0

func hp_frac() -> float:
	return clampf(hp / HP_MAX, 0.0, 1.0)

func elapsed(tick: int) -> int:
	return tick - _t0

func phase_elapsed(tick: int) -> int:
	return tick - phase_t0

func phase_limit() -> int:
	match phase:
		1: return P1_MAX_TICKS
		2: return P2_MAX_TICKS
		_: return P3_MAX_TICKS

func phase_end_frac() -> float:
	match phase:
		1: return P1_END_FRAC
		2: return P2_END_FRAC
		_: return 0.0

## 이 틱의 소용돌이 각속도(rad/s). 0 = 없음. 몸통 줄무늬와 배경이 이 값 하나를 공유한다 —
## 따로 계산하면 "물의 상태가 몸에 그려져 있다" 가 거짓말이 된다.
func vortex_w(tick: int) -> float:
	if done or gap_left > 0 or not vortex_on:
		return 0.0
	match phase:
		1: return 0.0                      # P1 은 전역 조류만 — "그냥 적이다"
		2: return W_P2
		_:
			# 2.0초마다 반전. 이음선이 반전마다 튀는 것이 이 페이즈의 시험이다.
			var k := phase_elapsed(tick) / FLIP_EVERY
			return W_P3 if k % 2 == 0 else -W_P3

## 몸통 자전각. 소용돌이가 없는 P1 에서는 전역 조류를 따라 흔들린다 —
## 몸이 항상 물의 상태를 표시한다는 규칙은 페이즈와 무관하다.
func spin_angle(tick: int) -> float:
	var w := vortex_w(tick)
	if w == 0.0:
		return SPIN * BulletField.flow_phase(tick) * Tune.DT
	# **각도는 각속도의 적분이다.** w(t)·t 로 쓰면 P3 에서 2초마다 부호가 뒤집힐 때
	# 누적각이 통째로 −2배로 점프해 줄무늬가 순간이동한다 — "물의 상태가 몸에 그려져 있다"
	# 가 반전마다 거짓이 된다(Boss.flow_phase 가 같은 이유로 적분인 것과 같은 함정).
	# 반전은 FLIP_EVERY 마다이고 부호는 짝/홀이므로 닫힌 형태로 더한다.
	var pe := phase_elapsed(tick)
	var base := SPIN * float(elapsed(tick)) * Tune.DT
	if phase < 3:
		return base + w * float(pe) * Tune.DT    # P2 는 각속도가 상수라 적분이 w·t 다
	# P3 는 FLIP_EVERY 마다 부호가 뒤집힌다. 완료 블록은 쌍으로 상쇄되므로
	# 남는 것은 블록 수가 홀수일 때의 한 블록 + 진행 중인 블록이다.
	var k := pe / FLIP_EVERY
	var rem := pe % FLIP_EVERY
	var acc := float(FLIP_EVERY) if (k % 2) == 1 else 0.0
	acc += float(rem) * (1.0 if (k % 2) == 0 else -1.0)
	return base + W_P3 * acc * Tune.DT

func step(tick: int, player: Vector2) -> void:
	if done:
		BulletField.vortex_w = 0.0
		return
	if phase_elapsed(tick) >= phase_limit():
		_advance(tick, player, "time")
		return
	# 소용돌이는 발사보다 먼저 쓴다 — 이 틱에 태어난 탄도 같은 물에 실려야 한다.
	BulletField.vortex_x = CX
	BulletField.vortex_y = CY
	BulletField.vortex_w = vortex_w(tick)
	if gap_left > 0:
		gap_left -= 1
		return
	if elapsed(tick) < WAKE_TICKS:
		return
	match phase:
		1: _step_p1(tick, player)
		2: _step_p2(tick, player)
		_: _step_p3(tick, player)

# ── P1 「그냥 적이다」 · 100 → 65% · 소용돌이 OFF ────────────────────────
## 새 어휘 0개. P10(무작위 확산)과 P03(조준 직선)만 쓴다 — 이동 습관과 선행 이동을 시험한다.
## 여기서 소용돌이를 켜지 않는 것이 이 개체의 학습 곡선이다: 먼저 "그냥 적" 으로 만나고,
## 그 다음에 같은 몸이 물을 돌리기 시작한다.
const P1_BEAT := 150
const P03_AT := 30

func _step_p1(tick: int, player: Vector2) -> void:
	var l := phase_elapsed(tick) % P1_BEAT
	Patterns.p10(l, CX, CY + HALF_H - 40.0)
	Patterns.p03(l - P03_AT, CX, CY + HALF_H - 60.0, player.x, player.y)

# ── P2 「S자 나선」 · 65 → 30% · 시계방향 0.6 rad/s ──────────────────────
## 회전 링(P05)이 소용돌이에 전단되어 S자 나선이 된다. 시험하는 것은
## "구조가 변형되어도 통로는 남는다" 이다 — 링의 틈은 휘어질 뿐 사라지지 않는다.
const P2_BEAT := 200

func _step_p2(tick: int, player: Vector2) -> void:
	var pe := phase_elapsed(tick)
	var l := pe % P2_BEAT
	if emit_p05 and l % Difficulty.every_ring(p05_every) == 0:
		Patterns.p05_ex(CX, CY, HALF_H - 30.0, spin_angle(tick),
				Patterns.P05_SPEED, Difficulty.count(Patterns.P05_COUNT), Tune.Kind.SPORE_GRID)
	# 링은 계속 돈다 — S자 나선이 이 페이즈가 가르치는 것이다.
	# 나머지 둘은 **비트로 번갈아** 깐다. 셋을 동시에 깔면 Hard·소용돌이 OFF 에서
	# peak 348 에 도달 불가가 된다(성분 분해: 각각·둘씩은 전부 통과, 셋만 0).
	# 보스 P2 도 네 패턴을 4비트 루프로 하나씩 돌린다 — 같은 규칙을 여기도 적용한다.
	var beat := (pe / P2_BEAT) % 2
	# 포낭은 **자기 비트 안에서 터져야 한다.** 퓨즈가 1.2초라 비트 끝에서 쏘면
	# 다음 비트(P16 응결) 위에서 터지고, 그 겹침이 Hard·소용돌이 OFF 에서 통로를 0 으로 만든다
	# (성분 분해: 링+P08 99 · 링+P16 113 인데 셋 번갈아가 0 이었다 — 밀도가 아니라 경계 문제다).
	if emit_p08 and beat == 0 and l + Tune.POD_FUSE < P2_BEAT:
		Patterns.p08(l, CX, CY + 90.0)
	if emit_p16 and beat == 1:
		Patterns.p16(l, tick, CX, CY + 60.0)

# ── P3 「반전」 · 30 → 0% · 2.0초마다 방향 반전 ──────────────────────────
## 이 게임에서 가장 빠른 독해를 요구하는 구간이다(보스 P3 보다 짧다).
## 반전 순간 이음선이 튄다 — 반전 직전 12틱은 발사를 멈춰 "지금 뒤집힌다" 를 몸으로 알린다.
const FLIP_LEAD := 12

func _step_p3(tick: int, player: Vector2) -> void:
	var pe := phase_elapsed(tick)
	if pe % FLIP_EVERY >= FLIP_EVERY - FLIP_LEAD:
		return                            # 반전 예고 — 새 탄이 없는 0.2초
	# P11 은 자기 주기(18틱)로 쏘면 40발/초가 되어 소용돌이 없이는 이음선이 막힌다.
	# 발사 틱을 직접 고른다 — 패턴 상수를 고치면 보스 P2 의 협곡 비트까지 같이 변한다.
	if pe % Difficulty.every(p11_every) == 0:
		Patterns.p11(0, tick, CY + 120.0)
	Patterns.p12(pe, CX, Tune.PF_H - 140.0, player.x, player.y)

## 페이즈 전환. 보스와 같은 이유로 P15 를 준다 — 전환이 벌이 되지 않게 한다.
func _advance(tick: int, player: Vector2, reason: String) -> void:
	if phase >= 3:
		_finish(tick, reason)
		return
	phase += 1
	phase_t0 = tick
	gap_left = PHASE_GAP
	hp = minf(hp, HP_MAX * (P1_END_FRAC if phase == 2 else P2_END_FRAC))
	BulletField.vortex_w = 0.0
	BulletField.clear_radius(player.x, player.y, 200.0)
	Patterns.p15(CX, CY, player.x, player.y)

func damage(d: float, tick: int, player := Vector2(CX, Tune.PF_H * 0.8)) -> void:
	if done or gap_left > 0:
		return
	hp -= d
	if hp <= HP_MAX * phase_end_frac():
		hp = HP_MAX * phase_end_frac()
		_advance(tick, player, "hp")

## 격파 — 발광 소멸(P15) → 몸통이 갈라진다. 광립 60개와 폭탄 리필은 main 이 준다.
func _finish(tick: int, reason: String) -> void:
	done = true
	hp = 0.0                          # HUD 가 "M20%" 로 남지 않게 한다
	done_reason = reason
	done_tick = tick
	BulletField.vortex_w = 0.0
	Patterns.p15(CX, CY, CX, Tune.PF_H * 0.8)

## 자탄 판정 — 세로로 긴 방추형이므로 축정렬 사각형이다(원으로 잡으면 몸통 끝이 비어 보인다).
func hit(x: float, y: float, r: float) -> bool:
	return absf(x - CX) <= HIT_HALF_W + r and absf(y - CY) <= HIT_HALF_H + r
