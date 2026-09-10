class_name Patterns
## 패턴 3종. 게이트 1 시점에는 Resource 가 아니라 순수 GDScript 로 쓴다 —
## 3종일 때 인스펙터·Curve 위젯·툴 버튼의 이득이 학습 비용보다 작다.
## 패턴이 6종을 넘어 값 튜닝이 실제로 아쉬워지는 시점에 .tres 로 이관한다.
##
## 위상 드리프트 방지: 각도를 float 에 누산하지 않고
## base + (tick − spawn_tick) × step 으로 매번 재계산한다.
##
## 이미터 시간에 await create_timer() / Tween / Timer 를 쓰지 않는다 —
## process_in_physics 기본값이 false 라 가변 delta 기준이 되어
## 탄막 타이밍이 기기 성능에 좌우된다. 그건 공정성 문제다.

enum Id { P01_TIDEFALL, P03_NEEDLE, P07_FLOWGRID, P05_HALO_RING, P09_LOW_RIPPLE }
const NAMES := ["P01 적조 낙하", "P03 직침", "P07 조류 격자", "P05 회광륜", "P09 저광 파문"]

# ── P01 적조 낙하 · Fan 초광각 160° · 조류 100% ─────────────────────────
# 독해 단서: 줄의 기울기 = 조류 방향. 회피 답이 좌/우 이진 선택이다.
# 초기 vx 가 갈린 탄들이 항력 이완으로 서로 다른 비율로 끌려와 부채가 실제로 기운다.
# 값은 tools/sweep_runner.gd 격자 측정으로 골랐다 (추측 아님).
# arc160·cnt11·vol42 : 최장min 95 · 통로min 91 · 정지창 0 · 강제전환 0 · peak 129(2기)
# cnt 를 13/15 로 올리면 통로min 이 32~46 으로 떨어지고 정지창 위반이 120~220 생긴다.
const P01_ARC := 160.0
const P01_COUNT := 11
const P01_SPEED := 230.0
const P01_VOLLEY_TICKS := 66
const P01_VOLLEYS := 6
const P01_VY_FLOOR := 0.55   # 최소 낙하 속도 = speed × 0.55 → 화면 통과 ≤ 8.8초

static func p01(local: int, ex: float, ey: float) -> void:
	p01_ex(local, ex, ey, P01_ARC, P01_COUNT, P01_SPEED, P01_VOLLEY_TICKS, P01_VOLLEYS)

## 헤드리스 스윕용 파라미터판. p01() 이 이것을 호출하므로 튜닝과 게임이 갈라지지 않는다.
static func p01_ex(local: int, ex: float, ey: float, arc: float, count: int,
		speed: float, volley_ticks: int, volleys: int) -> void:
	if local < 0 or local % volley_ticks != 0:
		return
	var v := local / volley_ticks
	if v >= volleys:
		return
	# 볼리마다 중심각을 살짝 흔들어 "같은 벽의 반복"이 아니게 한다.
	var center := 90.0 + (6.0 if (v & 1) == 0 else -6.0)
	var step := arc / float(count - 1)
	for i in count:
		var r := deg_to_rad(center - arc * 0.5 + step * float(i))
		# vy 에 하한을 둔다. 순수 방사 부채는 극단 각도에서 vy = speed·sin(10°) = 40 u/s 가
		# 되어 그 탄이 28초간 조류에 실려 떠돌고, 루프를 넘어 누적되며 다음 패턴을 오염시킨다.
		# 실측: 그 잔류탄이 peak 186 중 ~90발이었다. x 확산(부채의 정체성)은 그대로 두고
		# 낙하 속도만 보장하면 "적조 낙하"라는 이름과도 일치한다.
		BulletField.spawn(ex, ey, cos(r) * speed,
			maxf(sin(r) * speed, speed * P01_VY_FLOOR), Tune.Kind.SPORE_TIDE)

# ── P03 직침 · Aimed · 조류 0% ──────────────────────────────────────────
# 흰색·무헤일로 = 안 휜다. 선행 이동을 요구한다. 전역 후추 역할.
const P03_SPEED := 900.0
const P03_BURST := 3
const P03_GAP := 7

static func p03(local: int, ex: float, ey: float, px: float, py: float) -> void:
	if local < 0 or local >= P03_BURST * P03_GAP or local % P03_GAP != 0:
		return
	var a := atan2(py - ey, px - ex)
	BulletField.spawn(ex, ey, cos(a) * P03_SPEED, sin(a) * P03_SPEED, Tune.Kind.NEEDLE)

# ── P07 조류 격자 · Layered · Wave × 조류 ───────────────────────────────
# 리본 6개의 위상이 조류 주기와 동기. 타면 아무것도 안 해도 통로 안에 머문다 —
# 이것이 조류가 일방적 위협이 아니라 읽을 대상이라는 증명이다.
# 방출 주기가 밴드 높이보다 짧으면 두 줄이 밴드에 동시에 들어가 서로 끼어들어
# 통로가 절반이 된다. 행간격 = VY × EMIT_TICKS / 60 이 밴드 높이(2×16=32)를 넘어야 한다.
#   emit 12 → 행간격 33.0 : 정지창 위반 339 · 강제전환 24 · 통로min 32
#   emit 14 → 행간격 38.5 : 정지창 위반   0 · 강제전환  0 · 통로min 105
const P07_RIBBONS := 6
const P07_PITCH := 144.0        # 중심간 144, 자유폭 112 > Normal 96
const P07_EMIT_TICKS := 14
const P07_VY := 165.0
const P07_WAVE_AMP := 18.0
const P07_WAVE_PHASE := 0.4
const P07_WAVE_PERIOD := 132

static func p07(local: int, tick: int, ex: float, ey: float) -> void:
	p07_ex(local, tick, ex, ey, P07_PITCH, P07_EMIT_TICKS, P07_WAVE_AMP, P07_WAVE_PHASE)

## 헤드리스 스윕용 파라미터판.
static func p07_ex(local: int, tick: int, ex: float, ey: float,
		pitch: float, emit_ticks: int, amp: float, ph: float) -> void:
	if local < 0 or local % emit_ticks != 0:
		return
	# 격자 전체가 조류 적분값을 따라 표류한다 — 리본 간 간격은 보존된다.
	var drift := BulletField.flow_c(tick) * 46.0
	var phase := TAU * float(tick % P07_WAVE_PERIOD) / float(P07_WAVE_PERIOD)
	var span := pitch * float(P07_RIBBONS - 1)
	var u0 := BulletField.flow_u(ey, tick)
	for i in P07_RIBBONS:
		var x := ex - span * 0.5 + pitch * float(i) + drift \
				+ amp * sin(phase + float(i) * ph)
		if x < -20.0 or x > Tune.PF_W + 20.0:
			continue
		# 발사 시점의 유속을 그대로 실어 준다 → 즉시 조류에 탄다
		BulletField.spawn(x, ey, u0, P07_VY, Tune.Kind.SPORE_GRID)

# ── P05 회광륜 · RotatingRing · 조류 100% ─────────────────────────────
# 보스 외륜의 발광 기관 24개가 탄 24발과 1:1 대응한다 — 다음 발사가 어느 각도에서
# 오는지 몸통을 보면 안다. 링은 조류와 같이 돈다(시계방향 = 물이 오른쪽).
const P05_COUNT := 24
# 탄속은 tools/boss_runner.gd 격자(ω 0.2/0.3/0.4 × 150/170/200)로 골랐다.
# 판정 기준은 1D 도달 가능성(Reach1D): 9조합 모두 60 u/s 로 생존 가능했고, 차이는 정밀도였다.
#   ω 0.30 · 170 → 최악 순간 도달 폭 51 (요구 52 미달)
#   ω 0.30 · 200 → 97, 탄 피크 247(최저) ← 선택
const P05_SPEED := 200.0

static func p05_ex(cx: float, cy: float, radius: float, angle: float,
		speed: float, count: int, kind: int) -> void:
	for i in count:
		var a := angle + TAU * float(i) / float(count)
		var dx := cos(a)
		var dy := sin(a)
		BulletField.spawn(cx + dx * radius, cy + dy * radius, dx * speed, dy * speed, kind)

# ── P09 저광 파문 · Wave · 조류 100% ────────────────────────────────────
# 게임 최저속(110 u/s). 파문 한 줄이 내려오고, 움푹 내려온 골에 구멍이 있다 —
# "튀어나온 곳에 틈" 이 독해 단서다. 발사마다 위상을 반 파장 교대해 골이 좌우로 옮겨 가고,
# 줄 전체가 조류를 타므로 "골과 함께 조류 방향으로 흐른다" 가 회피 답이다.
const P09_SPEED := 110.0
const P09_PITCH := 40.0
const P09_AMP := 36.0
const P09_LAMBDA := 360.0
const P09_GAP_HALF := 60.0     # 골 중심 ±60 을 비운다 → 중심간 160, 자유폭 128 > Normal 96

static func p09_ex(y0: float, phase: float, tick: int, speed: float, kind: int) -> void:
	# 발사 시점의 유속을 실어 준다 → 즉시 조류에 탄다
	var u0 := BulletField.flow_u(y0, tick)
	# 골 = sin(2πx/λ + φ) = 1 인 x — 가장 앞선(아래로 내려온) 지점
	var x_valley := (PI * 0.5 - phase) * P09_LAMBDA / TAU
	var x := P09_PITCH * 0.5
	while x < Tune.PF_W:
		var d := absf(fposmod(x - x_valley + P09_LAMBDA * 0.5, P09_LAMBDA) - P09_LAMBDA * 0.5)
		if d >= P09_GAP_HALF:
			BulletField.spawn(x, y0 + P09_AMP * sin(TAU * x / P09_LAMBDA + phase), u0, speed, kind)
		x += P09_PITCH
