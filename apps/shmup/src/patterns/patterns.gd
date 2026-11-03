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

enum Id {
	P01_TIDEFALL, P03_NEEDLE, P07_FLOWGRID, P05_HALO_RING, P09_LOW_RIPPLE, P02_BACKBUBBLE,
	P04_AIMED_SPREAD, P08_POD_BURST, P10_TURBULENT, P15_EXTINCTION,
	P06_TWIN_SPIRAL, P11_CANYON, P12_UPWELLING, P13_CONTRACT, P14_FINALE, P16_CONDENSE,
}
const NAMES := ["P01 적조 낙하", "P03 직침", "P07 조류 격자", "P05 회광륜", "P09 저광 파문",
		"P02 역기포", "P04 삼중 조준 확산", "P08 포낭 산개", "P10 난류 포자", "P15 발광 소멸",
		"P06 쌍와", "P11 협곡", "P12 역류 상승", "P13 광막 수축", "P14 종조", "P16 심층 응결"]

## 패턴 레지스트리 — 도구가 6종을 **빠짐없이** 훑기 위한 표다.
##
## 공정성 러너가 손으로 적은 3종만 검사하고 있었다(P05·P09·P02 는 보스·합성 안에서만).
## 패턴을 추가할 때 러너를 같이 고치는 것을 잊으면 검사되지 않는 패턴이 조용히 생긴다.
## 여기 한 줄을 추가하면 러너·갤러리가 함께 따라온다.
##
## `tier` 는 난이도 레이어 드롭용이다(설계서 §7: tier > max_tier 인 이미터는 베이크 시 제거).
## `solo_period` 는 **단독 관측용 주기**다 — 게임의 실제 스케줄은 적·보스가 들고 있고,
## 단독 검사는 "패턴 한 겹의 최소 통과 폭" 이라는 패턴 고유 성질만 본다.
const BOOK := [
	{"id": &"P01", "tier": 1, "solo_period": 420, "aimed": false, "origin": Vector2(360.0, 220.0)},
	{"id": &"P03", "tier": 2, "solo_period": 66,  "aimed": true,  "origin": Vector2(360.0, 380.0)},
	{"id": &"P07", "tier": 1, "solo_period": 900, "aimed": false, "origin": Vector2(360.0, 220.0)},
	{"id": &"P05", "tier": 1, "solo_period": 30,  "aimed": false, "origin": Vector2(360.0, 250.0)},
	{"id": &"P09", "tier": 2, "solo_period": 72,  "aimed": false, "origin": Vector2(360.0, 460.0)},
	{"id": &"P02", "tier": 1, "solo_period": 180, "aimed": false, "origin": Vector2(360.0, 440.0)},
	{"id": &"P04", "tier": 2, "solo_period": 120, "aimed": true,  "origin": Vector2(360.0, 260.0)},
	{"id": &"P08", "tier": 2, "solo_period": 240, "aimed": false, "origin": Vector2(360.0, 200.0)},
	{"id": &"P10", "tier": 3, "solo_period": 96,  "aimed": false, "origin": Vector2(360.0, 230.0)},
	{"id": &"P15", "tier": 1, "solo_period": 300, "aimed": true,  "origin": Vector2(360.0, 300.0)},
	{"id": &"P06", "tier": 2, "solo_period": 8,   "aimed": false, "origin": Vector2(360.0, 250.0)},
	{"id": &"P11", "tier": 2, "solo_period": 54,  "aimed": false, "origin": Vector2(360.0, 200.0)},
	{"id": &"P12", "tier": 3, "solo_period": 168, "aimed": true,  "origin": Vector2(360.0, 1150.0)},
	{"id": &"P13", "tier": 3, "solo_period": 240, "aimed": true,  "origin": Vector2(360.0, 250.0)},
	{"id": &"P14", "tier": 4, "solo_period": 384, "aimed": true,  "origin": Vector2(360.0, 250.0)},
	{"id": &"P16", "tier": 3, "solo_period": 96,  "aimed": false, "origin": Vector2(360.0, 230.0)},
]

## 관측 기록 — 그 패턴이 **실제로 탄을 낸** 지점에서만 표시한다.
## 게이트 함수는 매 틱 불리므로 그 앞에 두면 한 번도 안 나온 패턴이 점등된다.
static func mark(idx: int) -> void:
	SaveData.mark_seen(idx)

## 단독 관측 — 도구 전용. 게임이 쓰는 것과 **같은 함수**를 부른다(별도 하네스를 만들면
## 게임과 갈라져서 틀린 숫자를 자신 있게 보고한다).
static func emit_solo(idx: int, local: int, tick: int, target: Vector2) -> void:
	var o: Vector2 = BOOK[idx]["origin"]
	match idx:
		Id.P01_TIDEFALL:
			p01(local, o.x, o.y)                       # 포자낭 mode 0 과 같다
		Id.P03_NEEDLE:
			# 직침어는 횡단하며 쏜다 — 최악 각도를 만들기 위해 그 이동을 재현한다
			var ex := -60.0 + EnemyField.NF_SPEED * Tune.DT * float(local)
			p03(local % EnemyField.NF_BURST_GAP, ex, o.y, target.x, target.y)
		Id.P07_FLOWGRID:
			p07(local, tick, o.x, o.y)                 # 포자낭 mode 1 과 같다
		Id.P05_HALO_RING:
			# 보스 외륜. 링 각도는 조류 적분에서 나온다 — 보스와 같은 식이다.
			if local % int(BOOK[idx]["solo_period"]) == 0:
				p05_ex(o.x, o.y, Boss.R_OUTER,
						Boss.OMEGA * BulletField.flow_phase(tick) * Tune.DT,
						P05_SPEED, Difficulty.count(P05_COUNT), Tune.Kind.SPORE_GRID)
		Id.P09_LOW_RIPPLE:
			if local % int(BOOK[idx]["solo_period"]) == 0:
				p09_ex(o.y, PI if (local / int(BOOK[idx]["solo_period"])) % 2 == 1 else 0.0,
						tick, P09_SPEED, Tune.Kind.SPORE_TIDE)
		Id.P02_BACKBUBBLE:
			p02(local, o.x, o.y)                       # 관 해파리와 같다
		Id.P04_AIMED_SPREAD:
			p04(local, o.x, o.y, target.x, target.y)
		Id.P08_POD_BURST:
			p08(local, o.x, o.y)
		Id.P10_TURBULENT:
			p10(local, o.x, o.y)
		Id.P15_EXTINCTION:
			if local % int(BOOK[idx]["solo_period"]) == 0:
				p15(o.x, o.y, target.x, target.y)
		Id.P06_TWIN_SPIRAL:
			p06(local, o.x, o.y)
		Id.P11_CANYON:
			p11(local, tick, o.y)
		Id.P12_UPWELLING:
			p12(local, o.x, o.y, target.x, target.y)
		Id.P13_CONTRACT:
			p13(local, o.x, o.y, target.x, target.y)
		Id.P14_FINALE:
			p14(local, tick, o.x, o.y, target.x, target.y)
		Id.P16_CONDENSE:
			p16(local, tick, o.x, o.y)

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
	p01_ex(local, ex, ey, P01_ARC, Difficulty.count(P01_COUNT), P01_SPEED, P01_VOLLEY_TICKS, P01_VOLLEYS)

## 헤드리스 스윕용 파라미터판. p01() 이 이것을 호출하므로 튜닝과 게임이 갈라지지 않는다.
static func p01_ex(local: int, ex: float, ey: float, arc: float, count: int,
		speed: float, volley_ticks: int, volleys: int) -> void:
	if local < 0 or local % volley_ticks != 0:
		return
	mark(0)
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
	mark(1)
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
	mark(2)
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
	mark(3)
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
	mark(4)
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

# ── P02 역기포 · Circle + 역행 · 조류 35% ───────────────────────────────
# 독해 단서(설계서 §4): "링 테두리가 흰색으로 밝아지면 **상승 시작**.
# 방사 중심선은 기하학적으로 항상 안전."
#
# 처음에 방사 방향의 반대로 감속을 걸어 원점으로 되돌리게 만들었더니 두 가지가 틀렸다:
#   · 기포가 물에서 **떠오른다**는 세계관과 어긋난다(설계서는 "상승" 이라고 적었다)
#   · 원점 복귀형은 반경이 곧 도달 한계라, 해파리가 y=200 에 서면 탄이 플레이어 밴드
#     (y 640~1180)에 **영영 닿지 않는다**. 헤드리스로 재니 peak 가 118 그대로였다 —
#     즉 화면에 아무 일도 일어나지 않는 패턴이었다.
#
# 그래서 전원에게 **위쪽 상수 가속**을 건다. 아래로 나간 탄은 감속 → 정지 → 상승으로
# 같은 자리를 두 번 지나고, 옆으로 나간 탄은 수평 속도를 유지한 채 천천히 떠오른다.
# 위로 나간 탄은 그대로 이탈한다. "두 번 온다" 가 물리로 성립한다.
# 값은 공정성 격자(발수 8~12 × 속도 290~330 × 해파리 깊이 380~440)로 골랐다.
# 처음 넣은 배치(해파리 y=380 · 14발)는 y640 밴드에서 강제 점프 416유닛 — 요구 이동
# 상한 250 초과로 실패했다. 해파리를 440 으로 내리고 10발로 줄여 통로min 102 로 맞췄다.
const P02_COUNT := 10
const P02_SPEED := 330.0
const P02_STOP_SEC := 2.0      # 아래로 나간 탄의 하강 깊이 = v0·t/2 = 330유닛
const P02_EVERY := 180         # 3.0초마다 한 겹

static func p02(local: int, ex: float, ey: float) -> void:
	var every := Difficulty.every(P02_EVERY)
	if local < 0 or local % every != 0:
		return
	mark(5)
	p02_ex(ex, ey, Difficulty.count(P02_COUNT), P02_SPEED, P02_STOP_SEC,
			float(local / every) * 0.42)

## rise = 위쪽 상수 가속(유닛/s²). 아래로 v0 로 나간 탄이 stop_sec 에 멈춘다.
static func p02_ex(cx: float, cy: float, count: int, speed: float,
		stop_sec: float, phase: float) -> void:
	var rise := speed / stop_sec
	for i in count:
		var ang := phase + TAU * float(i) / float(count)
		var dx := cos(ang)
		var dy := sin(ang)
		BulletField.spawn_acc(cx + dx * 26.0, cy + dy * 26.0,
				dx * speed, dy * speed, Tune.Kind.BUBBLE, 0.0, -rise)

# ── P04 삼중 조준 확산 · AimedSpread · 조류 100% ────────────────────────
# 독해 단서: 3연발의 **중앙만** 이동 예측 사격이다. 양옆 둘은 고정 확산이므로
# "가운데를 피해 옆으로" 가 아니라 "가운데가 나를 따라온다" 를 읽어야 한다.
# 조준 빈도는 난이도 축이다(설계서 §7 Aimed 빈도 0.3~1.0).
const P04_SPREAD := 26.0       # 좌우 확산각(도)
const P04_SPEED := 320.0
const P04_BURST := 3
const P04_GAP := 12

static func p04(local: int, ex: float, ey: float, px: float, py: float) -> void:
	if local < 0 or local >= P04_BURST * P04_GAP or local % P04_GAP != 0:
		return
	mark(6)
	var base := atan2(py - ey, px - ex)
	for d in [-P04_SPREAD, 0.0, P04_SPREAD]:
		var a := base + deg_to_rad(d)
		BulletField.spawn(ex, ey, cos(a) * P04_SPEED, sin(a) * P04_SPEED, Tune.Kind.SPORE_TIDE)

# ── P08 포낭 산개 · Layered · 지연 Circle · 조류 100% ───────────────────
# 독해 단서: 맥동 3회 = 파열 카운트다운. 1.2초의 **계획 시간**을 준다.
# 위협이 지금 있는 곳이 아니라 2.5초 뒤 있을 곳을 보고 위치를 잡는 패턴이다.
# 파열은 BulletField 의 퓨즈가 처리한다 — 포낭이 조류에 실려 흐른 자리에서 터진다.
const P08_SPEED := 62.0
const P08_SPREAD := 150.0

static func p08(local: int, ex: float, ey: float) -> void:
	# 240 은 "조류 반전 주기" 를 상수로 박은 것이었다(Boss.BEAT 와 같은 부류).
	# Hard 는 180틱마다 반전하므로 맥동이 조류와 어긋난다.
	# 간격에 난이도 배율을 **걸지 않는다.** 이 패턴이 가르치는 것은 "맥동 3회 = 파열
	# 카운트다운" 이고 그 간격 자체가 계획 시간이다. Hard 에서 ×0.85 를 걸었더니
	# 퓨즈(150틱)보다 자주 나와 포낭이 겹쳐 쌓이고 보스 P2 도달폭이 53 → 28 이 됐다.
	var every := maxi(Boss.beat_len(), Tune.POD_FUSE + 30)
	if local < 0 or local % every != 0:
		return
	mark(7)
	var v := local / every
	for i in 2:
		var x := ex + (float(i) - 0.5) * P08_SPREAD + (30.0 if (v & 1) == 1 else -30.0)
		BulletField.spawn_acc(x, ey, 0.0, P08_SPEED, Tune.Kind.POD, 0.0, 0.0, Tune.POD_FUSE)

# ── P10 난류 포자 · RandomSpread · 고정 시드 · 조류 100% ────────────────
# 독해 단서: **첫 조우에서는 읽히지 않는다 — 그것이 의도다.**
# 3~4번째 조우에서 "매번 똑같다" 를 알아차리는 것이 이 패턴의 학습이다.
# 그래서 난수는 상태가 아니라 (틱, 인덱스)의 해시여야 한다 — RNG 인스턴스를 들면
# 발사 순서나 표현용 소비에 따라 스트림이 밀려 "매번 똑같다" 가 깨진다.
const P10_COUNT := 7
const P10_SPEED_LO := 170.0
const P10_SPEED_HI := 300.0
const P10_ARC := 150.0
const P10_EVERY := 24

## 정수 해시 → [0,1). 결정론적이고 무상태다.
static func hash01(a: int, b: int) -> float:
	var h := (a * 73856093) ^ (b * 19349663) ^ 0x5f3759df
	h = (h ^ (h >> 13)) * 1274126177
	return float((h ^ (h >> 16)) & 0xFFFFFF) / 16777216.0

static func p10(local: int, ex: float, ey: float) -> void:
	var every := Difficulty.every(P10_EVERY)
	if local < 0 or local % every != 0:
		return
	mark(8)
	var v := local / every
	for i in Difficulty.count(P10_COUNT):
		var deg := 90.0 - P10_ARC * 0.5 + P10_ARC * hash01(v, i)
		var sp := lerpf(P10_SPEED_LO, P10_SPEED_HI, hash01(v, i + 977))
		var a := deg_to_rad(deg)
		BulletField.spawn(ex, ey, cos(a) * sp, sin(a) * sp, Tune.Kind.SPORE_TIDE)

# ── P15 발광 소멸 · Circle · 1회성 · 조류 100% ──────────────────────────
# 페이즈 전환 연출이자 보상이다. 내 **현재 위치를 향해** 40° 틈이 열린다 —
# 화면이 가득 차 보이지만 정답은 이미 내가 서 있는 곳이므로, 전환 순간에 벌을 주지 않는다.
const P15_COUNT := 30
const P15_SPEED := 240.0
const P15_GAP_DEG := 40.0

static func p15(cx: float, cy: float, px: float, py: float) -> void:
	mark(9)
	var safe := atan2(py - cy, px - cx)
	var half := deg_to_rad(P15_GAP_DEG) * 0.5
	for i in P15_COUNT:
		var a := TAU * float(i) / float(P15_COUNT)
		if absf(angle_difference(a, safe)) < half:
			continue
		BulletField.spawn(cx, cy, cos(a) * P15_SPEED, sin(a) * P15_SPEED, Tune.Kind.SPORE_GRID)

# ── P06 쌍와 · Spiral ×2 역회전 · 조류 100% ─────────────────────────────
# 독해 단서: 두 나선이 만드는 **마름모 격자 셀의 변을 따라 걷는다.**
# 두 나선은 색(적조/발광)과 반경차로 구분한다 — 색만으로 구분하게 두면 색각 이상에서 무너진다.
# 위상은 base + (tick − spawn) × step 으로 재계산한다(float 누산은 수 분 뒤 어긋난다).
const P06_ARMS := 3
const P06_SPEED := 215.0
const P06_STEP_DEG := 7.0
const P06_EVERY := 8

static func p06(local: int, ex: float, ey: float) -> void:
	var every := Difficulty.every(P06_EVERY)
	if local < 0 or local % every != 0:
		return
	mark(10)
	var k := local / every
	for s2 in 2:
		var sign := 1.0 if s2 == 0 else -1.0
		var kind := Tune.Kind.SPORE_TIDE if s2 == 0 else Tune.Kind.SPORE_GRID
		var r := 12.0 if s2 == 0 else 28.0
		for a in P06_ARMS:
			var deg := sign * P06_STEP_DEG * float(k) + 360.0 * float(a) / float(P06_ARMS) \
					+ (0.0 if s2 == 0 else 60.0)
			var rad := deg_to_rad(deg)
			BulletField.spawn(ex + cos(rad) * r, ey + sin(rad) * r,
					cos(rad) * P06_SPEED, sin(rad) * P06_SPEED, kind)

# ── P11 협곡 · Layered · Fan ×2 · 조류 100% ─────────────────────────────
# 독해 단서: 좌우 두 부채가 만드는 **중앙 이음선이 조류로 ±90 이동한다.**
# 벽이 아니라 이음선을 보는 패턴이다 — 조류 적분이 곧 안전선의 위치다.
const P11_PER_SIDE := 6
const P11_SPEED := 200.0
const P11_PITCH := 58.0
const P11_SEAM := 90.0
const P11_EVERY := 18

static func p11(local: int, tick: int, ey: float) -> void:
	if local < 0 or local % Difficulty.every(P11_EVERY) != 0:
		return
	mark(11)
	var seam := Tune.PF_W * 0.5 + BulletField.flow_c(tick) * P11_SEAM
	var u0 := BulletField.flow_u(ey, tick)
	for side in 2:
		var dir := -1.0 if side == 0 else 1.0
		for i in Difficulty.count(P11_PER_SIDE):
			var x := seam + dir * (70.0 + P11_PITCH * float(i))
			if x < -20.0 or x > Tune.PF_W + 20.0:
				continue
			BulletField.spawn(x, ey, u0, P11_SPEED, Tune.Kind.SPORE_TIDE)

# ── P12 역류 상승 · Circle + 기포 + Aimed · 조류 35%/0% ─────────────────
# 독해 단서: **기포 반전 프레임 = 바늘 발사 프레임.**
# 화면 아래를 존중하게 만드는 패턴이다 — 아래에 캠핑하면 상승하는 기포와 바늘을 동시에 받는다.
# 두 사건을 같은 틱에 묶어야 그 인과가 배워진다.
const P12_BUBBLES := 9
const P12_SPEED := 250.0
const P12_STOP_SEC := 1.4
const P12_NEEDLES := 2
const P12_EVERY := 168

static func p12(local: int, ex: float, ey: float, px: float, py: float) -> void:
	if local < 0:
		return
	# 정지 → 바늘 전환이 주기 안에 들어와야 한다. 간격을 줄여도 그 아래로는 못 간다 —
	# 넘어가면 기포가 멈추는 틱에 바늘이 안 나가고 "반전 프레임 = 조준 프레임" 이 사라진다.
	var phase := local % maxi(Difficulty.every(P12_EVERY), int(P12_STOP_SEC * 60.0) + 30)
	if phase == 0:
		mark(12)
		p02_ex(ex, ey, Difficulty.count(P12_BUBBLES), P12_SPEED, P12_STOP_SEC, 0.31)
	elif phase == int(P12_STOP_SEC * 60.0):
		# 기포가 멈추고 상승으로 돌아서는 바로 그 틱에 조준 바늘이 나간다
		var base := atan2(py - ey, px - ex)
		for i in P12_NEEDLES:
			var a := base + deg_to_rad(-9.0 + 18.0 * float(i))
			BulletField.spawn(ex, ey, cos(a) * P03_SPEED, sin(a) * P03_SPEED, Tune.Kind.NEEDLE)

# ── P13 광막 수축 · RotatingRing · 내향 · 조류 0% ───────────────────────
# 독해 단서: **흰 대형탄 2발 = 게이트.** 게임 전체에서 이 패턴 하나에만 예약된 표식이다.
# 원안은 각속도 정합(링과 같은 속도로 계속 도는 것)을 요구했는데, 그것은 설계서가
# 금지한 "지속 2D 곡선 추적" 이다. 여기서는 **단일 축 커밋**으로 재저작한다 —
# 가까운 게이트를 골라 한 번 들어가면 끝이고, 링이 수축하는 동안 안쪽이 주머니가 된다.
const P13_COUNT := 26
const P13_RADIUS := 560.0
const P13_SPEED := -150.0      # 음수 = 내향
const P13_GATES := 2

static func p13(local: int, cx: float, cy: float, px: float, py: float) -> void:
	if local != 0:
		return
	mark(13)
	# 게이트는 플레이어에 가장 가까운 각과 그 반대편 — 항상 250유닛 이내에 하나가 있다
	# 게이트는 **인덱스로** 고른다. 각도 창으로 고르면 창 폭이 탄 간격보다 넓으면 2발씩
	# 잡히고(4발), 좁으면 가장 가까운 탄이 창 밖이라 0발이 된다 — 둘 다 겪었다.
	# 가장 가까운 인덱스를 반올림으로 집으면 항상 정확히 1발이고, 반대편은 +COUNT/2 다.
	var toward := atan2(py - cy, px - cx)
	var g0 := wrapi(int(round(fposmod(toward, TAU) / (TAU / float(Difficulty.count_even(P13_COUNT))))), 0, Difficulty.count_even(P13_COUNT))
	var g1 := wrapi(g0 + Difficulty.count_even(P13_COUNT) / 2, 0, Difficulty.count_even(P13_COUNT))
	for i in Difficulty.count_even(P13_COUNT):
		var a := TAU * float(i) / float(Difficulty.count_even(P13_COUNT))
		var is_gate := i == g0 or i == g1
		var k := Tune.Kind.GATE if is_gate else Tune.Kind.SPORE_GRID
		var sp := P13_SPEED * (0.55 if is_gate else 1.0)
		BulletField.spawn(cx + cos(a) * P13_RADIUS, cy + sin(a) * P13_RADIUS,
				cos(a) * sp, sin(a) * sp, k)

# ── P14 종조 · Layered 복합 3중 · 보스 P3 최종 ──────────────────────────
# **새 어휘 0개.** 이미 배운 세 문법(낙하벽 · 조류 격자 · 조준침)을 동시에 적용한다.
# 마지막 패턴이 새 규칙을 들고 나오면 그때까지의 학습이 무의미해진다.
const P14_CYCLE := 384

static func p14(local: int, tick: int, ex: float, ey: float, px: float, py: float) -> void:
	if local < 0:
		return
	# P14 는 P01·P07·P03 의 합성이라 자기 spawn 이 없다. 이 함수가 도는 동안은
	# 세 층 중 하나가 반드시 나가므로 여기서 표시한다.
	mark(14)
	var ph := local % P14_CYCLE
	p01(ph, ex, ey)                                   # 층 1 — 낙하벽
	p07(ph - 96, tick, ex, ey + 40.0)                 # 층 2 — 조류 격자
	if ph >= 192:
		p03((ph - 192) % 84, ex, ey, px, py)          # 층 3 — 조준침

# ── P16 심층 응결 · Layered · 규칙 반전 · 조류 100% ─────────────────────
# **조류를 따르면 틀린다.** 다른 15종은 "물을 읽고 타면 통로가 유지된다" 를 가르치는데,
# 이 하나가 그 규칙을 뒤집는다 — 조류가 흘러간 자리에 탄이 응결한다.
# 심사의 재미 렌즈가 지목한 "8초 주기의 완전 예고된 함수는 두 런에 학습되어 콘텐츠 생산을
# 멈춘다" 의 직접 해답이다. 이것이 없으면 조류가 일방적 이득이 되어 게임이 스스로 무너진다.
const P16_COUNT := 9
const P16_SPEED := 175.0
const P16_LEAD := 150.0        # 조류 방향으로 이만큼 앞선 자리에 응결한다
const P16_EVERY := 96

static func p16(local: int, tick: int, ex: float, ey: float) -> void:
	if local < 0 or local % Difficulty.every(P16_EVERY) != 0:
		return
	mark(15)
	var c := BulletField.flow_c(tick)
	var lead := c * P16_LEAD
	var span := 300.0
	for i in Difficulty.count(P16_COUNT):
		var x := ex + lead - span * 0.5 + span * float(i) / float(Difficulty.count(P16_COUNT) - 1)
		# 응결이므로 초기 횡속도가 0 이다 — 조류에 실려 온 것이 아니라 거기서 생긴다.
		BulletField.spawn(x, ey, 0.0, P16_SPEED, Tune.Kind.SPORE_GRID)
