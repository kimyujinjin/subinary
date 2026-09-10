class_name Boss
## 화륜종 CORONA — L0. 2단계 목표는 P1 「점등」 하나를 60초 안쪽으로 싸워 보는 것이다.
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
const HP_MAX := 1500.0
const P1_END_FRAC := 0.70
const P1_MAX_TICKS := 3000        # 50초. 설계: "100 → 70% 또는 경과 50초"
const WAKE_TICKS := 90            # 등장 후 1.5초는 쏘지 않는다
## 외륜 아래(y 480 + 여유). 링 위에서 생성되는 탄이 기체 위에 생기면 피할 수 없는 죽음이다.
const PLAYER_MIN_Y := 560.0

const OMEGA := 0.30               # |C| = 1 일 때 링 각속도(rad/s). P05_SPEED 주석의 격자로 골랐다
const P05_EVERY := 30             # 0.5초
const P09_EVERY := 72             # 1.2초
const P09_LAST := 143             # 압력 창(150틱) 안에서 2회 — 국소 0, 72
const P09_Y := CY + 210.0         # 치마 끝
const P03_AT := 40                # 압력 창마다 한 번, 창 시작 0.67초 뒤 3연발

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
	done = false
	done_reason = ""
	done_tick = -1
	_t0 = tick
	_p09_flip = false

func hp_frac() -> float:
	return clampf(hp / HP_MAX, 0.0, 1.0)

func elapsed(tick: int) -> int:
	return tick - _t0

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
	var el := tick - _t0
	if el >= P1_MAX_TICKS:
		_finish(tick, "time")
		return
	if el < WAKE_TICKS:
		return
	var w := window(tick)
	if w.x == 0:
		return                        # 호흡 창 — 새 발사 없음
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

func damage(d: float, tick: int) -> void:
	if done:
		return
	hp -= d
	if hp <= HP_MAX * P1_END_FRAC:
		hp = HP_MAX * P1_END_FRAC
		_finish(tick, "hp")

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
