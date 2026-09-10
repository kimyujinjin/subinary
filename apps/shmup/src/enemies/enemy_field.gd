class_name EnemyField
## 적 2종. SoA — 최대 32기, 프레임 중 재할당 없음.
##
## 적 정의를 Resource 로 만들지 않는다: load() 는 경로당 한 인스턴스를 돌려주므로
## 같은 EnemyDef.tres 를 쓰는 적 40마리가 한 객체를 공유하고, def.hp -= dmg 한 줄이
## 그 적 타입 전체를 오염시킨다. duplicate() 도 얕은 복사라 답이 아니다.
## 게이트 1 은 코드 상수 + 별도 SoA 로 그 함정을 원천 차단한다.

enum Type { SPORANGIUM, NEEDLEFISH }

# HP 는 40/18 로 시작했는데, 관통 자탄이 겹치는 동안 매 틱 데미지를 넣으므로
# 실효 DPS 가 ≈45/s 였고 P07 발광관(플레이어 바로 위)이 0.9초에 죽어 격자가 아예
# 화면에 안 나왔다. 방출 창의 3분의 2 정도를 버티는 값으로 올린다 —
# 그보다 크면 "빨리 죽이고 짧게 끝낸다"는 관측침의 정체성이 사라진다.
const HP := [240.0, 60.0]
const R_VIS := [30.0, 20.0]
const R_HIT := [30.0, 22.0]

# 부유 포자낭 — 하강 → 정지 방출 → 이탈.
# 하강 속도는 62 로 시작했는데 첫 탄이 t=360(5.5초)에 나왔다 —
# 30초 루프를 판정하는 슬라이스에서 5.5초 공백은 판정 자체를 무의미하게 만든다.
# 150 u/s = 하강 112틱 → 첫 탄 t≈142(2.4초).
const S_DESCEND := 150.0
# 105 로는 이탈에 10초가 걸려 죽은 적이 플레이필드를 가로지르는 장식으로 남았다.
const S_EXIT := 300.0
# 직침어 — 고정 y 를 횡단하며 3연발
const NF_SPEED := 195.0
const NF_BURST_GAP := 66

var px := PackedFloat32Array()
var py := PackedFloat32Array()
var hp := PackedFloat32Array()
var etype := PackedInt32Array()
var mode := PackedInt32Array()      # 포자낭: 0 = P01, 1 = P07
var y_hold := PackedFloat32Array()
var hold_left := PackedInt32Array()
var t0 := PackedInt32Array()        # 방출 국소 시간의 기준 틱
var dirx := PackedFloat32Array()
var n: int = 0

var killed: int = 0

func _init() -> void:
	px.resize(Tune.MAX_ENEMIES); py.resize(Tune.MAX_ENEMIES)
	hp.resize(Tune.MAX_ENEMIES); etype.resize(Tune.MAX_ENEMIES)
	mode.resize(Tune.MAX_ENEMIES); y_hold.resize(Tune.MAX_ENEMIES)
	hold_left.resize(Tune.MAX_ENEMIES); t0.resize(Tune.MAX_ENEMIES)
	dirx.resize(Tune.MAX_ENEMIES)

func clear() -> void:
	n = 0
	killed = 0

func spawn(t: int, kind: int, x: float, y: float, hold_y: float, m: int, hold: int, dx: float) -> void:
	if n >= Tune.MAX_ENEMIES:
		return
	px[n] = x; py[n] = y
	hp[n] = HP[kind]
	etype[n] = kind
	mode[n] = m
	y_hold[n] = hold_y
	hold_left[n] = hold
	t0[n] = t
	dirx[n] = dx
	n += 1

func step(tick: int, player: Vector2) -> void:
	var i := 0
	while i < n:
		var k := etype[i]
		if k == Type.SPORANGIUM:
			if py[i] < y_hold[i] - 0.5:
				py[i] += S_DESCEND * Tune.DT
				t0[i] = tick + 1                 # 정지 도달 시점부터 국소 시간 0
			elif hold_left[i] > 0:
				hold_left[i] -= 1
				var local := tick - t0[i]
				if mode[i] == 0:
					Patterns.p01(local, px[i], py[i])
				else:
					Patterns.p07(local, tick, px[i], py[i])
			else:
				py[i] += S_EXIT * Tune.DT
		else:
			px[i] += dirx[i] * NF_SPEED * Tune.DT
			var lt := tick - t0[i]
			# 플레이필드 안에서만 쏜다. 진입 x(-60/780)가 탄 컬링 경계(-48/768) 밖이라
			# 첫 버스트의 바늘이 생성된 그 틱에 컬링되어 존재하지 않았다.
			if lt >= 0 and px[i] >= 0.0 and px[i] <= Tune.PF_W:
				Patterns.p03(lt % NF_BURST_GAP, px[i], py[i], player.x, player.y)

		# 이탈 제거 (swap-with-last)
		if py[i] > Tune.PF_H + 80.0 or px[i] < -80.0 or px[i] > Tune.PF_W + 80.0:
			_remove(i)
			continue
		i += 1

## 자탄 피격. 반환값은 격파했는지.
func damage(i: int, d: float) -> bool:
	hp[i] -= d
	if hp[i] <= 0.0:
		killed += 1
		_remove(i)
		return true
	return false

func _remove(i: int) -> void:
	n -= 1
	px[i] = px[n]; py[i] = py[n]; hp[i] = hp[n]
	etype[i] = etype[n]; mode[i] = mode[n]; y_hold[i] = y_hold[n]
	hold_left[i] = hold_left[n]; t0[i] = t0[n]; dirx[i] = dirx[n]
