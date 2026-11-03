class_name EnemyField
## 적 7종. SoA — 최대 32기, 프레임 중 재할당 없음.
##
## 적은 HP 덩어리가 아니라 플레이어에게 **특정 행동을 강요하는 장치**다(설계서 §5).
## 7종 각각이 강요하는 것이 다르고, 그것이 이동과 탄막의 조합으로 표현된다.
##
## 적 정의를 Resource 로 만들지 않는다: load() 는 경로당 한 인스턴스를 돌려주므로
## 같은 EnemyDef.tres 를 쓰는 적 40마리가 한 객체를 공유하고, def.hp -= dmg 한 줄이
## 그 적 타입 전체를 오염시킨다. duplicate() 도 얕은 복사라 답이 아니다.
## 코드 상수 + 별도 SoA 로 그 함정을 원천 차단한다.

enum Type {
	DRIFTER,       # 표류 포자체 — P01. "물이 흐른다" 를 알아차리게 한다
	NEEDLEFISH,    # 침어 — P03. 사격 전에 미리 흘러갈 것
	MEDUSA,        # 관 해파리 — P02. 화면 하단을 떠날 것
	TUBE,          # 부착 발광관 — P07. 수평 방향을 한쪽으로 확정할 것
	PODWORM,       # 광낭충 — P08. 미래 화면을 위해 지금 위치를 잡을 것 + DPS 체크
	COLONY_CORE,   # 군체 등해파리 코어 — 표적 우선순위
	COLONY_BODY,   # 그 몸통. 내 쪽 몸통부터 지우면 내 쪽 파문이 얇아진다
	EEL,           # 역류 뱀장어 — P12. 화면 아래를 존중할 것
}

## 자탄은 관통이고 반경 안에 있는 동안 매 틱 대미지를 넣는다 — 실효 ≈45 dmg/s(정렬 100%).
## 즉 HP 45 = 1초다. 아래 값은 그 척도로 읽는다.
const HP := [240.0, 60.0, 300.0, 300.0, 220.0, 200.0, 60.0, 260.0]
const R_VIS := [30.0, 20.0, 34.0, 26.0, 28.0, 34.0, 18.0, 24.0]
const R_HIT := [30.0, 22.0, 34.0, 26.0, 28.0, 34.0, 18.0, 24.0]
## 격파 시 광립 수 — 위험한 적일수록 보상이 크다
const MOTES := [6, 3, 10, 10, 12, 20, 4, 10]

# 표류 포자체 — 하강 → 정지 방출 → 이탈.
# 하강 속도는 62 로 시작했는데 첫 탄이 t=360(5.5초)에 나왔다 —
# 30초 루프를 판정하는 슬라이스에서 5.5초 공백은 판정 자체를 무의미하게 만든다.
const S_DESCEND := 150.0
# 105 로는 이탈에 10초가 걸려 죽은 적이 플레이필드를 가로지르는 장식으로 남았다.
const S_EXIT := 300.0

# 침어 — 측면에서 빠르게 들어와 급정지, 발사, 이탈. 설계서 §5 의 이동이다.
# "아래에서 얌전히 사격하는 습관을 부순다" 가 목적이므로 머무는 시간이 짧아야 한다.
const NF_ENTER := 700.0
const NF_BRAKE := 18          # 0.3초 급정지
const NF_HOLD := 132          # 정지 후 2회 발사(66틱 간격)
const NF_EXIT := 520.0
const NF_SPEED := 195.0       # 구 등속 횡단 — 공정성 러너의 단독 관측이 참조한다
const NF_BURST_GAP := 66

# 관 해파리 — 정지 후 좌우 사인(진폭 120, 주기 3.2s). 화면 하단을 떠나게 만든다.
const MD_AMP := 120.0
const MD_PERIOD := 192.0

# 광낭충 — 조류를 무시하고 느리게 내려온다. 포낭 3회를 다 뱉기 전에 죽여야 하는 DPS 체크다.
const PW_DESCEND := 40.0
const PW_EVERY := 240

# 군체 등해파리 — 코어는 멈추고 몸통 5개가 반경 150 을 공전한다(18°/s).
const CL_BODIES := 5
const CL_RADIUS := 150.0
const CL_OMEGA := 18.0        # 도/초
const CL_EMIT := 96

# 역류 뱀장어 — 하단 밖에서 상승한다. 1.0초 전 기포 잔적으로 예고한다.
const EEL_RISE := 130.0
const EEL_WARN := 60
const EEL_WARN_SPEED := -70.0

var px := PackedFloat32Array()
var py := PackedFloat32Array()
var bx := PackedFloat32Array()      ## 기준 x — 사인·공전의 중심. 속도 적분은 누적 오차가 남는다
var hp := PackedFloat32Array()
var etype := PackedInt32Array()
var mode := PackedInt32Array()
var y_hold := PackedFloat32Array()
var hold_left := PackedInt32Array()
var t0 := PackedInt32Array()        ## 방출 국소 시간의 기준 틱
var dirx := PackedFloat32Array()    ## 진입 방향, 또는 공전 위상(군체 몸통)
## 진입 / 활동 / 이탈. **위치로 상태를 추론하지 않는다** —
## 군체 몸통이 공전으로 중심 위에 올라가면 "아직 내려오는 중" 으로 읽혀 영원히 진입 단계에
## 머물렀다(로스터 검사가 "퇴장없음" 으로 잡았다). 상태는 상태로 들고 있어야 한다.
enum Phase { ENTER, ACT, EXIT }
var phase := PackedInt32Array()
var n: int = 0

var killed: int = 0
## 이번 틱에 격파된 적의 [위치, 광립 수]. 호출자가 소비하고 비운다 —
## 인덱스가 swap-remove 로 재배정되므로 격파 시점에 값으로 남겨야 한다.
var kills: Array = []

func _init() -> void:
	px.resize(Tune.MAX_ENEMIES); py.resize(Tune.MAX_ENEMIES); bx.resize(Tune.MAX_ENEMIES)
	hp.resize(Tune.MAX_ENEMIES); etype.resize(Tune.MAX_ENEMIES)
	mode.resize(Tune.MAX_ENEMIES); y_hold.resize(Tune.MAX_ENEMIES)
	hold_left.resize(Tune.MAX_ENEMIES); t0.resize(Tune.MAX_ENEMIES)
	dirx.resize(Tune.MAX_ENEMIES); phase.resize(Tune.MAX_ENEMIES)

func clear() -> void:
	n = 0
	killed = 0
	kills.clear()

func spawn(t: int, kind: int, x: float, y: float, hold_y: float, m: int, hold: int, dx: float) -> void:
	if n >= Tune.MAX_ENEMIES:
		return
	px[n] = x; py[n] = y; bx[n] = x
	hp[n] = HP[kind]
	etype[n] = kind
	mode[n] = m
	y_hold[n] = hold_y
	hold_left[n] = hold
	t0[n] = t
	dirx[n] = dx
	phase[n] = Phase.ENTER
	n += 1

## 웨이브 한 줄을 그대로 받아 스폰한다. **진입 y 규칙은 여기 한 곳에만 둔다.**
##
## main._spawn_waves / _spawn_stage · zone_runner · soak_runner 세 곳이 각자
## `-50.0 if kind == 0 else w[3]` 로 해석하고 있었고, 그래서:
##   · 관 해파리(2)·발광관(3)은 정지 위치에서 바로 시작해 하강 진입이 통째로 죽었다
##     (_descend 가 첫 틱에 도달 판정을 통과한다) — 화면 한복판에서 무에서 튀어나온다
##   · 역류 뱀장어(7)는 화면 **아래**에서 올라와야 하는데(y = PF_H + 60) 맨 위에서 나와
##     1.7초 만에 위로 빠졌다. 경고 기포만 화면 아래에 뿌리고 본체는 사라진다
##   · 군체(5)는 spawn_colony 를 타야 코어 + 몸통 5기가 나오는데 코어만 스폰돼
##     탄을 한 발도 안 쐈다(발사는 몸통이 한다)
## 같은 규칙을 세 벌로 두면 갈라진다는 것을 또 확인했다.
func spawn_wave(t: int, w: Array) -> void:
	var kind := int(w[1])
	var x := float(w[2])
	var hold_y := float(w[3])
	if kind == Type.COLONY_CORE:
		spawn_colony(t, x, hold_y, int(w[5]))
		return
	spawn(t, kind, x, entry_y(kind, hold_y), hold_y, int(w[4]), int(w[5]), float(w[6]))

## 그 적이 어디서 화면에 들어오는가.
static func entry_y(kind: int, hold_y: float) -> float:
	match kind:
		Type.NEEDLEFISH:
			return hold_y            # 좌우에서 수평 진입한다
		Type.EEL:
			return Tune.PF_H + 60.0  # 아래에서 올라온다 — 이 개체의 교재가 "화면 아래" 다
		_:
			return -50.0             # 위에서 내려온다

## 군체 등해파리는 코어 + 몸통 5기로 스폰된다. 몸통은 각자 공전 위상을 든다.
func spawn_colony(t: int, x: float, hold_y: float, hold: int) -> void:
	spawn(t, Type.COLONY_CORE, x, -50.0, hold_y, 0, hold, 0.0)
	for i in CL_BODIES:
		spawn(t, Type.COLONY_BODY, x, -50.0, hold_y, i, hold,
				TAU * float(i) / float(CL_BODIES))

func step(tick: int, player: Vector2) -> void:
	var i := 0
	while i < n:
		var k := etype[i]
		match k:
			Type.DRIFTER, Type.TUBE:
				_step_descender(i, tick, k)
			Type.NEEDLEFISH:
				_step_needlefish(i, tick, player)
			Type.MEDUSA:
				_step_medusa(i, tick)
			Type.PODWORM:
				_step_podworm(i, tick)
			Type.COLONY_CORE, Type.COLONY_BODY:
				_step_colony(i, tick, k)
			Type.EEL:
				_step_eel(i, tick, player)

		# 이탈 제거 (swap-with-last)
		if py[i] > Tune.PF_H + 80.0 or py[i] < -220.0 \
				or px[i] < -140.0 or px[i] > Tune.PF_W + 140.0:
			_remove(i)
			continue
		i += 1

## 공통 — 내려와서 멈춘다. 도달 판정을 여기 한 곳에만 둔다.
func _descend(i: int, tick: int) -> bool:
	if py[i] < y_hold[i] - 0.5:
		py[i] += S_DESCEND * Tune.DT
		t0[i] = tick + 1                 # 정지 도달 시점부터 국소 시간 0
		return false
	phase[i] = Phase.ACT
	return true

func _tick_act(i: int) -> bool:
	hold_left[i] -= 1
	if hold_left[i] <= 0:
		phase[i] = Phase.EXIT
	return true

## 표류 포자체 · 부착 발광관 — 내려와 멈추고 쏜다. 발광관은 착생이라 이탈하지 않고 소멸한다.
func _step_descender(i: int, tick: int, k: int) -> void:
	match phase[i]:
		Phase.ENTER:
			_descend(i, tick)
		Phase.ACT:
			var local := tick - t0[i]
			if k == Type.DRIFTER:
				Patterns.p01(local, px[i], py[i])
			else:
				Patterns.p07(local, tick, px[i], py[i])
			_tick_act(i)
		_:
			if k == Type.TUBE:
				py[i] = Tune.PF_H + 200.0    # 착생 — 수명이 끝나면 소멸한다
			else:
				py[i] += S_EXIT * Tune.DT

## 침어 — 빠르게 진입 → 급정지 → 2회 발사 → 이탈.
## 등속 횡단이면 "아래에서 얌전히 쏘는" 플레이를 부수지 못한다.
## `mode` = 전속 진입 틱 수. 이것이 곧 정지 위치다 —
## 목표 x 를 따로 들면 배열이 하나 늘고, 타임라인에서 "얼마나 들어오는가" 가 안 보인다.
func _step_needlefish(i: int, tick: int, player: Vector2) -> void:
	var age := tick - t0[i]
	var travel: int = mode[i]
	match phase[i]:
		Phase.ENTER:
			if age < travel:
				px[i] += dirx[i] * NF_ENTER * Tune.DT
			elif age < travel + NF_BRAKE:
				var f := 1.0 - float(age - travel) / float(NF_BRAKE)
				px[i] += dirx[i] * NF_ENTER * f * Tune.DT
			else:
				phase[i] = Phase.ACT
		Phase.ACT:
			Patterns.p03((age - travel - NF_BRAKE) % NF_BURST_GAP, px[i], py[i],
					player.x, player.y)
			_tick_act(i)
		_:
			px[i] += dirx[i] * NF_EXIT * Tune.DT

## 관 해파리 — 기준 x 를 중심으로 사인 왕복. 속도 적분은 누적 오차가 남으므로 위치를 직접 쓴다.
func _step_medusa(i: int, tick: int) -> void:
	match phase[i]:
		Phase.ENTER:
			_descend(i, tick)
		Phase.ACT:
			var lt := tick - t0[i]
			px[i] = bx[i] + MD_AMP * sin(TAU * float(lt) / MD_PERIOD)
			Patterns.p02(lt, px[i], py[i])
			_tick_act(i)
		_:
			py[i] += S_EXIT * Tune.DT

## 광낭충 — 조류를 무시하고 느리게 내려오며 포낭을 3회 뱉는다.
## 다 뱉은 뒤에는 빠르게 빠진다 — 40 u/s 로 계속 내려가면 화면을 32초 동안 차지한다.
func _step_podworm(i: int, tick: int) -> void:
	if phase[i] == Phase.ENTER:
		phase[i] = Phase.ACT
		t0[i] = tick
	if phase[i] == Phase.ACT:
		py[i] += PW_DESCEND * Tune.DT
		var lt := tick - t0[i]
		if lt >= 0 and lt % PW_EVERY == 0:
			Patterns.p08(0, px[i], py[i])
		_tick_act(i)
	else:
		py[i] += S_EXIT * Tune.DT

## 군체 등해파리 — 코어는 멈추고 몸통이 공전한다. 몸통별로 순차 발사한다.
func _step_colony(i: int, tick: int, k: int) -> void:
	match phase[i]:
		Phase.ENTER:
			_descend(i, tick)
		Phase.ACT:
			if k == Type.COLONY_BODY:
				var lt := tick - t0[i]
				var a := dirx[i] + deg_to_rad(CL_OMEGA) * float(lt) * Tune.DT
				px[i] = bx[i] + cos(a) * CL_RADIUS
				py[i] = y_hold[i] + sin(a) * CL_RADIUS * 0.45
				# 몸통 순서대로 돌아가며 쏜다 — 내 쪽 몸통을 먼저 지우면 내 쪽 파문이 얇아진다
				if lt % (CL_EMIT * CL_BODIES) == CL_EMIT * mode[i]:
					Patterns.p09_ex(py[i] + 30.0, PI if (mode[i] & 1) == 1 else 0.0, tick,
							Patterns.P09_SPEED, Tune.Kind.SPORE_TIDE)
			_tick_act(i)
		_:
			py[i] += S_EXIT * Tune.DT

## 역류 뱀장어 — 아래에서 올라온다. 1.0초 전 기포 잔적이 예고다 —
## 예고 없이 아래에서 나오면 하단 캠핑을 "처벌" 이 아니라 "기습" 으로 만든다.
func _step_eel(i: int, tick: int, player: Vector2) -> void:
	var age := tick - t0[i]
	match phase[i]:
		Phase.ENTER:
			if age % 12 == 0:
				BulletField.spawn_acc(px[i], Tune.PF_H - 20.0, 0.0, EEL_WARN_SPEED,
						Tune.Kind.BUBBLE, 0.0, 10.0)
			if age >= EEL_WARN:
				phase[i] = Phase.ACT
		Phase.ACT:
			py[i] -= EEL_RISE * Tune.DT
			Patterns.p12(age - EEL_WARN, px[i], py[i], player.x, player.y)
			_tick_act(i)
		_:
			py[i] -= EEL_RISE * 2.0 * Tune.DT

## 자탄 피격. 반환값은 격파했는지.
func damage(i: int, d: float) -> bool:
	hp[i] -= d
	if hp[i] <= 0.0:
		killed += 1
		kills.append([Vector2(px[i], py[i]), MOTES[etype[i]]])
		_remove(i)
		return true
	return false

func _remove(i: int) -> void:
	n -= 1
	px[i] = px[n]; py[i] = py[n]; bx[i] = bx[n]; hp[i] = hp[n]
	etype[i] = etype[n]; mode[i] = mode[n]; y_hold[i] = y_hold[n]
	hold_left[i] = hold_left[n]; t0[i] = t0[n]; dirx[i] = dirx[n]; phase[i] = phase[n]
