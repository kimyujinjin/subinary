class_name Boss
## 화륜종 CORONA — 3페이즈. 이 개체의 외륜 회전이 곧 전역 조류다.
## "이 싸움이 재미있는가" 가 안 나오면 링을 MultiMesh 로 만들어도 안 나온다(설계서 §6).
##
## 이 보스의 전부는 정보 구조다 — **외륜의 회전이 곧 전역 조류다.** 링이 시계방향으로
## 돌면 물이 오른쪽으로 흐르고, 링이 멈추면 물이 멎는다. 그래서 링 각도를 따로 적분하지
## 않고 조류 위상(BulletField.flow_phase)에서 직접 계산한다 — 둘이 어긋날 방법이 없다.
##
## P1 리듬은 조류 주기 그 자체다: 우 2.5s 압력 → 정 1.5s 호흡 → 좌 2.5s 압력 → 정 1.5s 호흡.
## 호흡 창에는 새 발사가 없다(대미지·회수 창). 이것도 조류 세그먼트에서 직접 읽는다.
##
## 보스는 하나이므로 SoA 가 아니라 필드다. Resource 로 만들지 않는다(CLAUDE.md 규약 2).

const CX := 360.0
const CY := 250.0
const R_OUTER := 230.0
const R_MID := 170.0
const R_INNER := 110.0
const R_CORE := 80.0
const R_CORE_HIT := 70.0          # 자탄 판정 — 코어 아래로 x 를 맞춰야 한다
## 실측으로 정했다. 자탄 DPS 15/s(집중 21/s) 이고, tools/killtime_runner.gd 로 잰
## "살아남으면서 코어 정렬을 최대화하는 경로" 의 정렬률이 P1·P2 100%% · P3 99.4%% 다
## (고정점 반복 후 잔여피격 0·0·7). 즉 실효 DPS 상한이 15 다.
##
## 5분 스테이지에서 보스에 주어진 시간은 3:12~5:00 = 108초다.
##   4200 → 완전정보 플레이어도 281초. 페이즈 시간 상한 합(180초)보다 길어서
##          **HP 분기가 한 번도 도달되지 않는다** — 사격이 전투 진행에 아무 영향이 없다.
##   1500 → 정렬 100%% 에 100초, 집중 유지 시 71초. 정렬 60%% 에서 P1 이 딱 상한 50초.
## 즉 정렬 60%% 이상이면 HP 로 끊기고, 그 아래는 시간 상한이 구제한다.
## 난이도를 HP 로 올리지 않는다는 규칙은 그대로다 — 이건 난이도가 아니라 전투 길이다.
const HP_MAX := 1500.0
## 페이즈 경계 — 설계서 §6. HP 증가가 아니라 "안전이 무엇으로 주어지는가" 가 바뀐다:
##   P1 시간(호흡 창) → P2 특정 비트 → P3 장소(링 내부 주머니)
const P1_END_FRAC := 0.70
const P2_END_FRAC := 0.35
const P1_MAX_TICKS := 3000        # 50초. 설계: "100 → 70% 또는 경과 50초"
const P2_MAX_TICKS := 3600        # 60초
const P3_MAX_TICKS := 4200        # 70초
const PHASE_GAP := 96             # 페이즈 전환 연출 1.6초 — 그 동안 발사하지 않는다
const WAKE_TICKS := 90            # 등장 후 1.5초는 쏘지 않는다
## 외륜 아래(y 480 + 여유). 링 위에서 생성되는 탄이 기체 위에 생기면 피할 수 없는 죽음이다.
const PLAYER_MIN_Y := 560.0

const OMEGA := 0.30               # |C| = 1 일 때 링 각속도(rad/s). P05_SPEED 주석의 격자로 골랐다
const P05_EVERY := 30             # 0.5초
const P09_EVERY := 72             # 1.2초
const P09_LAST := 143             # 압력 창(150틱) 안에서 2회 — 국소 0, 72
const P09_Y := CY + 210.0         # 치마 끝
const P03_AT := 40                # 압력 창마다 한 번, 창 시작 0.67초 뒤 3연발

## 1 · 2 · 3. 페이즈가 오르면 링이 하나씩 더 점등된다.
var phase: int = 1
var phase_t0: int = 0
var gap_left: int = 0             ## 전환 연출 잔여 틱
var hp: float = HP_MAX
var done: bool = false
var done_reason: String = ""
var done_tick: int = -1
var omega: float = OMEGA                   # 스윕용
var p05_speed: float = Patterns.P05_SPEED  # 스윕용
## 발사원별 스위치 — 헤드리스 진단용(어느 성분이 통로를 막는지 가른다). 게임에서는 전부 켠다.
var emit_p05: bool = true
var emit_p09: bool = true
var emit_p03: bool = true
var _t0: int = 0
var _p09_flip: bool = false

func reset(tick: int) -> void:
	hp = HP_MAX
	phase = 1
	phase_t0 = tick
	gap_left = 0
	done = false
	done_reason = ""
	done_tick = -1
	_t0 = tick
	_p09_flip = false
	BulletField.reset_flow()

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

## 링 각도 = ω · ∫C dt. 시계방향(+) = 물이 오른쪽.
func ring_angle(tick: int) -> float:
	return omega * BulletField.flow_phase(tick) * Tune.DT

## (압력 창이면 1, 호흡 창이면 0, 세그먼트 국소 틱)
func window(tick: int) -> Vector2i:
	var s := BulletField.flow_seg(tick)
	return Vector2i(1 if s.x == 0 or s.x == 2 else 0, s.y)

func step(tick: int, player: Vector2) -> void:
	if done:
		return
	if phase_elapsed(tick) >= phase_limit():
		_advance(tick, player, "time")
		return
	if gap_left > 0:
		gap_left -= 1
		BulletField.shear = 0.0
		return
	var el := tick - _t0
	if el < WAKE_TICKS:
		return
	match phase:
		1: _step_p1(tick, player)
		2: _step_p2(tick, player)
		_: _step_p3(tick, player)

# ── P1 「점등」 — 안전이 **시간**으로 주어진다 ──────────────────────────
## 8초 매크로가 곧 조류 주기다: 2.5s 압력 → 1.5s 호흡(새 발사 없음) → 반복.
## 리듬을 따로 두지 않고 조류에서 직접 읽으므로 링과 물과 호흡이 어긋날 방법이 없다.
func _step_p1(tick: int, player: Vector2) -> void:
	var w := window(tick)
	if w.x == 0:
		return                        # 호흡 창 — 대미지·회수 창이다
	var l := w.y
	if p05_fires(tick):
		Patterns.p05_ex(CX, CY, R_OUTER, ring_angle(tick), p05_speed,
				Patterns.P05_COUNT, Tune.Kind.SPORE_GRID)
	if emit_p09 and l % P09_EVERY == 0 and l <= P09_LAST:
		Patterns.p09_ex(P09_Y, PI if _p09_flip else 0.0, tick, Patterns.P09_SPEED,
				Tune.Kind.SPORE_TIDE)
		_p09_flip = not _p09_flip
	if emit_p03:
		Patterns.p03(l - P03_AT, CX, CY, player.x, player.y)

# ── P2 「역상」 — 안전이 **특정 비트**에 숨는다 ────────────────────────
## 4비트 고정 루프: ① 조류 격자 ② 포낭 산개 ③ 협곡 ④ 역류 상승 + 심층 응결.
## 호흡이 시간이 아니라 비트 ④의 기포 하강 국면에 숨어 있다 — 시계가 아니라 구조를 읽어야 한다.
##
## 그리고 조류 반전 직전 0.5초에 **전단**이 걸린다. 상·하가 반대로 흐르고 경계는 세기 0 이라
## 거기가 항상 안전 통로다. 처음 보면 화면이 통째로 뭉개지는 재난처럼 보이지만,
## 구조를 알면 "P2 에서는 허리선에서 산다" 는 한 줄이 된다.
const BEAT := 240                 # 4초 — 조류 반전 주기와 같다
const SHEAR_LEAD := 30            # 반전 직전 0.5초

func _step_p2(tick: int, player: Vector2) -> void:
	var pe := phase_elapsed(tick)
	# 전단 — 조류가 부호를 바꾸기 직전에 건다. 세기는 창 안에서 부드럽게 올렸다 내린다.
	var seg := BulletField.flow_seg(tick)
	var seg_len: int = int(Tune.FLOW_SEGS[seg.x])
	var to_end := seg_len - seg.y
	if (seg.x == 1 or seg.x == 3) and to_end <= SHEAR_LEAD:
		BulletField.shear = sin(PI * float(SHEAR_LEAD - to_end) / float(SHEAR_LEAD))
		BulletField.shear_c = 1.0 if seg.x == 1 else -1.0
	else:
		BulletField.shear = 0.0

	var beat := (pe / BEAT) % 4
	var l := pe % BEAT
	match beat:
		0: Patterns.p07(l, tick, CX, CY + 180.0)
		1: Patterns.p08(l, CX, CY + 120.0)
		2: Patterns.p11(l, tick, CY + 150.0)
		_:
			Patterns.p12(l, CX, Tune.PF_H - 120.0, player.x, player.y)
			Patterns.p16(l, tick, CX, CY + 160.0)

# ── P3 「화관」 — 안전이 **장소**가 된다 ───────────────────────────────
## 12초 매크로: 광막 수축(4초 독해) → 링 내부 주머니 1.6초 → 종조(6.4초).
## 안전을 시간으로도 비트로도 주지 않고 "직접 들어가서 얻어라" 로 바꾼다 —
## 이 세 단계가 이 보스의 학습 곡선 전체다.
const MACRO := 720                # 12초
const CONTRACT_AT := 0
const POCKET_AT := 240            # 4초 독해가 끝나는 시점
const FINALE_AT := 336            # 주머니 1.6초 뒤

func _step_p3(tick: int, player: Vector2) -> void:
	BulletField.shear = 0.0
	var m := phase_elapsed(tick) % MACRO
	if m == CONTRACT_AT:
		Patterns.p13(0, CX, CY, player.x, player.y)
	elif m >= FINALE_AT:
		Patterns.p14(m - FINALE_AT, tick, CX, CY, player.x, player.y)
	# POCKET 구간(240~336)은 비어 있다 — 링 내부에 들어간 사람만 얻는 호흡이다

## 페이즈 전환. P15 로 전환 순간을 보상으로 만든다 —
## 틈이 플레이어 방향으로 열리므로 전환이 벌이 되지 않는다.
func _advance(tick: int, player: Vector2, reason: String) -> void:
	if phase >= 3:
		_finish(tick, reason)
		return
	phase += 1
	phase_t0 = tick
	gap_left = PHASE_GAP
	hp = minf(hp, HP_MAX * (P1_END_FRAC if phase == 2 else P2_END_FRAC))
	BulletField.shear = 0.0
	BulletField.clear_radius(player.x, player.y, 220.0)
	Patterns.p15(CX, CY, player.x, player.y)

## 자탄 피격. 페이즈 경계에 닿으면 다음 페이즈로 넘어간다(마지막이면 격파).
## player 는 전환 연출(P15 의 틈 방향)에 쓴다 — 전환 순간에 벌을 주지 않기 위해서다.
func damage(d: float, tick: int, player := Vector2(CX, Tune.PF_H * 0.8)) -> void:
	if done or gap_left > 0:
		return
	hp -= d
	if hp <= HP_MAX * phase_end_frac():
		hp = HP_MAX * phase_end_frac()
		_advance(tick, player, "hp")

func _finish(tick: int, reason: String) -> void:
	done = true
	done_reason = reason
	done_tick = tick

## 이 틱에 P05 가 발사되는가. step() 과 organ_glow 의 **단일 출처**다 —
## 둘을 따로 계산하면 예고와 실제 발사가 어긋난다(아래 주석).
func p05_fires(tick: int) -> bool:
	if done or not emit_p05:
		return false
	var el := tick - _t0
	if el < WAKE_TICKS or el >= P1_MAX_TICKS:
		return false
	var w := window(tick)
	return w.x == 1 and w.y % P05_EVERY == 0

## 다음 P05 발사까지의 근접도 0..1 — 발광 기관이 발사 직전 8틱 동안 밝아진다(예고).
##
## 창 안의 국소 틱으로 `P05_EVERY - l % P05_EVERY` 를 쓰면 두 방향으로 틀린다:
## 압력 창 끝(l 143~149)에서는 다음 틱이 호흡 창이라 오지 않는 발사를 예고하고,
## 창의 첫 발사(l 0)는 직전 8틱이 호흡 창이라 예고가 0 에서 1 로 튄다.
## 헤드리스 측정: 틱 1~999 의 19발 중 5발이 무예고, 4구간이 유령 예고(최대 0.875).
## 그래서 실제 발사 술어를 8틱 앞까지 조회한다 — 창 경계·기상 지연·감속 모드에서 전부 맞는다.
func organ_glow(tick: int) -> float:
	if done:
		return 0.0
	for d in 9:
		if p05_fires(tick + d):
			return 1.0 - float(d) / 8.0
	return 0.0
